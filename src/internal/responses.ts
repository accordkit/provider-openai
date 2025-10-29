import {
  emitAuxiliaryFailure,
  emitAuxiliarySuccess,
  emitCompletionArtifacts,
} from './emitters';
import { summarizeResult, toErrorMessage } from './results';
import { beginSpan, finalizeSpan } from './span';
import { extractModel } from './types';

import type { ResolvedOpenAIOptions } from './options';
import type { ChatCompletionLike, ResponsesResult } from './types';
import type { Tracer } from '@accordkit/tracer';

/**
 * Instrument the OpenAI responses API so calls emit the same AccordKit events as chat completions.
 *
 * @param source The responses namespace exported by the OpenAI SDK.
 * @param tracer AccordKit tracer used to emit events.
 * @param opts Resolved adapter configuration that controls emission.
 * @returns A proxy mirroring the original namespace with instrumentation attached.
 */
export function wrapResponsesApi(
  source: unknown,
  tracer: Tracer,
  opts: ResolvedOpenAIOptions,
) {
  return new Proxy(source as Record<PropertyKey, unknown>, {
    get(target, prop, receiver) {
      const original = Reflect.get(target, prop, receiver);
      if (prop !== 'create' || typeof original !== 'function') return original;

      return async function wrappedResponsesCreate(this: unknown, ...args: unknown[]) {
        const start = Date.now();
        const [params] = args as [Record<string, unknown>?];
        const model = extractModel(params);

        const { spanToken, ctx } = beginSpan(tracer, opts, 'openai.responses.create', { model });

        try {
          const result = await (original as (...a: unknown[]) => Promise<ResponsesResult>).apply(
            this,
            args,
          );

          const completion = coerceResponsesToChatCompletion(result);
          if (completion) {
            await emitCompletionArtifacts({ tracer, opts, completion, ctx, model });
          }

          const latencyMs = Date.now() - start;

          await emitAuxiliarySuccess({
            tracer,
            opts,
            tool: 'openai.responses.create',
            model,
            ctx,
            latencyMs,
            output: summarizeResult(completion ?? null),
          });

          await finalizeSpan(tracer, spanToken, 'ok', { latencyMs, model });
          return result;
        } catch (err) {
          const latencyMs = Date.now() - start;

          await emitAuxiliaryFailure({
            tracer,
            opts,
            tool: 'openai.responses.create',
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

/**
 * Convert the responses API result shape into the chat completion structure expected by existing emitters.
 *
 * @param res Response payload returned by the OpenAI SDK.
 * @returns A pseudo chat completion compatible with the chat instrumentation helpers.
 */
function coerceResponsesToChatCompletion(
  res: ResponsesResult | undefined,
): ChatCompletionLike | undefined {
  if (!res) return undefined;

  try {
    const textParts = Array.isArray(res.output)
      ? res.output
          .map((part) => normalizeOutputPart(part))
          .join('')
      : res.output_text || '';

    return {
      id: res.id,
      model: res.model,
      created: res.created || Math.floor(Date.now() / 1000),
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: textParts },
          finish_reason: res.status || 'stop',
        },
      ],
      usage: res.usage,
    };
  } catch {
    return undefined;
  }
}

/**
 * Normalize the polymorphic `response.output` entries into a plain string.
 */
function normalizeOutputPart(
  part:
    | string
    | {
        type?: string;
        text?: string;
        content?: string;
      },
): string {
  if (typeof part === 'string') return part;

  if (part?.type === 'output_text' && typeof part.text === 'string') {
    return part.text;
  }

  if (typeof part?.content === 'string') {
    return part.content;
  }

  return '';
}
