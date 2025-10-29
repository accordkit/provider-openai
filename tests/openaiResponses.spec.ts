import { Tracer, type Sink, type TracerEvent } from '@accordkit/tracer';
import { describe, it, expect } from 'vitest';

import { withOpenAI } from '../src/openaiAdapter';

class MemorySink implements Sink {
  public events: TracerEvent[] = [];
  async write(_sessionId: string, event: TracerEvent) {
    this.events.push(event);
  }
}

function find<T extends TracerEvent['type']>(events: TracerEvent[], type: T) {
  return events.filter((e) => e.type === type);
}

describe('Responses API instrumentation', () => {
  it('emits responses -> tool_result + span + message + usage (when enabled)', async () => {
    const sink = new MemorySink();
    const tracer = new Tracer({ sink, sessionId: 'sess' });

    const client: any = {
      responses: {
        async create(_params: any) {
          return {
            id: 'resp_1',
            model: 'gpt-test',
            created: Math.floor(Date.now() / 1000),
            output_text: 'hello',
            usage: { input_tokens: 3, output_tokens: 5, total_tokens: 8 },
            status: 'stop',
          };
        },
      },
    };

    const wrapped = withOpenAI(client, tracer, { enableResponsesApi: true });
    await wrapped.responses.create({ model: 'gpt-test', input: [{ role: 'user', content: 'hi' }] });

    const toolResults = find(sink.events, 'tool_result');
    const spans = find(sink.events, 'span');
    const messages = find(sink.events, 'message');
    const usage = find(sink.events, 'usage');

    expect(toolResults.length).toBeGreaterThan(0);
    expect(spans.length).toBeGreaterThan(0);
    expect(messages.find((e) => (e as any).role === 'assistant')).toBeTruthy();
    expect(usage.length).toBeGreaterThan(0);
  });

  it('emits error tool_result on failure', async () => {
    const sink = new MemorySink();
    const tracer = new Tracer({ sink, sessionId: 'sess' });

    const client: any = {
      responses: {
        async create() {
          throw new Error('boom');
        },
      },
    };
    const wrapped = withOpenAI(client, tracer, { enableResponsesApi: true });

    await expect(wrapped.responses.create({})).rejects.toThrow('boom');
    const toolResults = sink.events.filter(
      (e) => e.type === 'tool_result' && (e as any).ok === false,
    );
    expect(toolResults.length).toBe(1);
  });
});
