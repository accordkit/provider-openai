# @accordkit/provider-openai

[![Part of AccordKit](https://img.shields.io/badge/AccordKit-ecosystem-00cc88?style=flat-square)](https://github.com/accordkit)

> **Part of the [AccordKit](https://github.com/accordkit) ecosystem** —  
> an open, AI-agnostic tracing SDK for LLM-powered and ChatGPT-interoperable applications.  
> AccordKit gives developers local-first observability: **no vendor lock-in, no opaque dashboards**, just clean event streams and tools that work anywhere.

[🌍 Positioning Map →](https://github.com/accordkit/docs/blob/main/assets/accordkit_positioning_map.png)


> AccordKit adapter that instruments the official OpenAI SDK and emits normalized
> tracing events (`message`, `tool_call`, `usage`, `tool_result`, `span`) through
> an AccordKit [`Tracer`](https://github.com/accordkit/tracer).

## Overview

- **Drop-in wrapper** — call `withOpenAI(new OpenAI(), tracer)` and continue using the SDK.
- **Complete event coverage** — prompts, assistant responses, tool invocations, token usage, and latency are captured.
- **Streaming aware** — streaming completions flush events when `finalChatCompletion()` resolves.
- **Trace-friendly** — every event reuses a shared `ctx` so downstream tooling can correlate activity.

## Installation

```bash
pnpm add @accordkit/tracer @accordkit/provider-openai openai
```

## Quickstart

```ts
import OpenAI from 'openai';
import { FileSink, Tracer } from '@accordkit/tracer';
import { withOpenAI } from '@accordkit/provider-openai';

const tracer = new Tracer({ sink: new FileSink() });
const client = withOpenAI(new OpenAI({ apiKey: process.env.OPENAI_API_KEY! }), tracer);

await client.chat.completions.create({
  model: 'gpt-4o',
  messages: [
    { role: 'system', content: 'You are AccordKit.' },
    { role: 'user', content: 'Say hi!' },
  ],
});
```

Events are written to the `FileSink` in normalized AccordKit format. Swap in any other sink (browser, HTTP, etc.) depending on your deployment needs.

## API

### `withOpenAI(client, tracer, options?)`

| Parameter | Type                               | Description                                      |
| --------- | ---------------------------------- | ------------------------------------------------ |
| `client`  | `OpenAI`                           | The OpenAI SDK instance to instrument.           |
| `tracer`  | `Tracer`                           | AccordKit tracer responsible for writing events. |
| `options` | [`OpenAIAdapterOptions`](#options) | Optional tuning knobs described below.           |

Returns a proxy that mirrors the OpenAI SDK. Re-wrapping the same client always returns the existing proxy so instrumentation is only applied once.

### Options

| Option | Default | Description |
|--------|---------|-------------|
| `enableResponsesApi` | `false` | Wrap the beta `responses` namespace so `responses.create` emits events that mirror chat completions. |
| `enableImagesApi` | `false` | Instrument `images.generate` calls to capture latency and success/failure without emitting large binary payloads. |
| `enableAudioApi` | `false` | Instrument `audio.speech/transcriptions/translations` namespaces. |
| `provider` | `'openai'` | Provider identifier attached to every event. Override if you proxy the API through a custom service. |
| `operationName` | `'openai.chat.completions.create'` | Logical operation name that shows up on `tool_result` and `span` events. |
| `emitPrompts` | `true` | Emit `message` events for system/user prompts before submitting the request. |
| `emitResponses` | `true` | Emit `message` events for assistant completions in the response. |
| `emitToolCalls` | `true` | Emit `tool_call` events for function/tool invocations requested by the assistant (including legacy `function_call`). |
| `emitUsage` | `true` | Emit `usage` events when OpenAI reports token accounting. |
| `emitToolResults` | `true` | Emit `tool_result` events summarizing latency and success/error details. |
| `emitSpan` | `true` | Emit `span` events around each request with duration and status metadata. |

```ts
withOpenAI(client, tracer, {
  provider: 'openai',
  emitResponses: false, // example override: skip assistant message emission
});
```

All boolean flags default to `true`; omit overrides unless you intentionally want less output.

## Emitted Events

| Event         | When it fires                                                  | Notable fields                                     |
| ------------- | -------------------------------------------------------------- | -------------------------------------------------- |
| `message`     | Before the API call (prompts) and after completion (assistant) | `role`, `content`, `format`, `requestId`           |
| `tool_call`   | When the assistant requests a tool/function                    | `tool`, parsed JSON `input`, `$ext.id`             |
| `usage`       | When OpenAI reports token accounting                           | `inputTokens`, `outputTokens`, `$ext.totalTokens`  |
| `tool_result` | After the API call completes or throws                         | `ok`, `latencyMs`, `output` (summary or error)     |
| `span`        | Surrounding each API call (if `emitSpan`)                      | `operation`, `durationMs`, `status`, `attrs.model` |

Every event reuses the same `ctx` so grouping by `traceId`/`spanId` is straightforward.

## Streaming Support

Streaming responses are detected automatically. Events are buffered until
`finalChatCompletion()` resolves, at which point the adapter:

1. Emits accumulated assistant/tool events.
2. Emits `usage`, `tool_result`, and `span` events with `attrs.stream = true`.

Ensure your OpenAI SDK version exposes `finalChatCompletion()` (v4+). When `enableResponsesApi`
is set, the adapter coerces `responses.create` output into a chat-like completion so the same
streaming hooks and event emitters apply.

## Error Handling

Exceptions thrown by `chat.completions.create` are re-thrown after emitting:

- A failed `tool_result` event containing the serialized error.
- A `span` event with `status: 'error'` and the error message in `attrs.error`.

This keeps tracing consistent while preserving native SDK error semantics.

### Optional APIs

Enable extra endpoints while keeping default minimal surface:

```ts
withOpenAI(openai, tracer, {
  enableResponsesApi: true,
  enableImagesApi: true,
  enableAudioApi: true,
});
```

## Emitted events by OpenAI method (per flag)

| OpenAI method                                 | Flag                    | prompts | responses | usage | tool_result | span |
|-----------------------------------------------|-------------------------|:-------:|:---------:|:----:|:-----------:|:----:|
| `chat.completions.create`                     | _none_ (always on)      |   ✓     |     ✓     |  ✓   |      ✓      |  ✓   |
| `chat.completions.create (stream)`            | _none_ (always on)      |   ✓     |  ✓ (final)|  ✓   |      ✓      |  ✓   |
| `responses.create`                            | `enableResponsesApi`    |   —     |     ✓     |  ✓   |      ✓      |  ✓   |
| `images.generate`                             | `enableImagesApi`       |   —     |     —     |  —   |      ✓      |  ✓   |
| `audio.speech.create`                         | `enableAudioApi`        |   —     |     —     |  —   |      ✓      |  ✓   |
| `audio.transcriptions.create`                 | `enableAudioApi`        |   —     |     —     |  —   |      ✓      |  ✓   |
| `audio.translations.create`                   | `enableAudioApi`        |   —     |     —     |  —   |      ✓      |  ✓   |

**Notes**  
- For chat streaming we emit **final** artifacts after the stream resolves. Partial chunk emission is currently **off** by default.
- `images`/`audio` endpoints intentionally avoid attaching large binary payloads; only summary info is sent via `tool_result` plus `span` timings.

## TypeScript

The adapter ships with full TypeScript typings. Helper modules use discriminated
unions to keep event emission strongly typed, and lint rules enforce no `any`.

## Contributing

- Run `pnpm --filter @accordkit/provider-openai lint` and `pnpm --filter @accordkit/provider-openai test` before submitting changes.
- Tests rely on Vitest with in-memory sinks and mocked OpenAI clients—no API key required.
- Please document new options or behaviors directly in this README.

## License

MIT © AccordKit contributors.
