/**
 * Streaming-aware helpers for converting OpenAI responses into AccordKit events.
 */
import { ChatCompletionStream } from 'openai/resources/beta/chat/completions';

import { emitCompletionArtifacts } from './emitters';
import { summarizeResult, serializeError, toErrorMessage } from './results';

import type { ResolvedOpenAIOptions } from './options';
import type { ToolResultPayload } from './payloads';
import type { ChatCompletionLike, StreamLike } from './types';
import type { Tracer, TraceContext } from '@accordkit/tracer';

/**
 * Determine whether a value fulfills the OpenAI streaming interface.
 *
 * The SDK has evolved over time, so we accept either the `finalChatCompletion` helper
 * or the lower-level `tee`/`toReadableStream` combination that powers it.
 *
 * @param value Candidate value returned from the SDK.
 * @returns True when the value exposes stream helpers we know how to use.
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
 *
 * When the stream eventually resolves, the adapter emits completion artifacts, tool results,
 * and span updates while returning a stream the caller can continue to consume.
 *
 * @param stream Original OpenAI stream returned from the SDK.
 * @param tracer AccordKit tracer that records downstream events.
 * @param opts Resolved adapter configuration that controls which events fire.
 * @param ctx Trace context associated with the request.
 * @param model Model identifier derived from the request parameters, if known.
 * @param spanToken Optional span token to close once the stream completes.
 * @param start Timestamp from when the request was initiated.
 * @returns A stream that mirrors the original while ensuring finalization hooks run.
 */
export async function handleStreamResult({
  stream,
  tracer,
  opts,
  ctx,
  model,
  spanToken,
  start,
}: StreamArgs): Promise<StreamLike> {
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

/**
 * Prepare a user-facing stream alongside a promise that resolves with the final completion.
 *
 * Some SDK variants embed `finalChatCompletion` directly while others require `tee`-ing the
 * stream and rebuilding the helper. This function hides those differences from callers.
 *
 * @param stream Stream returned by the OpenAI SDK.
 * @returns A pair containing the stream exposed to consumers and an optional final promise.
 */
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

/**
 * Ensure the provided stream exposes a `finalChatCompletion` helper that resolves once the
 * stream completes. We prefer defining a hidden property directly but fall back to a proxy
 * when the object is not extensible.
 *
 * @param stream Stream instance to augment.
 * @param factory Factory returning the promise that resolves to the final completion.
 */
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
