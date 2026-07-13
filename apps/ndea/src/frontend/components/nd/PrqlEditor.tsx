/**
 * PrqlEditor — a CodeMirror 6 editor for PRQL, themed to the workspace's
 * instrument panel (Geist Mono, dark inset, periwinkle caret). CodeMirror
 * (~150KB) is dynamically imported inside the effect so it stays off the main
 * bundle — the Tweakpane pattern. The PRQL grammar + highlight come from
 * prql-lang.ts; diagnostics (red underline + message) are pushed in via the
 * `error` prop, mapped from prqlc's char offsets.
 *
 * The host owns value/onChange; this component is a controlled-ish editor that
 * only pushes external value changes when they diverge from the doc (so typing
 * never fights the controller).
 */

import { useEffect, useRef } from "react";
// type-only — erased at build, so CodeMirror itself stays lazy (effect import)
import type { Diagnostic } from "@codemirror/lint";
import type { EditorView } from "@codemirror/view";

import type { PrqlError } from "@/nodes/utils/wrangle/prql";

interface Props {
  value: string;
  onChange: (next: string) => void;
  /** compiler error for the CURRENT value — drawn as an inline diagnostic */
  error?: PrqlError | null;
  placeholder?: string;
}

export function PrqlEditor({ value, onChange, error, placeholder }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // imperative handles the effect fills in after the async CM import lands
  const api = useRef<{
    view: EditorView;
    setDiagnostics: typeof import("@codemirror/lint").setDiagnostics;
  } | null>(null);

  // build the editor once
  useEffect(() => {
    let disposed = false;
    let view: EditorView | null = null;

    void (async () => {
      const [
        { EditorView, keymap, lineNumbers, placeholder: cmPlaceholder },
        { EditorState },
        { history, defaultKeymap, historyKeymap },
        { bracketMatching },
        lint,
        { prqlLanguage },
      ] = await Promise.all([
        import("@codemirror/view"),
        import("@codemirror/state"),
        import("@codemirror/commands"),
        import("@codemirror/language"),
        import("@codemirror/lint"),
        import("./prql-lang"),
      ]);
      if (disposed || !hostRef.current) return;

      const theme = EditorView.theme(
        {
          "&": { fontSize: "11.5px", backgroundColor: "transparent", height: "100%" },
          "&.cm-focused": { outline: "none" },
          ".cm-content": {
            fontFamily: "var(--font-mono)",
            caretColor: "var(--color-primary)",
            padding: "6px 0",
          },
          ".cm-gutters": {
            backgroundColor: "transparent",
            border: "none",
            color: "var(--color-text-muted)",
            fontFamily: "var(--font-mono)",
            fontSize: "9.5px",
          },
          ".cm-activeLine": { backgroundColor: "color-mix(in oklab, var(--color-primary) 7%, transparent)" },
          ".cm-activeLineGutter": { backgroundColor: "transparent" },
          ".cm-cursor": { borderLeftColor: "var(--color-primary)" },
          "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
            backgroundColor: "color-mix(in oklab, var(--color-primary) 22%, transparent)",
          },
          ".cm-placeholder": { color: "var(--color-text-muted)", fontStyle: "italic" },
          ".cm-diagnostic": { fontFamily: "var(--font-mono)", fontSize: "10px" },
          ".cm-lintRange-error": {
            textDecoration: "underline wavy var(--color-error, oklch(0.704 0.191 22.216))",
          },
          ".cm-tooltip": {
            backgroundColor: "var(--muted)",
            border: "1px solid var(--border)",
            borderRadius: "4px",
            color: "var(--foreground)",
          },
        },
        { dark: true },
      );

      view = new EditorView({
        parent: hostRef.current,
        state: EditorState.create({
          doc: value,
          extensions: [
            lineNumbers(),
            history(),
            bracketMatching(),
            prqlLanguage(),
            lint.lintGutter(),
            cmPlaceholder(placeholder ?? "filter …  |  derive …  |  group …"),
            keymap.of([...defaultKeymap, ...historyKeymap]),
            theme,
            EditorView.lineWrapping,
            EditorView.updateListener.of((u) => {
              if (u.docChanged) onChangeRef.current(u.state.doc.toString());
            }),
          ],
        }),
      });
      api.current = { view, setDiagnostics: lint.setDiagnostics };
      pushDiagnostics();
    })();

    return () => {
      disposed = true;
      view?.destroy();
      api.current = null;
    };
    // build once — value/error are synced via the effects below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // push external value changes that diverge from the doc (avoid clobbering typing)
  useEffect(() => {
    const v = api.current?.view;
    if (!v) return;
    const cur = v.state.doc.toString();
    if (cur !== value) v.dispatch({ changes: { from: 0, to: cur.length, insert: value } });
  }, [value]);

  // reflect the compiler error as a CM diagnostic
  function pushDiagnostics() {
    const a = api.current;
    if (!a) return;
    const len = a.view.state.doc.length;
    const ds: Diagnostic[] = error
      ? [
          {
            from: Math.min(error.from, len),
            to: Math.min(Math.max(error.to, error.from + 1), len),
            severity: "error",
            message: error.reason,
          },
        ]
      : [];
    a.view.dispatch(a.setDiagnostics(a.view.state, ds));
  }
  useEffect(pushDiagnostics, [error]);

  return <div ref={hostRef} className="nowheel nodrag h-full min-h-0 overflow-auto" />;
}
