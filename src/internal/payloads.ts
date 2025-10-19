/**
 * Utility payload aliases derived from the AccordKit tracer methods.
 */
import type { Tracer } from '@accordkit/tracer';

export type MessagePayload = Parameters<Tracer['message']>[0];
export type ToolCallPayload = Parameters<Tracer['toolCall']>[0];
export type ToolResultPayload = Parameters<Tracer['toolResult']>[0];
export type UsagePayload = Parameters<Tracer['usage']>[0];
