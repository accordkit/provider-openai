/**
 * Utilities for coercing OpenAI chat content into normalized AccordKit fields.
 */
import type { MessagePayload } from './payloads.js';

export type NormalizedContent = {
  content: string;
  format?: MessagePayload['format'];
};

const MESSAGE_ROLES: ReadonlyArray<MessagePayload['role']> = [
  'system',
  'user',
  'assistant',
  'tool',
];

/**
 * Ensure an arbitrary role value aligns with the AccordKit message role enum.
 */
export function toMessageRole(
  value: unknown,
  fallback: MessagePayload['role'] = 'user',
): MessagePayload['role'] {
  return MESSAGE_ROLES.includes(value as MessagePayload['role'])
    ? (value as MessagePayload['role'])
    : fallback;
}

/**
 * Normalize OpenAI chat content into a string + format pair that fits AccordKit.
 */
export function normalizeContent(content: unknown): NormalizedContent {
  if (typeof content === 'string') {
    return { content, format: 'text' };
  }

  if (content == null) {
    return { content: '', format: 'text' };
  }

  if (Array.isArray(content)) {
    try {
      return { content: JSON.stringify(content), format: 'json' };
    } catch {
      return { content: String(content), format: 'json' };
    }
  }

  if (typeof content === 'object') {
    try {
      return { content: JSON.stringify(content), format: 'json' };
    } catch {
      return { content: String(content), format: 'json' };
    }
  }

  return { content: String(content), format: 'text' };
}

/**
 * Parse tool arguments encoded as JSON, falling back to the original string.
 */
export function safeParseJSON(value: unknown): unknown {
  if (typeof value !== 'string') return value ?? null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
