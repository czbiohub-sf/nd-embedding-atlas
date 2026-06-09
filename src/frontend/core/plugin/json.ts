/**
 * JsonValue — the serializable-config invariant, as a type (PLUGIN-ARCHITECTURE §4.2).
 *
 * A plugin's `Config` is constrained to `Config & JsonValue` so the compiler
 * rejects smuggling a live object (a Mosaic `Coordinator`/`Selection`, a GPU
 * device, a React ref) into `node.data`. That keeps graph state provably
 * serializable for xyflow persistence later.
 */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
