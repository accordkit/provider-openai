import { Tracer, type Sink, type TracerEvent } from '@accordkit/tracer';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { withOpenAI } from '../src/openaiAdapter';

import type { OpenAI } from 'openai';
import type { ChatCompletionCreateParams } from 'openai/resources/chat/completions';

class MemorySink implements Sink {
  public events: TracerEvent[] = [];

  async write(_sessionId: string, event: TracerEvent) {
    this.events.push(event);
  }
}

function createClient(impl: (params: any) => any): OpenAI {
  return {
    chat: {
      completions: {
        create: vi.fn(async (params: any) => impl(params)),
      },
    },
  } as unknown as OpenAI;
}

// Helper to make tests less brittle against event emission order.
function findEvent<T extends TracerEvent['type']>(sink: MemorySink, type: T) {
  return sink.events.find((e) => e.type === type) as Extract<TracerEvent, { type: T }>;
}

describe('withOpenAI adapter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    vi.spyOn(Math, 'random').mockReturnValue(0.123456);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.spyOn(Math, 'random').mockRestore();
  });

  it('emits a full set of events for a standard completion', async () => {
    const sink = new MemorySink();
    const tracer = new Tracer({ sink, sessionId: 'sess-1' });
    const completion = {
      id: 'chatcmpl-123',
      model: 'gpt-4o',
      created: 1,
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          message: {
            role: 'assistant',
            content: 'Hello from AccordKit',
            tool_calls: [
              {
                id: 'tool_1',
                type: 'function',
                function: {
                  name: 'lookupWeather',
                  arguments: '{"city":"AMS"}',
                },
              },
            ],
          },
        },
      ],
      usage: {
        prompt_tokens: 12,
        completion_tokens: 6,
        total_tokens: 18,
      },
    };

    const client = createClient(async () => {
      vi.advanceTimersByTime(42);
      return completion;
    });

    const wrapped = withOpenAI(client, tracer);

    const params: ChatCompletionCreateParams = {
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'Be concise.' },
        { role: 'user', content: 'Weather in Amsterdam?' },
      ],
    };

    const response = await wrapped.chat.completions.create(params);
    expect(response).toBe(completion);

    // Check that all expected event types were emitted
    const types = sink.events.map((e) => e.type).sort();
    expect(types).toEqual([
      'message',
      'message',
      'message',
      'span',
      'tool_call',
      'tool_result',
      'usage',
    ]);

    // Assertions on specific events (order-independent)
    const assistantMessage = sink.events.find(
      (e) => e.type === 'message' && e.role === 'assistant',
    ) as any;
    expect(assistantMessage.content).toBe('Hello from AccordKit');

    const toolCall = findEvent(sink, 'tool_call');
    expect(toolCall?.tool).toBe('lookupWeather');
    expect(toolCall?.input).toEqual({ city: 'AMS' });
    expect(toolCall?.$ext).toMatchObject({ id: 'tool_1', finishReason: 'stop' });

    const usage = findEvent(sink, 'usage');
    expect(usage?.inputTokens).toBe(12);
    expect(usage?.outputTokens).toBe(6);
    expect(usage?.$ext?.totalTokens).toBe(18);

    const toolResult = findEvent(sink, 'tool_result');
    expect(toolResult?.ok).toBe(true);
    expect(toolResult?.latencyMs).toBe(42);
    expect(toolResult?.output).toEqual({
      id: 'chatcmpl-123',
      model: 'gpt-4o',
      created: 1,
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          hasMessage: true,
        },
      ],
      usage: {
        prompt_tokens: 12,
        completion_tokens: 6,
        total_tokens: 18,
      },
    });

    const span = findEvent(sink, 'span');
    expect(span?.operation).toBe('openai.chat.completions.create');
    expect(span?.durationMs).toBe(42);
    expect(span?.status).toBe('ok');
    expect(span?.attrs).toMatchObject({ latencyMs: 42, model: 'gpt-4o' });

    // Every event shares the same ctx identifiers.
    const traceIds = new Set(sink.events.map((e) => e.ctx.traceId));
    const spanIds = new Set(sink.events.map((e) => e.ctx.spanId));
    expect(traceIds.size).toBe(1);
    expect(spanIds.size).toBe(1);
  });

  it('handles minimal completion payload without usage or tool calls', async () => {
    const sink = new MemorySink();
    const tracer = new Tracer({ sink, sessionId: 'sess-minimal' });
    const completion = {
      id: 'chatcmpl-minimal',
      model: 'gpt-4o-mini',
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'OK' } }],
      // No usage block
    };

    const client = createClient(async () => completion);
    const wrapped = withOpenAI(client, tracer);

    await wrapped.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'Minimal test' }],
    });

    const types = sink.events.map((e) => e.type);
    // No 'usage' or 'tool_call' events should be present
    expect(types).toEqual(['message', 'message', 'tool_result', 'span']);
    expect(findEvent(sink, 'usage')).toBeUndefined();
    expect(findEvent(sink, 'tool_call')).toBeUndefined();

    const toolResult = findEvent(sink, 'tool_result');
    expect(toolResult?.ok).toBe(true);
    expect(toolResult?.output).toMatchObject({ id: 'chatcmpl-minimal' });
  });

  it('honors options to disable event emitters', async () => {
    const sink = new MemorySink();
    const tracer = new Tracer({ sink, sessionId: 'sess-opts' });
    const completion = {
      id: 'chatcmpl-opts',
      choices: [{ message: { role: 'assistant', content: 'content' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    };

    const client = createClient(async () => completion);
    const wrapped = withOpenAI(client, tracer, {
      emitPrompts: false,
      emitUsage: false,
      emitSpan: false,
    });

    await wrapped.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'A prompt' }],
    });

    const types = sink.events.map((e) => e.type);
    // Only response message and tool_result should be emitted
    expect(types).toEqual(['message', 'tool_result']);

    const message = findEvent(sink, 'message');
    expect(message?.role).toBe('assistant'); // The user prompt message was skipped
  });

  it('emits failure tool_result + span on errors', async () => {
    const sink = new MemorySink();
    const tracer = new Tracer({ sink, sessionId: 'sess-err' });

    const client = createClient(async () => {
      vi.advanceTimersByTime(24);
      throw new Error('rate limit exceeded');
    });

    const wrapped = withOpenAI(client, tracer);

    await expect(
      wrapped.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'hello?' }],
      }),
    ).rejects.toThrow('rate limit exceeded');

    const types = sink.events.map((e) => e.type);
    expect(types).toEqual(['message', 'tool_result', 'span']);

    const toolResult = findEvent(sink, 'tool_result');
    expect(toolResult?.ok).toBe(false);
    expect(toolResult?.latencyMs).toBe(24);
    expect((toolResult?.output as any).message).toMatch(/rate limit exceeded/);

    const span = findEvent(sink, 'span');
    expect(span?.status).toBe('error');
    expect(span?.attrs?.latencyMs).toBe(24);
    expect(span?.attrs?.error).toContain('rate limit exceeded');
  });

  it('instruments streaming responses once final completion resolves', async () => {
    vi.useRealTimers();

    const sink = new MemorySink();
    const tracer = new Tracer({ sink, sessionId: 'sess-stream' });

    const completion = {
      id: 'chatcmpl-stream',
      model: 'gpt-4.1',
      created: 10,
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          message: { role: 'assistant', content: 'Streaming hello' },
        },
      ],
      usage: {
        prompt_tokens: 5,
        completion_tokens: 7,
        total_tokens: 12,
      },
    };

    const streamPromise = Promise.resolve(completion);
    const stream = {
      finalChatCompletion: vi.fn(() => streamPromise),
    };

    const client = createClient(async () => stream);
    const wrapped = withOpenAI(client, tracer);

    const result = await wrapped.chat.completions.create({
      model: 'gpt-4.1',
      stream: true,
      messages: [{ role: 'user', content: 'stream please' }],
    });

    expect(result).toBe(stream);

    await streamPromise;
    // Allow microtasks to run so the .then/.catch handlers fire
    await new Promise((resolve) => setTimeout(resolve, 0));

    const types = sink.events.map((e) => e.type);
    expect(types).toEqual(['message', 'message', 'usage', 'tool_result', 'span']);

    const usage = findEvent(sink, 'usage');
    expect(usage?.inputTokens).toBe(5);
    expect(usage?.outputTokens).toBe(7);

    const span = findEvent(sink, 'span');
    expect(span?.attrs?.stream).toBe(true);
  });

  it('returns the same proxy when wrapping the same client twice', () => {
    const sink = new MemorySink();
    const tracerA = new Tracer({ sink, sessionId: 'sess-a' });
    const tracerB = new Tracer({ sink, sessionId: 'sess-b' });

    const client = createClient(async () => ({}));

    const wrappedA = withOpenAI(client, tracerA);
    const wrappedB = withOpenAI(client, tracerB);

    expect(wrappedA).toBe(wrappedB);
  });
});
