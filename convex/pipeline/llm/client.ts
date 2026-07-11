import type { z } from "zod";
import {
  maxTokensForTask,
  modelForTask,
  type LlmModelOverrides,
  type LlmTask,
} from "./models";

/**
 * Narrow LLM interface for the extraction pipeline. All pipeline code
 * depends on `LlmClient`; OpenRouter is the sole real implementation and
 * unit tests substitute a mock. Never logs API keys, presigned URLs, or
 * page image bytes.
 */

export type LlmContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; base64Png: string };

export interface LlmCompleteInput {
  /**
   * Shared preamble (versioned prompt content). Sent as the system message
   * with an Anthropic prompt-caching breakpoint (cache_control) that
   * OpenRouter forwards; a silent no-op on other providers.
   */
  system: string;
  /** Per-call user content: text and image blocks, in order. */
  user: LlmContentBlock[];
  /** JSON schema for structured output (response_format: json_schema). */
  schemaName: string;
  jsonSchema: Record<string, unknown>;
}

export interface LlmUsage {
  model: string;
  tokensIn: number;
  tokensOut: number;
  /** Provider-reported cost in USD (OpenRouter usage accounting). */
  costUsd: number;
  latencyMs: number;
}

export interface LlmCompleteResult {
  /** Raw model output text (expected to be JSON). */
  text: string;
  usage: LlmUsage;
}

export interface LlmClient {
  complete(task: LlmTask, input: LlmCompleteInput): Promise<LlmCompleteResult>;
}

export class LlmError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean
  ) {
    super(message);
    this.name = "LlmError";
  }
}

// --- OpenRouter implementation ---

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MAX_TRANSPORT_ATTEMPTS = 4;
const BASE_BACKOFF_MS = 2_000;
const MAX_RETRY_AFTER_MS = 60_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface OpenRouterMessageContentPart {
  type: string;
  text?: string;
  image_url?: { url: string };
  cache_control?: { type: "ephemeral" };
}

function toOpenRouterContent(
  blocks: LlmContentBlock[]
): OpenRouterMessageContentPart[] {
  return blocks.map((block) =>
    block.type === "text"
      ? { type: "text", text: block.text }
      : {
          type: "image_url",
          image_url: { url: `data:image/png;base64,${block.base64Png}` },
        }
  );
}

