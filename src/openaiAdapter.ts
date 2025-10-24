import { newTraceCtx } from '@accordkit/core';
import { Tracer } from '@accordkit/tracer';

import { emitCompletionArtifacts, emitPromptMessages } from './internal/emitters';
import { resolveOptions } from './internal/options';
import { serializeError, summarizeResult, toErrorMessage } from './internal/results';
import { handleStreamResult, isStreamLike } from './internal/stream';
import { getExistingProxy, markProxy } from './internal/wrap';

import type { OpenAIAdapterOptions, ResolvedOpenAIOptions } from './internal/options';
import type { ToolResultPayload } from './internal/payloads';
import type { ChatCompletionCreateParams, ChatCompletionLike } from './internal/types';
import type { TraceContext } from '@accordkit/core';
import type OpenAI from 'openai';

/**
 * Instrument an OpenAI client so chat completions emit AccordKit trace events.
 *
 * The proxy preserves the OpenAI SDK surface while intercepting
 * `client.chat.completions.create`. Requests, completions, tool calls, usage, and
 * latency metrics are normalized into AccordKit events through the provided tracer.
 *
 * Re-wrapping the same client always returns the existing proxy to avoid duplicate
 * instrumentation.
 */
export function withOpenAI<T extends OpenAI>(
  client: T,
  tracer: Tracer,
  options: OpenAIAdapterOptions = {},
): T {
  const resolved = resolveOptions(options);

  const existing = getExistingProxy<T>(client);
  if (existing) return existing;

  const proxied = new Proxy(client, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (prop !== 'chat' || value == null) return value;

      return new Proxy(value as Record<PropertyKey, unknown>, {
        get(chatTarget, chatProp, chatReceiver) {
          const chatValue = Reflect.get(chatTarget, chatProp, chatReceiver);
          if (chatProp !== 'completions' || chatValue == null) return chatValue;

          return new Proxy(chatValue as Record<PropertyKey, unknown>, {
            get(compTarget, compProp, compReceiver) {
              const orig = Reflect.get(compTarget, compProp, compReceiver);
              if (compProp !== 'create' || typeof orig !== 'function') return orig;

              /**
               * A wrapper around the original `create` method that instruments the call.
               * It emits prompt messages, spans, tool results, and other artifacts
               * before and after invoking the original OpenAI SDK method.
               */
              return async function wrappedCreate(this: unknown, ...args: unknown[]) {
                const [maybeParams] = args as [ChatCompletionCreateParams | undefined];
                const params = maybeParams;
                const model = params?.model;
                const start = Date.now();

                const spanToken = resolved.emitSpan
                  ? tracer.spanStart({
                      operation: resolved.operationName,
                      attrs: { model, stream: Boolean(params?.stream) },
                    })
                  : null;
                const ctx: TraceContext = spanToken?.ctx ?? newTraceCtx();

                await emitPromptMessages({
                  tracer,
                  opts: resolved,
                  messages: params?.messages,
                  ctx,
                  model,
                });

                try {
                  const result = await (orig as (...a: unknown[]) => Promise<unknown>).apply(
                    this,
                    args,
                  );

                  if (isStreamLike(result)) {
                    return handleStreamResult({
                      stream: result,
                      tracer,
                      opts: resolved,
                      ctx,
                      model,
                      spanToken,
                      start,
                    });
                  }

                  const completion = result as ChatCompletionLike;
                  await emitCompletionArtifacts({ tracer, opts: resolved, completion, ctx, model });

                  const latencyMs = Date.now() - start;

                  await emitSuccessResult({
                    tracer,
                    opts: resolved,
                    completion,
                    ctx,
                    model,
                    latencyMs,
                  });

                  if (spanToken) {
                    await tracer.spanEnd(spanToken, {
                      status: 'ok',
                      attrs: {
                        latencyMs,
                        model: completion.model ?? model,
                      },
                    });
                  }

                  return result;
                } catch (err) {
                  const latencyMs = Date.now() - start;

                  await emitFailureResult({
                    tracer,
                    opts: resolved,
                    model,
                    ctx,
                    latencyMs,
                    error: err,
                  });

                  if (spanToken) {
                    await tracer.spanEnd(spanToken, {
                      status: 'error',
                      attrs: {
                        latencyMs,
                        model,
                        error: toErrorMessage(err),
                      },
                    });
                  }

                  throw err;
                }
              };
            },
          });
        },
      });
    },
  });

  markProxy(client, proxied);
  return proxied;
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
 * Emit a successful tool_result event summarizing the completion payload.
 */
async function emitSuccessResult({
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
 * Emit a failed tool_result event describing the thrown error.
 */
async function emitFailureResult({
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

export type { OpenAIAdapterOptions };
