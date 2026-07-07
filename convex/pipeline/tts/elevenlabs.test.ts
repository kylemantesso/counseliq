import { describe, expect, test, vi } from "vitest";
import { createElevenLabsProvider } from "./elevenlabs";
import { createMockTtsProvider, MOCK_TTS_FAIL_MARKER } from "./mock";
import { TtsError } from "./provider";

const API_KEY = "el-secret-key-do-not-leak";

function okPayload(text: string) {
  const characters = [...text];
  return {
    audio_base64: btoa(`audio-for:${text}`),
    alignment: {
      characters,
      character_start_times_seconds: characters.map((_, i) => i * 0.1),
      character_end_times_seconds: characters.map((_, i) => (i + 1) * 0.1),
    },
    normalized_alignment: {
      characters: [...`NORMALISED ${text}`],
      character_start_times_seconds: [],
      character_end_times_seconds: [],
    },
  };
}

function okResponse(text: string): Response {
  return new Response(JSON.stringify(okPayload(text)), { status: 200 });
}

function errorResponse(status: number, headers?: Record<string, string>): Response {
  return new Response(`error body ${status} key=${"*".repeat(4)}`, {
    status,
    headers,
  });
}

describe("createElevenLabsProvider", () => {
  test("happy path: decodes audio and maps the request-text alignment", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse("Hi there"));
    const provider = createElevenLabsProvider({
      apiKey: API_KEY,
      model: "eleven_multilingual_v2",
      fetchImpl,
    });

    const result = await provider.synthesize({ text: "Hi there", voiceId: "v1" });

    expect(new TextDecoder().decode(result.audio)).toBe("audio-for:Hi there");
    expect(result.timestamps.characters.join("")).toBe("Hi there");
    expect(result.timestamps.startSeconds[1]).toBeCloseTo(0.1);
    expect(result.characters).toBe("Hi there".length);
    expect(result.model).toBe("eleven_multilingual_v2");

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/v1/text-to-speech/v1/with-timestamps");
    expect(url).toContain("output_format=mp3_44100_128");
    const body = JSON.parse(init.body as string);
    expect(body.apply_text_normalization).toBe("off");
    expect(body.previous_text).toBeUndefined();
    expect((init.headers as Record<string, string>)["xi-api-key"]).toBe(API_KEY);
  });

  test("passes previous_text/next_text conditioning when provided", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse("mid"));
    const provider = createElevenLabsProvider({ apiKey: API_KEY, fetchImpl });

    await provider.synthesize({
      text: "mid",
      voiceId: "v1",
      previousText: "before.",
      nextText: "after.",
    });

    const body = JSON.parse(
      (fetchImpl.mock.calls[0] as [string, RequestInit])[1].body as string
    );
    expect(body.previous_text).toBe("before.");
    expect(body.next_text).toBe("after.");
  });

  test("respects retry-after on 429 then succeeds", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(errorResponse(429, { "retry-after": "1" }))
        .mockResolvedValueOnce(okResponse("ok"));
      const provider = createElevenLabsProvider({ apiKey: API_KEY, fetchImpl });

      const pending = provider.synthesize({ text: "ok", voiceId: "v1" });
      await vi.runAllTimersAsync();
      const result = await pending;

      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(result.timestamps.characters.join("")).toBe("ok");
    } finally {
      vi.useRealTimers();
    }
  });

  test("retries 5xx with backoff then succeeds", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(errorResponse(503))
        .mockResolvedValueOnce(errorResponse(500))
        .mockResolvedValueOnce(okResponse("ok"));
      const provider = createElevenLabsProvider({ apiKey: API_KEY, fetchImpl });

      const pending = provider.synthesize({ text: "ok", voiceId: "v1" });
      await vi.runAllTimersAsync();
      await pending;

      expect(fetchImpl).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  test("throws retryable TtsError when retries are exhausted", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn().mockResolvedValue(errorResponse(429));
      const provider = createElevenLabsProvider({ apiKey: API_KEY, fetchImpl });

      const pending = provider.synthesize({ text: "x", voiceId: "v1" });
      const assertion = expect(pending).rejects.toMatchObject({
        name: "TtsError",
        retryable: true,
      });
      await vi.runAllTimersAsync();
      await assertion;
      expect(fetchImpl).toHaveBeenCalledTimes(4);
    } finally {
      vi.useRealTimers();
    }
  });

  test("non-retryable on 401 and never leaks the API key", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(errorResponse(401));
    const provider = createElevenLabsProvider({ apiKey: API_KEY, fetchImpl });

    let thrown: unknown;
    try {
      await provider.synthesize({ text: "x", voiceId: "v1" });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(TtsError);
    expect((thrown as TtsError).retryable).toBe(false);
    expect((thrown as TtsError).message).not.toContain(API_KEY);
  });

  test("incomplete payload (missing alignment) is retryable", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ audio_base64: btoa("x") }), { status: 200 })
      );
    const provider = createElevenLabsProvider({ apiKey: API_KEY, fetchImpl });

    await expect(
      provider.synthesize({ text: "x", voiceId: "v1" })
    ).rejects.toMatchObject({ name: "TtsError", retryable: true });
  });

  test("throws non-retryable when the API key is missing", async () => {
    const previous = process.env.ELEVENLABS_API_KEY;
    delete process.env.ELEVENLABS_API_KEY;
    try {
      const provider = createElevenLabsProvider({ fetchImpl: vi.fn() });
      await expect(
        provider.synthesize({ text: "x", voiceId: "v1" })
      ).rejects.toMatchObject({ retryable: false });
    } finally {
      if (previous !== undefined) process.env.ELEVENLABS_API_KEY = previous;
    }
  });
});

describe("createMockTtsProvider", () => {
  test("deterministic: two calls produce identical results", async () => {
    const provider = createMockTtsProvider();
    const a = await provider.synthesize({ text: "Hello world", voiceId: "v1" });
    const b = await provider.synthesize({ text: "Hello world", voiceId: "v1" });

    expect(new Uint8Array(a.audio)).toEqual(new Uint8Array(b.audio));
    expect(a.timestamps).toEqual(b.timestamps);
    expect(a.timestamps.startSeconds[2]).toBeCloseTo(0.1);
    expect(a.timestamps.endSeconds[0]).toBeCloseTo(0.05);
    expect(a.characters).toBe("Hello world".length);
  });

  test("fail marker throws a TtsError", async () => {
    const provider = createMockTtsProvider();
    await expect(
      provider.synthesize({ text: `oops ${MOCK_TTS_FAIL_MARKER}`, voiceId: "v1" })
    ).rejects.toMatchObject({ name: "TtsError" });
  });
});
