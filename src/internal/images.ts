import { emitAuxiliaryFailure, emitAuxiliarySuccess } from './emitters';
import { summarizeResult, toErrorMessage } from './results';
import { beginSpan, finalizeSpan } from './span';
import { extractModel } from './types';

import type { ResolvedOpenAIOptions } from './options';
import type { Tracer } from '@accordkit/tracer';

/**
 * Instrument the OpenAI images namespace so `generate` calls emit tracing metadata.
 *
 * @param source The images namespace exported by the OpenAI SDK.
 * @param tracer AccordKit tracer used to emit events.
 * @param opts Resolved adapter configuration that controls emission.
 * @returns A proxy mirroring the original namespace with instrumentation attached.
 */
export function wrapImagesApi(source: unknown, tracer: Tracer, opts: ResolvedOpenAIOptions) {
  return new Proxy(source as Record<PropertyKey, unknown>, {
    get(target, prop, receiver) {
      const original = Reflect.get(target, prop, receiver);
      if (prop !== 'generate' || typeof original !== 'function') return original;

      return async function wrappedImagesGenerate(this: unknown, ...args: unknown[]) {
        const start = Date.now();
        const [params] = args as [Record<string, unknown>?];
        const model = extractModel(params);

        const { spanToken, ctx } = beginSpan(tracer, opts, 'openai.images.generate', { model });

        try {
          const result = await (original as (...a: unknown[]) => Promise<unknown>).apply(
            this,
            args,
          );

          const latencyMs = Date.now() - start;

          await emitAuxiliarySuccess({
            tracer,
            opts,
            tool: 'openai.images.generate',
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
            tool: 'openai.images.generate',
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
