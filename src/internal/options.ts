/**
 * Option resolution utilities for the OpenAI adapter.
 *
 * The adapter exposes a small set of switches that control which OpenAI APIs are wrapped
 * and which AccordKit events are emitted. These helpers consolidate the runtime defaults
 * in one place so consumers and tests can rely on consistent behaviour.
 */
import type { Provider } from '@accordkit/tracer';

/**
 * Configuration knobs for {@link withOpenAI}, allowing callers to tune which AccordKit events
 * the adapter emits and how they are labeled.
 */
export interface OpenAIAdapterOptions {
  /** Enable instrumentation for the Responses API (responses.create/stream). */
  enableResponsesApi?: boolean;
  /** Enable instrumentation for Images API (images.generate). */
  enableImagesApi?: boolean;
  /** Enable instrumentation for Audio API (audio.speech/transcriptions/translations). */
  enableAudioApi?: boolean;
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

/**
 * Fully resolved configuration with defaults applied. Keeping this separate from the public
 * interface simplifies option handling and provides a single source of truth for downstream
 * helpers that expect booleans.
 */
export interface ResolvedOpenAIOptions {
  enableResponsesApi: boolean;
  enableImagesApi: boolean;
  enableAudioApi: boolean;
  provider: Provider;
  operationName: string;
  emitPrompts: boolean;
  emitResponses: boolean;
  emitToolCalls: boolean;
  emitUsage: boolean;
  emitToolResults: boolean;
  emitSpan: boolean;
}

/**
 * Default instrumentation strategy used when callers do not supply explicit options.
 */
const DEFAULT_OPTIONS: ResolvedOpenAIOptions = {
  enableResponsesApi: false,
  enableImagesApi: false,
  enableAudioApi: false,
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
 *
 * @param options Partial configuration supplied by the caller.
 * @returns A concrete configuration object with all switches resolved.
 */
export function resolveOptions(
  options: OpenAIAdapterOptions | undefined,
): ResolvedOpenAIOptions {
  return { ...DEFAULT_OPTIONS, ...(options ?? {}) };
}
