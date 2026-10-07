import { FilterClauseSchema } from "@ndea/protocol";
import { useState } from "react";
import type { NodeBodyProps } from "../contracts";
import type { FilterConfig } from "./definition";

/** Parse editor text; empty text clears the clause. */
function parseWhere(text: string): { where: FilterConfig["where"] } | { error: string } {
  if (!text.trim()) return { where: null };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
  const parsed = FilterClauseSchema.safeParse(json);
  if (!parsed.success) return { error: parsed.error.issues.map((issue) => issue.message).join("; ") };
  return { where: parsed.data };
}

// ponytail: raw JSON editor; add a structured clause builder when humans author filters often.
export function FilterView({ host }: NodeBodyProps<FilterConfig, never>) {
  const [text, setText] = useState(() => (host.config.where ? JSON.stringify(host.config.where, null, 2) : ""));
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex h-full w-full flex-col gap-1 text-xs">
      <textarea
        aria-label="Filter clause JSON"
        className="min-h-20 flex-1 resize-none rounded border border-border bg-background px-2 py-1 font-mono"
        spellCheck={false}
        placeholder='{"op":"gt","column":"area","value":100}'
        value={text}
        onChange={(event) => {
          const next = event.target.value;
          setText(next);
          const result = parseWhere(next);
          if ("error" in result) {
            setError(result.error);
            return;
          }
          setError(null);
          host.patchConfig({ where: result.where });
        }}
      />
      {error ? <p className="text-destructive">{error}</p> : null}
    </div>
  );
}
