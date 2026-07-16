export function countQuery(table: string, predicate: string | null): string {
  return `SELECT COUNT(*)::INT AS n FROM ${table}${predicate ? ` WHERE ${predicate}` : ""}`;
}
