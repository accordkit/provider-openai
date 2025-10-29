import {
  emitCompletionArtifacts,
  emitFailureResult,
  emitPromptMessages,
  emitSuccessResult,
} from './emitters';
import { toErrorMessage } from './results';
import { beginSpan, finalizeSpan } from './span';
import { handleStreamResult, isStreamLike } from './stream';

import type { ResolvedOpenAIOptions } from './options';
import type { ChatCompletionCreateParams, ChatCompletionLike } from './types';
import type { Tracer } from '@accordkit/tracer';

/**
 * Instrument the OpenAI `chat` namespace so completions emit AccordKit events.
 *
 * The wrapper lazily intercepts `chat.completions.create`, recording prompt, completion,
 * streaming, usage, tool result, and span data according to the configured options.
 *
 * @param source The OpenAI `chat` object to decorate.
 * @param tracer AccordKit tracer instance used to emit events.
 * @param opts Resolved adapter configuration that controls emission.
 * @returns A proxy that mirrors the original chat API with instrumentation attached.
 */
export function wrapChatApi(source: unknown, tracer: Tracer, opts: ResolvedOpenAIOptions) {
  return new Proxy(source as Record<PropertyKey, unknown>, {
    get(target, prop, receiver) {
      const chatValue = Reflect.get(target, prop, receiver);
      if (prop !== 'completions' || chatValue == null) return chatValue;

      return new Proxy(chatValue as Record<PropertyKey, unknown>, {
        get(compTarget, compProp, compReceiver) {
          const original = Reflect.get(compTarget, compProp, compReceiver);
          if (compProp !== 'create' || typeof original !== 'function') return original;

          return async function wrappedChatCreate(this: unknown, ...args: unknown[]) {
            const [maybeParams] = args as [ChatCompletionCreateParams | undefined];
            const params = maybeParams;
            const model = params?.model;
            const start = Date.now();

            const { spanToken, ctx } = beginSpan(tracer, opts, opts.operationName, {
              model,
              stream: Boolean(params?.stream),
            });

            await emitPromptMessages({
              tracer,
              opts,
              messages: params?.messages,
              ctx,
              model,
            });

            try {
              const result = await (original as (...a: unknown[]) => Promise<unknown>).apply(
                this,
                args,
              );

              if (isStreamLike(result)) {
                handleStreamResult({
                  stream: result,
                  tracer,
                  opts,
                  ctx,
                  model,
                  spanToken,
                  start,
                });
                return result;
              }

              const completion = result as ChatCompletionLike;
              await emitCompletionArtifacts({ tracer, opts, completion, ctx, model });

              const latencyMs = Date.now() - start;

              await emitSuccessResult({
                tracer,
                opts,
                completion,
                ctx,
                model,
                latencyMs,
              });

              await finalizeSpan(tracer, spanToken, 'ok', {
                latencyMs,
                model: completion.model ?? model,
              });

              return result;
            } catch (err) {
              const latencyMs = Date.now() - start;

              await emitFailureResult({
                tracer,
                opts,
                model,
                ctx,
                latencyMs,
                error: err,
              });

              await finalizeSpan(tracer, spanToken, 'error', {
                latencyMs,
                model,
                error: toErrorMessage(err),
              });

              throw err;
            }
          };
        },
      });
    },
  });
}
