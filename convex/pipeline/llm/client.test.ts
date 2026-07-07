// @vitest-environment node
import { describe, expect, test, vi } from "vitest";
import { z } from "zod";
import {
  LlmError,
  completeStructured,
  createOpenRouterClient,
  type LlmClient,
  type LlmCompleteInput,
} from "./client";
import { currentModelRouting, modelForTask } from "./models";

const INPUT: LlmCompleteInput = {
  system: "preamble",
  user: [{ type: "text", text: "hello" }],
  schemaName: "test_schema",
  jsonSchema: { type: "object" },
};

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function okCompletion(content: string) {
  return jsonResponse({
    model: "google/gemini-2.5-flash",
    choices: [{ message: { content } }],
    usage: { prompt_tokens: 100, completion_tokens: 20, cost: 0.00042 },
  });
}

describe("models routing", () => {
  test("defaults to gemini-2.5-flash for every task", () => {
    expect(modelForTask("extract-page")).toBe("google/gemini-2.5-flash");
    expect(currentModelRouting()["merge-inventory"]).toBe(
      "google/gemini-2.5-flash"
    );
  });

  test("env override wins", () => {
    process.env.MODEL_EXTRACT_PAGE = "anthropic/claude-sonnet-4.5";
    try {
      expect(modelForTask("extract-page")).toBe("anthropic/claude-sonnet-4.5");
      expect(modelForTask("infer-theme")).toBe("google/gemini-2.5-flash");
    } finally {
      delete process.env.MODEL_EXTRACT_PAGE;
    }
  });
});

describe("createOpenRouterClient", () => {
  test("returns text and provider-reported usage", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okCompletion('{"a":1}'));
    const client = createOpenRouterClient({ apiKey: "sk-test", fetchImpl });

    const result = await client.complete("extract-page", INPUT);

    expect(result.text).toBe('{"a":1}');
    expect(result.usage.tokensIn).toBe(100);
    expect(result.usage.tokensOut).toBe(20);
    expect(result.usage.costUsd).toBeCloseTo(0.00042);
    expect(result.usage.model).toBe("google/gemini-2.5-flash");

    const [, requestInit] = fetchImpl.mock.calls[0];
    const body = JSON.parse(requestInit.body);
    expect(body.usage).toEqual({ include: true });
    expect(body.max_tokens).toBe(4096);
    expect(body.response_format.type).toBe("json_schema");
    expect(body.messages[0].content[0].cache_control).toEqual({
      type: "ephemeral",
    });
  });

  test("sends image blocks as data-url image_url parts", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okCompletion("{}"));
    const client = createOpenRouterClient({ apiKey: "sk-test", fetchImpl });

    await client.complete("extract-page", {
      ...INPUT,
      user: [
        { type: "image", base64Png: "AAAA" },
        { type: "text", text: "extract" },
      ],
    });

    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.messages[1].content[0]).toEqual({
      type: "image_url",
      image_url: { url: "data:image/png;base64,AAAA" },
    });
  });

  test("respects retry-after on 429 then succeeds", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(
          new Response("rate limited", {
            status: 429,
            headers: { "retry-after": "1" },
          })
        )
        .mockResolvedValueOnce(okCompletion('{"ok":true}'));
      const client = createOpenRouterClient({ apiKey: "sk-test", fetchImpl });

      const promise = client.complete("extract-page", INPUT);
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.text).toBe('{"ok":true}');
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  test("throws retryable LlmError when retries are exhausted", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi
        .fn()
        .mockResolvedValue(new Response("boom", { status: 500 }));
      const client = createOpenRouterClient({ apiKey: "sk-test", fetchImpl });

      const promise = client.complete("extract-page", INPUT);
      const assertion = expect(promise).rejects.toMatchObject({
        name: "LlmError",
        retryable: true,
      });
      await vi.runAllTimersAsync();
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  test("falls back to no response_format when the model rejects json_schema", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("response_format json_schema unsupported", {
          status: 400,
        })
      )
      .mockResolvedValueOnce(okCompletion('{"ok":true}'));
    const client = createOpenRouterClient({ apiKey: "sk-test", fetchImpl });

    await client.complete("extract-page", INPUT);

    const secondBody = JSON.parse(fetchImpl.mock.calls[1][1].body);
    expect(secondBody.response_format).toBeUndefined();
  });

  test("throws non-retryable when the API key is missing", async () => {
    const previous = process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    try {
      const client = createOpenRouterClient({ fetchImpl: vi.fn() });
      await expect(client.complete("extract-page", INPUT)).rejects.toThrow(
        LlmError
      );
    } finally {
      if (previous !== undefined) process.env.OPENROUTER_API_KEY = previous;
    }
  });
});

describe("completeStructured", () => {
  const schema = z.object({ answer: z.number() });

  function mockClient(responses: string[]): {
    client: LlmClient;
    calls: LlmCompleteInput[];
  } {
    const calls: LlmCompleteInput[] = [];
    let i = 0;
    return {
      calls,
      client: {
        async complete(_task, input) {
          calls.push(input);
          const text = responses[Math.min(i, responses.length - 1)];
          i += 1;
          return {
            text,
            usage: {
              model: "mock",
              tokensIn: 10,
              tokensOut: 5,
              costUsd: 0.001,
              latencyMs: 1,
            },
          };
        },
      },
    };
  }

  test("parses valid JSON on the first attempt", async () => {
    const { client } = mockClient(['{"answer": 42}']);
    const result = await completeStructured(
      client,
      "extract-page",
      INPUT,
      schema
    );
    expect(result.value).toEqual({ answer: 42 });
    expect(result.usages).toHaveLength(1);
  });

  test("strips markdown code fences", async () => {
    const { client } = mockClient(['```json\n{"answer": 7}\n```']);
    const result = await completeStructured(
      client,
      "extract-page",
      INPUT,
      schema
    );
    expect(result.value).toEqual({ answer: 7 });
  });

  test("retries once with validator errors appended, then succeeds", async () => {
    const { client, calls } = mockClient([
      '{"answer": "not-a-number"}',
      '{"answer": 3}',
    ]);
    const result = await completeStructured(
      client,
      "extract-page",
      INPUT,
      schema
    );
    expect(result.value).toEqual({ answer: 3 });
    expect(result.usages).toHaveLength(2);
    const retryText = calls[1].user.at(-1);
    expect(retryText?.type).toBe("text");
    expect((retryText as { text: string }).text).toContain(
      "failed schema validation"
    );
  });

  test("fails with cause after the single retry", async () => {
    const { client } = mockClient(["not json at all"]);
    await expect(
      completeStructured(client, "extract-page", INPUT, schema)
    ).rejects.toThrow(/failed validation after retry/);
  });
});
