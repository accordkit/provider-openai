/**
 * Symbol-based helpers for memoizing wrapped OpenAI clients.
 */
type SymbolStore = { [key: symbol]: unknown };

const WRAP_SYMBOL = Symbol.for('accordkit.provider-openai');

/**
 * Retrieve a previously cached proxy from an OpenAI client, if present.
 */
export function getExistingProxy<T>(client: object): T | undefined {
  const store = client as unknown as SymbolStore;
  return store[WRAP_SYMBOL] as T | undefined;
}

/**
 * Memoize the proxy on the client instance to avoid double instrumentation.
 */
export function markProxy<T>(client: object, proxy: T): void {
  Object.defineProperty(client, WRAP_SYMBOL, {
    value: proxy,
    enumerable: false,
    configurable: false,
    writable: false,
  });
}
