/** JSON-safe node configuration. */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
