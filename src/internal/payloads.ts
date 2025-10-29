/**
 * Strongly typed aliases for the payloads accepted by the AccordKit tracer.
 *
 * Re-exporting these shapes keeps the adapter aligned with upstream tracer
 * typings without duplicating the event definitions locally.
 */
import type { Tracer } from '@accordkit/tracer';

export type MessagePayload = Parameters<Tracer['message']>[0];
export type ToolCallPayload = Parameters<Tracer['toolCall']>[0];
export type ToolResultPayload = Parameters<Tracer['toolResult']>[0];
export type UsagePayload = Parameters<Tracer['usage']>[0];
