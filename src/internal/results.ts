/**
 * Utilities for summarizing OpenAI responses and errors for AccordKit events.
 */
import type { ChatCompletionLike } from './types';

/**
 * Produce a compact summary of an OpenAI chat completion for tool_result payloads.
 */
export function summarizeResult(result: ChatCompletionLike | null | undefined) {
  if (!result) return null;
  return {
    id: result.id,
    model: result.model,
    created: result.created,
    choices: result.choices?.map((choice) => ({
      index: choice?.index,
      finish_reason: choice?.finish_reason,
      hasMessage: Boolean(choice?.message),
    })),
    usage: result.usage,
  };
}

/**
 * Convert arbitrary thrown values into a structured error representation.
 */
export function serializeError(err: unknown) {
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      stack: err.stack,
    };
  }
  return { message: toErrorMessage(err) };
}

/**
 * Convert unknown error values into a human-readable string.
 */
export function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
