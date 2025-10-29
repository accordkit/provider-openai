import { Tracer, type Sink, type TracerEvent } from '@accordkit/tracer';
import { describe, it, expect } from 'vitest';

import { withOpenAI } from '../src/openaiAdapter';

class MemorySink implements Sink {
  public events: TracerEvent[] = [];
  async write(_sessionId: string, event: TracerEvent) {
    this.events.push(event);
  }
}

function count(events: TracerEvent[], type: TracerEvent['type']) {
  return events.filter((e) => e.type === type).length;
}

describe('Images & Audio instrumentation', () => {
  it('images.generate emits tool_result + span', async () => {
    const sink = new MemorySink();
    const tracer = new Tracer({ sink, sessionId: 'sess' });
    const client: any = {
      images: {
        async generate() {
          return { data: [{ b64_json: '...' }] };
        },
      },
    };
    const wrapped = withOpenAI(client, tracer, { enableImagesApi: true });
    await wrapped.images.generate({ model: 'gpt-image', prompt: 'tree' });
    expect(count(sink.events, 'tool_result')).toBe(1);
    expect(count(sink.events, 'span')).toBe(1);
  });

  it('audio.* emits tool_result + span per method', async () => {
    const sink = new MemorySink();
    const tracer = new Tracer({ sink, sessionId: 'sess' });
    const client: any = {
      audio: {
        speech: {
          async create() {
            return { data: 'ok' };
          },
        },
        transcriptions: {
          async create() {
            return { text: 'hi' };
          },
        },
        translations: {
          async create() {
            return { text: 'bonjour' };
          },
        },
      },
    };
    const wrapped = withOpenAI(client, tracer, { enableAudioApi: true });
    await wrapped.audio.speech.create({ model: 'gpt-tts' });
    await wrapped.audio.transcriptions.create({ model: 'whisper' });
    await wrapped.audio.translations.create({ model: 'whisper' });
    expect(count(sink.events, 'tool_result')).toBe(3);
    expect(count(sink.events, 'span')).toBe(3);
  });
});
