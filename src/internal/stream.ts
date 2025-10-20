/**
 * Streaming-aware helpers for converting OpenAI responses into AccordKit events.
 */
import { emitCompletionArtifacts } from './emitters.js';
import { summarizeResult, serializeError, toErrorMessage } from './results.js';

import type { ResolvedOpenAIOptions } from './options.js';
import type { ToolResultPayload } from './payloads.js';
import type { ChatCompletionLike, StreamLike } from './types.js';
import type { TraceContext } from '@accordkit/core';
import type { Tracer } from '@accordkit/tracer';

/**
 * Narrow an arbitrary value to the OpenAI `Stream` shape.
 */
export function isStreamLike(value: unknown): value is StreamLike {
  if (!value || typeof value !== 'object' || !('finalChatCompletion' in value)) {
    return false;
  }
  const candidate = value as { finalChatCompletion?: unknown };
  return typeof candidate.finalChatCompletion === 'function';
}

interface StreamArgs {
  stream: StreamLike;
  tracer: Tracer;
  opts: ResolvedOpenAIOptions;
  ctx: TraceContext;
  model?: string;
  spanToken: ReturnType<Tracer['spanStart']> | null;
  start: number;
}

/**
 * Attach completion/result handlers to an OpenAI stream to emit AccordKit events.
 */
export function handleStreamResult({
  stream,
  tracer,
  opts,
  ctx,
  model,
  spanToken,
  start,
}: StreamArgs): void {
  const finishOk = async (completion: ChatCompletionLike | undefined) => {
    await emitCompletionArtifacts({ tracer, opts, completion, ctx, model });

    const latencyMs = Date.now() - start;
    if (opts.emitToolResults) {
      const payload: ToolResultPayload = {
        provider: opts.provider,
        model: completion?.model ?? model,
        requestId: completion?.id,
        tool: opts.operationName,
        output: summarizeResult(completion),
        ok: true,
        latencyMs,
        ctx,
      };
      await tracer.toolResult(payload);
    }

    if (spanToken) {
      await tracer.spanEnd(spanToken, {
        status: 'ok',
        attrs: { latencyMs, model: completion?.model ?? model, stream: true },
      });
    }
  };

  const finishErr = async (err: unknown) => {
    const latencyMs = Date.now() - start;

    if (opts.emitToolResults) {
      const payload: ToolResultPayload = {
        provider: opts.provider,
        model,
        tool: opts.operationName,
        output: serializeError(err),
        ok: false,
        latencyMs,
        ctx,
      };
      await tracer.toolResult(payload);
    }

    if (spanToken) {
      await tracer.spanEnd(spanToken, {
        status: 'error',
        attrs: { latencyMs, model, stream: true, error: toErrorMessage(err) },
      });
    }
  };

  try {
    if (typeof stream.finalChatCompletion === 'function') {
      const result = stream.finalChatCompletion();
      if (result && typeof (result as Promise<unknown>).then === 'function') {
        (result as Promise<ChatCompletionLike | undefined>)
          .then(finishOk)
          .catch(finishErr);
      } else {
        void finishOk(undefined);
      }
    } else {
      void finishOk(undefined);
    }
  } catch (err) {
    void finishErr(err);
  }
}
