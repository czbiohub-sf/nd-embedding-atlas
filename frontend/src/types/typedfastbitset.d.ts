/**
 * Minimal ambient declaration for typedfastbitset (no bundled types).
 * https://github.com/lemire/TypedFastBitSet.js
 */
declare module "typedfastbitset" {
    class TypedFastBitSet {
        constructor(iterable?: Iterable<number>);
        add(index: number): void;
        remove(index: number): void;
        has(index: number): boolean;
        size(): number;
        array(): number[];
        forEach(callback: (index: number) => void): void;
        clear(): void;
        words: Uint32Array;
    }
    export = TypedFastBitSet;
}
