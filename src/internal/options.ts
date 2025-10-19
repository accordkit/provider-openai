/**
 * Option resolution utilities for the OpenAI adapter.
 */
import type { Provider } from '@accordkit/core';

/**
 * Configuration knobs for {@link withOpenAI}, allowing callers to tune which
 * AccordKit events the adapter emits and how they are labeled.
 */
export interface OpenAIAdapterOptions {
  /**
   * Provider identifier attached to emitted events. Defaults to `'openai'`.
   * Override if you proxy OpenAI behind another service and want distinct labeling.
   */
  provider?: Provider;
  /**
   * Operation name recorded on `tool_result`/`span` events. Defaults to
   * `'openai.chat.completions.create'`.
   */
  operationName?: string;
  /**
   * Emit `message` events for user/system prompts before the API call executes.
   * Enabled by default.
   */
  emitPrompts?: boolean;
  /**
   * Emit `message` events for assistant completions returned by OpenAI.
   * Enabled by default.
   */
  emitResponses?: boolean;
  /**
   * Emit `tool_call` events for function/tool invocations requested by the assistant.
   * Enabled by default.
   */
  emitToolCalls?: boolean;
  /**
   * Emit `usage` events when OpenAI reports token accounting information.
   * Enabled by default.
   */
  emitUsage?: boolean;
  /**
   * Emit `tool_result` events summarizing request latency and outcome (success/error).
   * Enabled by default.
   */
  emitToolResults?: boolean;
  /**
   * Emit a `span` event around each API invocation capturing duration and status.
   * Enabled by default.
   */
  emitSpan?: boolean;
}

export interface ResolvedOpenAIOptions {
  provider: Provider;
  operationName: string;
  emitPrompts: boolean;
  emitResponses: boolean;
  emitToolCalls: boolean;
  emitUsage: boolean;
  emitToolResults: boolean;
  emitSpan: boolean;
}

const DEFAULT_OPTIONS: ResolvedOpenAIOptions = {
  provider: 'openai',
  operationName: 'openai.chat.completions.create',
  emitPrompts: true,
  emitResponses: true,
  emitToolCalls: true,
  emitUsage: true,
  emitToolResults: true,
  emitSpan: true,
};

/**
 * Merge user-provided options with defaults.
 */
export function resolveOptions(
  options: OpenAIAdapterOptions | undefined,
): ResolvedOpenAIOptions {
  return { ...DEFAULT_OPTIONS, ...(options ?? {}) };
}
