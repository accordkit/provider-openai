import { newTraceCtx, type TraceContext, type Tracer } from '@accordkit/tracer';

import type { ResolvedOpenAIOptions } from './options';

export type SpanToken = ReturnType<Tracer['spanStart']>;

/**
 * Start a span when span emission is enabled and return the associated trace context.
 *
 * @param tracer AccordKit tracer used to start spans.
 * @param opts Resolved adapter configuration.
 * @param operation Operation name recorded on the span.
 * @param attrs Optional attributes attached at span start.
 * @returns The span token (or `null` when spans are disabled) and the context to reuse.
 */
export function beginSpan(
  tracer: Tracer,
  opts: ResolvedOpenAIOptions,
  operation: string,
  attrs?: Record<string, unknown>,
): { spanToken: SpanToken | null; ctx: TraceContext } {
  if (!opts.emitSpan) {
    return { spanToken: null, ctx: newTraceCtx() };
  }

  const spanToken = tracer.spanStart({ operation, attrs });
  return { spanToken, ctx: spanToken.ctx };
}

/**
 * Finish a span if one was started.
 *
 * @param tracer AccordKit tracer used to end spans.
 * @param spanToken Token returned by {@link beginSpan}.
 * @param status Status to record on the span.
 * @param attrs Attributes captured at span completion.
 */
export async function finalizeSpan(
  tracer: Tracer,
  spanToken: SpanToken | null,
  status: 'ok' | 'error',
  attrs: Record<string, unknown>,
): Promise<void> {
  if (!spanToken) return;
  await tracer.spanEnd(spanToken, { status, attrs });
}
