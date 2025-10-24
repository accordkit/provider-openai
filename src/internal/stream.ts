/**
 * Streaming-aware helpers for converting OpenAI responses into AccordKit events.
 */
import { ChatCompletionStream } from 'openai/resources/beta/chat/completions';

import { emitCompletionArtifacts } from './emitters';
import { summarizeResult, serializeError, toErrorMessage } from './results';

import type { ResolvedOpenAIOptions } from './options';
import type { ToolResultPayload } from './payloads';
import type { ChatCompletionLike, StreamLike } from './types';
import type { TraceContext } from '@accordkit/core';
import type { Tracer } from '@accordkit/tracer';

/**
 * Narrow an arbitrary value to the OpenAI `Stream` shape.
 */
export function isStreamLike(value: unknown): value is StreamLike {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as StreamLike;
  if (typeof candidate.finalChatCompletion === 'function') return true;
  return typeof candidate.tee === 'function' && typeof candidate.toReadableStream === 'function';
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
}: StreamArgs): StreamLike {
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
    const { streamForUser, finalPromise } = resolveFinalCompletion(stream);

    if (finalPromise) {
      void finalPromise.then(finishOk).catch(finishErr);
    } else {
      void finishOk(undefined);
    }

    return streamForUser;
  } catch (err) {
    void finishErr(err);
  }

  return stream;
}

function resolveFinalCompletion(stream: StreamLike): {
  streamForUser: StreamLike;
  finalPromise: Promise<ChatCompletionLike | undefined> | null;
} {
  if (typeof stream.finalChatCompletion === 'function') {
    try {
      return { streamForUser: stream, finalPromise: Promise.resolve(stream.finalChatCompletion()) };
    } catch {
      return { streamForUser: stream, finalPromise: null };
    }
  }

  if (typeof stream.tee === 'function' && typeof stream.toReadableStream === 'function') {
    try {
      const [observer, userStream] = stream.tee();
      const readable = observer?.toReadableStream?.();

      if (readable) {
        const runner = ChatCompletionStream.fromReadableStream(readable);
        const finalPromise = runner.finalChatCompletion() as Promise<
          ChatCompletionLike | undefined
        >;

        const finalFn = () => finalPromise;
        defineFinalCompletion(observer, finalFn);
        defineFinalCompletion(userStream, finalFn);

        return {
          streamForUser: userStream,
          finalPromise,
        };
      }
    } catch {
      // fall through to fallback
    }
  }

  return { streamForUser: stream, finalPromise: null };
}

function defineFinalCompletion(
  stream: StreamLike | undefined,
  factory: () => Promise<ChatCompletionLike | undefined>,
) {
  if (!stream || typeof stream !== 'object') return;
  try {
    Object.defineProperty(stream, 'finalChatCompletion', {
      value: factory,
      configurable: true,
      enumerable: false,
      writable: false,
    });
  } catch {
    // Ignore define failures (e.g., frozen objects)
  }
}
