/**
 * Symbol-based helpers for memoizing wrapped OpenAI clients.
 *
 * The adapter avoids instrumenting the same OpenAI instance multiple times by attaching
 * an internal symbol to the client. These helpers centralize that bookkeeping.
 */
type SymbolStore = { [key: symbol]: unknown };

const WRAP_SYMBOL = Symbol.for('accordkit.provider-openai');

/**
 * Retrieve a previously cached proxy from an OpenAI client, if present.
 *
 * @param client OpenAI client candidate to inspect.
 * @returns The memoized proxy or `undefined` when not instrumented.
 */
export function getExistingProxy<T>(client: object): T | undefined {
  const store = client as unknown as SymbolStore;
  return store[WRAP_SYMBOL] as T | undefined;
}

/**
 * Memoize the proxy on the client instance to avoid double instrumentation.
 *
 * @param client Original OpenAI client instance.
 * @param proxy Proxy returned from {@link withOpenAI}.
 */
export function markProxy<T>(client: object, proxy: T): void {
  Object.defineProperty(client, WRAP_SYMBOL, {
    value: proxy,
    enumerable: false,
    configurable: false,
    writable: false,
  });
}
