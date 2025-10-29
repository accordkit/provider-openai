import { emitAuxiliaryFailure, emitAuxiliarySuccess } from './emitters';
import { summarizeResult, toErrorMessage } from './results';
import { beginSpan, finalizeSpan } from './span';
import { extractModel } from './types';

import type { ResolvedOpenAIOptions } from './options';
import type { Tracer } from '@accordkit/tracer';

/**
 * Instrument the OpenAI audio namespaces (`speech`, `transcriptions`, `translations`).
 *
 * Each namespace exposes a `create` method; the wrapper records spans and emits tool results
 * summarizing whether the call succeeded or failed.
 *
 * @param source The audio namespace exported by the OpenAI SDK.
 * @param tracer AccordKit tracer used to emit events.
 * @param opts Resolved adapter configuration that controls emission.
 * @returns A proxy mirroring the original namespace with instrumentation attached.
 */
export function wrapAudioApi(source: unknown, tracer: Tracer, opts: ResolvedOpenAIOptions) {
  return new Proxy(source as Record<PropertyKey, unknown>, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (value == null || typeof prop !== 'string') return value;

      if (prop === 'speech' || prop === 'transcriptions' || prop === 'translations') {
        return wrapAudioNamespace(prop, value, tracer, opts);
      }

      return value;
    },
  });
}

/**
 * Wrap a specific audio namespace (`speech`, `transcriptions`, or `translations`) so calls
 * to `create` emit tracing metadata.
 *
 * @param namespace Name of the audio namespace being wrapped.
 * @param source The namespace object exported by the SDK.
 * @param tracer AccordKit tracer used to emit events.
 * @param opts Resolved adapter configuration that controls emission.
 */
function wrapAudioNamespace(
  namespace: string,
  source: unknown,
  tracer: Tracer,
  opts: ResolvedOpenAIOptions,
) {
  if (!source || typeof source !== 'object') return source;

  const operation = `openai.audio.${namespace}.create`;

  return new Proxy(source as Record<PropertyKey, unknown>, {
    get(target, prop, receiver) {
      const original = Reflect.get(target, prop, receiver);
      if (prop !== 'create' || typeof original !== 'function') return original;

      return async function wrappedAudioCreate(this: unknown, ...args: unknown[]) {
        const start = Date.now();
        const [params] = args as [Record<string, unknown>?];
        const model = extractModel(params);

        const { spanToken, ctx } = beginSpan(tracer, opts, operation, { model });

        try {
          const result = await (original as (...a: unknown[]) => Promise<unknown>).apply(
            this,
            args,
          );

          const latencyMs = Date.now() - start;

          await emitAuxiliarySuccess({
            tracer,
            opts,
            tool: operation,
            model,
            ctx,
            latencyMs,
            output: summarizeResult(null),
          });

          await finalizeSpan(tracer, spanToken, 'ok', { latencyMs, model });
          return result;
        } catch (err) {
          const latencyMs = Date.now() - start;

          await emitAuxiliaryFailure({
            tracer,
            opts,
            tool: operation,
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
}
