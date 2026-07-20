/**
 * PRQL syntax highlighting for CodeMirror 6: there is no published CM6 PRQL
 * language package, so this is a hand-rolled StreamParser plus a HighlightStyle
 * mapped onto the workspace's instrument-panel tokens (wire colors + success
 * green + Geist Mono). Keyword set tracks PRQL 0.12 (prql-js pinned version).
 *
 * Tokens are deliberately coarse: enough to read a wrangle pipeline at a
 * glance (transforms periwinkle, functions sky, strings amber, numbers green),
 * not a full grammar. The compiler (prql.ts) is the source of truth for
 * correctness; this is just color.
 */

import { HighlightStyle, StreamLanguage, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import type { Extension } from "@codemirror/state";

/** pipeline transforms: the verbs that start a stage */
const TRANSFORMS = new Set([
  "from",
  "filter",
  "derive",
  "select",
  "aggregate",
  "sort",
  "take",
  "join",
  "group",
  "window",
  "append",
  "remove",
  "intersect",
  "loop",
]);

/** built-in functions + namespaced helpers (math.*, text.*, date.*) */
const FUNCTIONS = new Set([
  "count",
  "sum",
  "average",
  "avg",
  "min",
  "max",
  "stddev",
  "median",
  "first",
  "last",
  "mode",
  "any",
  "all",
  "concat",
  "lag",
  "lead",
  "rank",
  "row_number",
  "round",
  "abs",
  "floor",
  "ceil",
  "math",
  "text",
  "date",
  "case",
]);

/** literals + the `this`/`that` pipeline pronouns */
const ATOMS = new Set(["true", "false", "null", "this", "that"]);

const prqlParser = StreamLanguage.define({
  name: "prql",
  token(stream) {
    // whitespace
    if (stream.eatSpace()) return null;

    // line comment
    if (stream.match("#")) {
      stream.skipToEnd();
      return "comment";
    }

    // strings: double, single, and f-strings / s-strings (f"…" s"…")
    if (stream.match(/^[fsr]?"(?:[^"\\]|\\.)*"?/) || stream.match(/^[fsr]?'(?:[^'\\]|\\.)*'?/)) {
      return "string";
    }

    // numbers (incl. underscores: 1_000, floats, scientific)
    if (stream.match(/^-?\d[\d_]*\.?\d*(?:[eE][+-]?\d+)?/)) {
      return "number";
    }

    // identifiers / keywords
    if (stream.match(/^[A-Za-z_][A-Za-z0-9_]*/)) {
      const word = stream.current();
      if (TRANSFORMS.has(word)) return "keyword";
      if (ATOMS.has(word)) return "atom";
      if (FUNCTIONS.has(word)) return "function";
      // `name =` assignment target reads as a definition
      const after = stream.match(/^\s*=(?!=)/, false);
      if (after) return "def";
      return "variableName";
    }

    // operators
    if (stream.match(/^(?:==|!=|<=|>=|->|\|\||&&|\?\?|[-+*/%<>=~|&!])/)) {
      return "operator";
    }

    // punctuation / pipes / braces
    if (stream.match(/^[(){}[\],.:]/)) {
      return "punctuation";
    }

    stream.next();
    return null;
  },
  languageData: { commentTokens: { line: "#" } },
});

/** map StreamParser token names → highlight tags → workspace token colors */
const prqlHighlight = HighlightStyle.define([
  { tag: t.keyword, color: "var(--color-wire-pred)", fontWeight: "600" }, // transforms: periwinkle
  { tag: t.function(t.variableName), color: "var(--color-wire-focus)" },
  { tag: t.string, color: "var(--color-wire-sel)" }, // amber
  { tag: t.number, color: "var(--color-success)" }, // green
  { tag: t.atom, color: "var(--color-wire-focus)" },
  { tag: t.definition(t.variableName), color: "var(--foreground)", fontWeight: "600" },
  { tag: t.variableName, color: "var(--muted-foreground)" },
  { tag: t.operator, color: "var(--color-text-muted)" },
  { tag: t.punctuation, color: "var(--color-text-muted)" },
  { tag: t.comment, color: "var(--color-text-muted)", fontStyle: "italic" },
]);

/** the editor extensions for PRQL: grammar + the themed highlight. */
export function prqlLanguage(): Extension {
  // function-name highlighting needs the tag wired through the parser's token
  // map; StreamLanguage maps "function" → t.function(t.variableName) by default
  return [prqlParser, syntaxHighlighting(prqlHighlight)];
}
