/**
 * Helpers for transforming OpenAI payloads into AccordKit tracing events.
 *
 * Each function focuses on translating a specific OpenAI response shape into the normalized
 * AccordKit event contracts so downstream tooling receives consistent metadata.
 */

import {
  normalizeContent,
  safeParseJSON,
  toMessageRole,
  type NormalizedContent,
} from './normalize';
import {
  type MessagePayload,
  type ToolCallPayload,
  type ToolResultPayload,
  type UsagePayload,
} from './payloads';
import { serializeError, summarizeResult } from './results';

import type { ResolvedOpenAIOptions } from './options';
import type { ChatCompletionChoice, ChatCompletionLike, ChatMessage } from './types';
import type { TraceContext } from '@accordkit/tracer';
import type { Tracer } from '@accordkit/tracer';

interface PromptArgs {
  tracer: Tracer;
  opts: ResolvedOpenAIOptions;
  messages?: ChatMessage[];
  ctx: TraceContext;
  model?: string;
}

/**
 * Emit `message` events for input prompts prior to invoking the OpenAI API.
 *
 * @param tracer AccordKit tracer used for emission.
 * @param opts Resolved adapter configuration.
 * @param messages Prompt messages supplied to the OpenAI request.
 * @param ctx Trace context associated with the request span.
 * @param model Optional model identifier already known for the request.
 */
export async function emitPromptMessages({
  tracer,
  opts,
  messages,
  ctx,
  model,
}: PromptArgs): Promise<void> {
  if (!opts.emitPrompts || !Array.isArray(messages)) return;

  for (const msg of messages) {
    const normalized = normalizeContent(msg.content);
    const payload = buildMessagePayload({
      provider: opts.provider,
      model,
      role: toMessageRole(msg.role, 'user'),
      normalized,
      ctx,
      name: msg.name,
    });
    await tracer.message(payload);
  }
}

interface CompletionArgs {
  tracer: Tracer;
  opts: ResolvedOpenAIOptions;
  completion: ChatCompletionLike | null | undefined;
  ctx: TraceContext;
  model?: string;
}

/**
 * Emit normalized events derived from a chat completion response.
 *
 * @param tracer AccordKit tracer used for emission.
 * @param opts Resolved adapter configuration.
 * @param completion Completion payload returned by the OpenAI SDK.
 * @param ctx Trace context associated with the request span.
 * @param model Optional model hint associated with the request.
 */
export async function emitCompletionArtifacts({
  tracer,
  opts,
  completion,
  ctx,
  model,
}: CompletionArgs): Promise<void> {
  if (!completion) return;

  const resolvedModel = completion.model ?? model;
  const requestId = completion.id;

  if (opts.emitResponses && Array.isArray(completion.choices)) {
    for (const choice of completion.choices) {
      await emitChoice({ choice, tracer, opts, ctx, resolvedModel, requestId });
    }
  }

  if (opts.emitUsage && completion.usage) {
    const usagePayload: UsagePayload = {
      provider: opts.provider,
      model: resolvedModel,
      requestId,
      inputTokens: completion.usage.prompt_tokens,
      outputTokens: completion.usage.completion_tokens,
      ctx,
    };
    if (completion.usage.total_tokens !== undefined) {
      usagePayload.$ext = { totalTokens: completion.usage.total_tokens };
    }

    await tracer.usage(usagePayload);
  }
}

/**
 * Emit assistant message/tool metadata for a single completion choice.
 */
async function emitChoice({
  choice,
  tracer,
  opts,
  ctx,
  resolvedModel,
  requestId,
}: {
  choice: ChatCompletionChoice;
  tracer: Tracer;
  opts: ResolvedOpenAIOptions;
  ctx: TraceContext;
  resolvedModel?: string;
  requestId?: string;
}) {
  const message = choice?.message;
  if (!message) return;

  if (opts.emitResponses) {
    const normalized = normalizeContent(message.content);
    if (normalized.content) {
      const payload = buildMessagePayload({
        provider: opts.provider,
        model: resolvedModel,
        role: toMessageRole(message.role, 'assistant'),
        normalized,
        ctx,
        requestId,
      });
      await tracer.message(payload);
    }
  }

  if (!opts.emitToolCalls) return;
  if (Array.isArray(message.tool_calls)) {
    for (const call of message.tool_calls) {
      const fn = call?.function;
      if (!fn?.name) continue;

      const toolPayload: ToolCallPayload = {
        provider: opts.provider,
        model: resolvedModel,
        tool: fn.name,
        input: safeParseJSON(fn.arguments),
        ctx,
        requestId,
        $ext: { id: call?.id, finishReason: choice?.finish_reason },
      };
      await tracer.toolCall(toolPayload);
    }
  }

  if (message.function_call?.name) {
    const legacyPayload: ToolCallPayload = {
      provider: opts.provider,
      model: resolvedModel,
      tool: message.function_call.name,
      input: safeParseJSON(message.function_call.arguments),
      ctx,
      requestId,
      $ext: { finishReason: choice?.finish_reason },
    };
    await tracer.toolCall(legacyPayload);
  }
}

