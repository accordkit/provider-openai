/**
 * Lightweight type aliases that describe the OpenAI payload shapes we consume.
 *
 * These intentionally mirror the portions of the OpenAI SDK types the adapter interacts with
 * so we can avoid a hard dependency on specific SDK versions while keeping good editor support.
 */

import type { ReadableStream } from 'openai/_shims/index';

/** Minimal subset of an OpenAI chat message consumed by the adapter. */
export interface ChatMessage {
  role?: string;
  content?: unknown;
  name?: string;
  tool_calls?: Array<ChatToolCall>;
  function_call?: LegacyFunctionCall;
  refusal?: string | null;
}

/** Tool call metadata returned inside a chat completion choice. */
export interface ChatToolCall {
  id?: string;
  type?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}

/** Legacy GPT-3.5 style function call payload embedded in a chat message. */
export interface LegacyFunctionCall {
  name?: string;
  arguments?: string;
}

/** A single choice from a chat completion response. */
export interface ChatCompletionChoice {
  index?: number;
  finish_reason?: string | null;
  message?: ChatMessage;
}

/** The portions of a chat completion used across instrumentation helpers. */
export interface ChatCompletionLike {
  id?: string;
  model?: string;
  created?: number;
  choices?: ChatCompletionChoice[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

/**
 * Simplified contract for OpenAI stream objects. Different SDK builds expose either
 * `finalChatCompletion` or generic stream utilities, so we cover both shapes.
 */
export interface StreamLike {
  finalChatCompletion?: () => Promise<ChatCompletionLike | undefined>;
  tee?: () => [StreamLike, StreamLike];
  toReadableStream?: () => ReadableStream | undefined;
}

/** Parameters accepted by the chat completions create endpoint. */
export interface ChatCompletionCreateParams {
  model?: string;
  stream?: boolean;
  messages?: ChatMessage[];
  [key: string]: unknown;
}

/** Normalized response payload used by the responses API helpers. */
export interface ResponsesResult {
  id?: string;
  model?: string;
  created?: number;
  output?: Array<
    | string
    | {
        type?: string;
        text?: string;
        content?: string;
      }
  >;
  output_text?: string;
  status?: string;
  usage?: ChatCompletionLike['usage'];
}

/**
 * Extract a string model identifier if one is present on a parameter object.
 *
 * @param params Arbitrary options passed to an OpenAI request.
 * @returns The model name when available, otherwise `undefined`.
 */
export function extractModel(params?: Record<string, unknown>): string | undefined {
  const candidate = params?.model;
  return typeof candidate === 'string' ? candidate : undefined;
}
