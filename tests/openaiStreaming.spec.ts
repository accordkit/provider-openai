import { Tracer, type Sink, type TracerEvent } from '@accordkit/tracer';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { withOpenAI } from '../src/openaiAdapter';

class MemorySink implements Sink {
  public events: TracerEvent[] = [];
  async write(_sessionId: string, event: TracerEvent) {
    this.events.push(event);
  }
}

function makeStream(final: any) {
  const obj: any = {};
  Object.defineProperty(obj, 'finalChatCompletion', { value: async () => final });
  return obj;
}

describe('Chat streaming', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('emits final artifacts for streaming chat completion', async () => {
    const sink = new MemorySink();
    const tracer = new Tracer({ sink, sessionId: 'sess' });

    const client: any = {
      chat: {
        completions: {
          async create(_params: any) {
            return makeStream({
              id: 'cmpl_1',
              model: 'gpt-test',
              created: Math.floor(Date.now() / 1000),
              choices: [
                {
                  index: 0,
                  message: { role: 'assistant', content: 'done' },
                  finish_reason: 'stop',
                },
              ],
              usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
            });
          },
        },
      },
    };

    const wrapped = withOpenAI(client, tracer);
    const stream = await wrapped.chat.completions.create({
      model: 'gpt-test',
      stream: true,
      messages: [{ role: 'user', content: 'hi' }],
    });

    // simulate consumer awaiting final result via helper
    const final = await (stream as any).finalChatCompletion?.();
    expect(final?.id).toBe('cmpl_1');

    await vi.runAllTimersAsync();

    // Ensure events emitted once and span closed
    const toolResults = sink.events.filter((e) => e.type === 'tool_result');
    const spans = sink.events.filter((e) => e.type === 'span');
    const messages = sink.events.filter(
      (e) => e.type === 'message' && (e as any).role === 'assistant',
    );

    expect(toolResults.length).toBe(1);
    expect(spans.length).toBe(1);
    expect(messages.length).toBe(1);
  });
});
