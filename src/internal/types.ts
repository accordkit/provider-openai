/**
 * Lightweight type aliases that describe the OpenAI payload shapes we consume.
 */

import type { ReadableStream } from 'openai/_shims/index';

export interface ChatMessage {
  role?: string;
  content?: unknown;
  name?: string;
  tool_calls?: Array<ChatToolCall>;
  function_call?: LegacyFunctionCall;
  refusal?: string | null;
}

export interface ChatToolCall {
  id?: string;
  type?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}

export interface LegacyFunctionCall {
  name?: string;
  arguments?: string;
}

export interface ChatCompletionChoice {
  index?: number;
  finish_reason?: string | null;
  message?: ChatMessage;
}

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

export interface StreamLike {
  finalChatCompletion?: () => Promise<ChatCompletionLike | undefined>;
  tee?: () => [StreamLike, StreamLike];
  toReadableStream?: () => ReadableStream | undefined;
}

export interface ChatCompletionCreateParams {
  model?: string;
  stream?: boolean;
  messages?: ChatMessage[];
  [key: string]: unknown;
}