export function createOpenRouterClient(options?: {
  apiKey?: string;
  fetchImpl?: typeof fetch;
  modelRouting?: LlmModelOverrides;
}): LlmClient {
  const apiKey = options?.apiKey ?? process.env.OPENROUTER_API_KEY;
  const fetchImpl = options?.fetchImpl ?? fetch;

  async function requestOnce(
    model: string,
    maxTokens: number,
    input: LlmCompleteInput,
    useJsonSchema: boolean
  ): Promise<Response> {
    const body = {
      model,
      // Bounds worst-case output cost; without it OpenRouter's affordability
      // check assumes the model max and 402s on credit-limited keys.
      max_tokens: maxTokens,
      // Extraction is a recognition task, not a creative one: greedy decoding
      // keeps eval runs comparable across executions.
      temperature: 0,
      messages: [
        {
          role: "system",
          content: [
            {
              type: "text",
              text: input.system,
              // Anthropic prompt-caching breakpoint; other providers ignore it.
              cache_control: { type: "ephemeral" as const },
            },
          ],
        },
        { role: "user", content: toOpenRouterContent(input.user) },
      ],
      // Actual cost comes back on the response; never computed from memory.
      usage: { include: true },
      ...(useJsonSchema
        ? {
            response_format: {
              type: "json_schema",
              json_schema: {
                name: input.schemaName,
                strict: true,
                schema: input.jsonSchema,
              },
            },
          }
        : {}),
    };
    return await fetchImpl(OPENROUTER_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        "x-title": "CounselIQ extraction pipeline",
      },
      body: JSON.stringify(body),
    });
  }

  return {
    async complete(task, input) {
      if (!apiKey) {
        throw new LlmError("OPENROUTER_API_KEY is not configured", false);
      }
      const model = modelForTask(task, options?.modelRouting);
      const maxTokens = maxTokensForTask(task);
      let useJsonSchema = true;

      for (let attempt = 1; attempt <= MAX_TRANSPORT_ATTEMPTS; attempt++) {
        const startedAt = Date.now();
        const response = await requestOnce(
          model,
          maxTokens,
          input,
          useJsonSchema
        );

        if (response.status === 429 || response.status >= 500) {
          if (attempt === MAX_TRANSPORT_ATTEMPTS) {
            throw new LlmError(
              `OpenRouter ${response.status} after ${attempt} attempts (task ${task}, model ${model})`,
              true
            );
          }
          const retryAfterHeader = response.headers.get("retry-after");
          const retryAfterMs = retryAfterHeader
            ? Math.min(Number(retryAfterHeader) * 1000, MAX_RETRY_AFTER_MS)
            : 0;
          const backoffMs = Math.max(
            retryAfterMs,
            BASE_BACKOFF_MS * 2 ** (attempt - 1)
          );
          await sleep(backoffMs);
          continue;
        }

        if (!response.ok) {
          const errorText = (await response.text()).slice(0, 500);
          // Some models reject response_format: json_schema (or choke on
          // parts of the generated schema, e.g. "reference to undefined
          // schema"); fall back to a plain request once — the Zod parse
          // downstream is the enforcement.
          if (
            useJsonSchema &&
            response.status === 400 &&
            /response_format|json_schema|structured|schema/i.test(errorText)
          ) {
            useJsonSchema = false;
            continue;
          }
          throw new LlmError(
            `OpenRouter ${response.status} (task ${task}, model ${model}): ${errorText}`,
            false
          );
        }

        const payload = (await response.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
          usage?: {
            prompt_tokens?: number;
            completion_tokens?: number;
            cost?: number;
          };
          model?: string;
        };
        const text = payload.choices?.[0]?.message?.content;
        if (typeof text !== "string" || text === "") {
          throw new LlmError(
            `OpenRouter returned no content (task ${task}, model ${model})`,
            true
          );
        }
        return {
          text,
          usage: {
            model: payload.model ?? model,
            tokensIn: payload.usage?.prompt_tokens ?? 0,
            tokensOut: payload.usage?.completion_tokens ?? 0,
            costUsd: payload.usage?.cost ?? 0,
            latencyMs: Date.now() - startedAt,
          },
        };
      }
      throw new LlmError(`OpenRouter retries exhausted (task ${task})`, true);
    },
  };
}

// --- Structured completion: Zod parse is the enforcement ---

/** Strips markdown code fences some models wrap around JSON output. */
function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/);
  return fenced ? fenced[1] : trimmed;
}

export interface StructuredCompletion<T> {
  value: T;
  usages: LlmUsage[];
}

/**
 * Calls the LLM and validates the response against the Zod schema. Provider
 * json_schema support varies, so the Zod parse is the enforcement: a failed
 * parse retries ONCE with the validator errors appended, then throws with
 * cause. Returns every usage record so all calls are cost-accounted.
 */
export async function completeStructured<T>(
  client: LlmClient,
  task: LlmTask,
  input: LlmCompleteInput,
  // Input type is deliberately unknown: wire schemas may preprocess/coerce.
  zodSchema: z.ZodType<T, z.ZodTypeDef, unknown>
): Promise<StructuredCompletion<T>> {
  const usages: LlmUsage[] = [];

  const attemptParse = (
    text: string
  ): { ok: true; value: T } | { ok: false; error: string } => {
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(stripCodeFence(text));
    } catch (error) {
      return { ok: false, error: `invalid JSON: ${String(error)}` };
    }
    const result = zodSchema.safeParse(parsedJson);
    if (result.success) return { ok: true, value: result.data };
    return {
      ok: false,
      error: JSON.stringify(result.error.issues.slice(0, 10)),
    };
  };

  const first = await client.complete(task, input);
  usages.push(first.usage);
  const firstParse = attemptParse(first.text);
  if (firstParse.ok) return { value: firstParse.value, usages };

  const retryInput: LlmCompleteInput = {
    ...input,
    user: [
      ...input.user,
      {
        type: "text",
        text:
          `Your previous response failed schema validation with these errors:\n` +
          `${firstParse.error}\n` +
          `Respond again with ONLY valid JSON matching the required schema.`,
      },
    ],
  };
  const second = await client.complete(task, retryInput);
  usages.push(second.usage);
  const secondParse = attemptParse(second.text);
  if (secondParse.ok) return { value: secondParse.value, usages };

  throw new LlmError(
    `structured output failed validation after retry (task ${task}): ${secondParse.error}`,
    false
  );
}
