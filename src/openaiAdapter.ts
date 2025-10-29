import { Tracer } from '@accordkit/tracer';

import { wrapAudioApi } from './internal/audio';
import { wrapChatApi } from './internal/chat';
import { wrapImagesApi } from './internal/images';
import { resolveOptions } from './internal/options';
import { wrapResponsesApi } from './internal/responses';
import { getExistingProxy, markProxy } from './internal/wrap';

import type { OpenAIAdapterOptions, ResolvedOpenAIOptions } from './internal/options';
import type OpenAI from 'openai';

/**
 * Wrap an OpenAI client so each API call emits AccordKit tracing events.
 *
 * The adapter installs lazy proxies over the OpenAI surface area and instruments
 * chat, image, audio, and responses endpoints when enabled. A tracer instance is
 * required so emitted events share a consistent session and span context.
 *
 * @param client The OpenAI SDK instance to decorate.
 * @param tracer AccordKit tracer used to record structured events.
 * @param options Optional instrumentation switches; defaults enable chat tracing.
 * @returns A proxy that mirrors the original client while emitting tracing hooks.
 */
export function withOpenAI<T extends OpenAI>(
  client: T,
  tracer: Tracer,
  options: OpenAIAdapterOptions = {},
): T {
  const resolved = resolveOptions(options);

  const existing = getExistingProxy<T>(client);
  if (existing) return existing;

  const proxied = new Proxy(client, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (value == null || typeof prop !== 'string') return value;

      if (prop === 'responses' && resolved.enableResponsesApi) {
        return wrapResponsesApi(value, tracer, resolved);
      }

      if (prop === 'images' && resolved.enableImagesApi) {
        return wrapImagesApi(value, tracer, resolved);
      }

      if (prop === 'audio' && resolved.enableAudioApi) {
        return wrapAudioApi(value, tracer, resolved);
      }

      if (prop === 'chat') {
        return wrapChatApi(value, tracer, resolved);
      }

      return value;
    },
  });

  markProxy(client, proxied);
  return proxied;
}

export type { OpenAIAdapterOptions, ResolvedOpenAIOptions };