interface MessagePayloadArgs {
  provider: MessagePayload['provider'];
  model?: string;
  role: MessagePayload['role'];
  normalized: NormalizedContent;
  ctx: TraceContext;
  requestId?: string;
  name?: string;
}

/**
 * Build a strongly typed `message` payload with optional format/name metadata.
 */
function buildMessagePayload({
  provider,
  model,
  role,
  normalized,
  ctx,
  requestId,
  name,
}: MessagePayloadArgs): MessagePayload {
  const payload: MessagePayload = {
    provider,
    model,
    role,
    content: normalized.content,
    ctx,
  };

  if (normalized.format) payload.format = normalized.format;
  if (requestId) payload.requestId = requestId;
  if (name) payload.$ext = { name };

  return payload;
}

interface EmitSuccessArgs {
  tracer: Tracer;
  opts: ResolvedOpenAIOptions;
  completion: ChatCompletionLike;
  ctx: TraceContext;
  model?: string;
  latencyMs: number;
}

/**
 * Emit a successful `tool_result` event summarizing the completion payload.
 *
 * @param tracer AccordKit tracer used for emission.
 * @param opts Resolved adapter configuration.
 * @param completion Completion payload returned by the OpenAI SDK.
 * @param ctx Trace context associated with the request span.
 * @param model Optional model hint associated with the request.
 * @param latencyMs Measured request latency in milliseconds.
 */
export async function emitSuccessResult({
  tracer,
  opts,
  completion,
  ctx,
  model,
  latencyMs,
}: EmitSuccessArgs): Promise<void> {
  if (!opts.emitToolResults) return;

  const payload: ToolResultPayload = {
    provider: opts.provider,
    model: completion.model ?? model,
    requestId: completion.id,
    tool: opts.operationName,
    output: summarizeResult(completion),
    ok: true,
    latencyMs,
    ctx,
  };
  await tracer.toolResult(payload);
}

interface EmitFailureArgs {
  tracer: Tracer;
  opts: ResolvedOpenAIOptions;
  model?: string;
  ctx: TraceContext;
  latencyMs: number;
  error: unknown;
}

/**
 * Emit a failed `tool_result` event describing the thrown error.
 *
 * @param tracer AccordKit tracer used for emission.
 * @param opts Resolved adapter configuration.
 * @param model Optional model hint associated with the request.
 * @param ctx Trace context associated with the request span.
 * @param latencyMs Measured request latency in milliseconds.
 * @param error The error thrown by the OpenAI SDK or user code.
 */
export async function emitFailureResult({
  tracer,
  opts,
  model,
  ctx,
  latencyMs,
  error,
}: EmitFailureArgs): Promise<void> {
  if (!opts.emitToolResults) return;

  const payload: ToolResultPayload = {
    provider: opts.provider,
    model,
    tool: opts.operationName,
    output: serializeError(error),
    ok: false,
    latencyMs,
    ctx,
  };
  await tracer.toolResult(payload);
}

interface EmitAuxiliarySuccessArgs {
  tracer: Tracer;
  opts: ResolvedOpenAIOptions;
  model?: string;
  ctx: TraceContext;
  latencyMs: number;
  tool: string;
  output: unknown;
}

/**
 * Emit a successful `tool_result` for auxiliary OpenAI endpoints (responses, images, audio).
 *
 * @param tracer AccordKit tracer used for emission.
 * @param opts Resolved adapter configuration.
 * @param tool Logical operation name (e.g., `openai.images.generate`).
 * @param model Optional model hint associated with the request.
 * @param ctx Trace context associated with the request span.
 * @param latencyMs Measured request latency in milliseconds.
 * @param output Normalized payload to attach to the event.
 */
export async function emitAuxiliarySuccess({
  tracer,
  opts,
  tool,
  model,
  ctx,
  latencyMs,
  output,
}: EmitAuxiliarySuccessArgs): Promise<void> {
  if (!opts.emitToolResults) return;

  await tracer.toolResult({
    provider: opts.provider,
    model,
    tool,
    output,
    ok: true,
    latencyMs,
    ctx,
  });
}

interface EmitAuxiliaryFailureArgs {
  tracer: Tracer;
  opts: ResolvedOpenAIOptions;
  model?: string;
  ctx: TraceContext;
  latencyMs: number;
  tool: string;
  error: unknown;
}

/**
 * Emit a failed `tool_result` for auxiliary OpenAI endpoints (responses, images, audio).
 *
 * @param tracer AccordKit tracer used for emission.
 * @param opts Resolved adapter configuration.
 * @param tool Logical operation name (e.g., `openai.images.generate`).
 * @param model Optional model hint associated with the request.
 * @param ctx Trace context associated with the request span.
 * @param latencyMs Measured request latency in milliseconds.
 * @param error The error thrown by the OpenAI SDK or user code.
 */
export async function emitAuxiliaryFailure({
  tracer,
  opts,
  tool,
  model,
  ctx,
  latencyMs,
  error,
}: EmitAuxiliaryFailureArgs): Promise<void> {
  if (!opts.emitToolResults) return;

  await tracer.toolResult({
    provider: opts.provider,
    model,
    tool,
    output: serializeError(error),
    ok: false,
    latencyMs,
    ctx,
  });
}
