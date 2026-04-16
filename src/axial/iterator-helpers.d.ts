/**
 * ES2025 Iterator Helpers type shim.
 * Bun and modern V8 support these at runtime.
 * TS 6 doesn't ship value-level Iterator yet, so we augment globally.
 */

// eslint-disable-next-line @typescript-eslint/no-unused-vars
interface IteratorObject<T, TReturn, TNext> {
  map<U>(fn: (value: T) => U): IteratorObject<U, undefined, unknown>;
  filter(fn: (value: T) => boolean): IteratorObject<T, undefined, unknown>;
  filter<U extends T>(fn: (value: T) => value is U): IteratorObject<U, undefined, unknown>;
  take(limit: number): IteratorObject<T, undefined, unknown>;
  drop(count: number): IteratorObject<T, undefined, unknown>;
  flatMap<U>(fn: (value: T) => Iterable<U>): IteratorObject<U, undefined, unknown>;
  reduce<U>(fn: (acc: U, value: T) => U, initial: U): U;
  toArray(): T[];
  forEach(fn: (value: T) => void): void;
  some(fn: (value: T) => boolean): boolean;
  every(fn: (value: T) => boolean): boolean;
  find(fn: (value: T) => boolean): T | undefined;
}

// Value-level Iterator with .from()
declare const Iterator: {
  from<T>(iterable: Iterable<T>): IteratorObject<T, undefined, unknown>;
};
