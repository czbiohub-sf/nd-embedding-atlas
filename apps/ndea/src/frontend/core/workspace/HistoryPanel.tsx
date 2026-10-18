/**
 * HistoryPanel: the workspace's revision list, a compare of the selected
 * revision against the current document, and Restore. LastChange: the status
 * bar's "last change: <actor> · <time>", highlighted when another writer
 * (an agent, the CLI, another tab) commits.
 */

import { Button } from "@ndea/ui/components/button";
import { Panel } from "@ndea/ui/components/panel";
import { ScrollArea } from "@ndea/ui/components/scroll-area";
import { cn } from "@ndea/ui/lib/utils";
import { useEffect, useState, useSyncExternalStore } from "react";

import { actorLabel, compareDocuments, relativeTime, type DocumentChange } from "./history";
import { useWorkspaceHistory, useWorkspaceSelector } from "./workspace-context";

/** Re-render on a coarse clock so relative times stay current. */
function useNow(): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

export function LastChange({ onClick }: { onClick: () => void }) {
  const history = useWorkspaceHistory();
  const last = useSyncExternalStore(history.subscribe, history.list)[0];
  const now = useNow();
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = history.subscribe(() => {
      const head = history.list()[0];
      if (!head || !history.isRemote(head.revision)) return;
      setFlash(true);
      clearTimeout(timer);
      timer = setTimeout(() => setFlash(false), 3000);
    });
    return () => {
      stop();
      clearTimeout(timer);
    };
  }, [history]);
  return (
    <Button
      variant="ghost"
      size="xs"
      onClick={onClick}
      title="Workspace history"
      data-flash={flash || undefined}
      className={cn(
        "font-mono text-3xs font-normal text-text-muted transition-colors duration-700",
        flash && "bg-primary text-primary-foreground hover:bg-primary/80",
      )}
    >
      {last ? `last change: ${actorLabel(last.actor)} · ${relativeTime(last.committedAt, now)}` : "history"}
    </Button>
  );
}

const CHANGE_LABEL: Record<DocumentChange["change"], string> = {
  added: "added",
  removed: "removed",
  type: "type changed",
  props: "props changed",
  children: "layout changed",
  changed: "changed",
};

/** What differs between revision `revision` and the current document. */
function Compare({ revision }: { revision: number }) {
  const history = useWorkspaceHistory();
  const current = useWorkspaceSelector((ws) => ws.snapshot());
  const [loaded, setLoaded] = useState<{ revision: number; document?: unknown; error?: string }>();
  useEffect(() => {
    let live = true;
    history.at(revision).then(
      (document) => live && setLoaded({ revision, document }),
      (error: unknown) => live && setLoaded({ revision, error: String(error) }),
    );
    return () => {
      live = false;
    };
  }, [history, revision]);
  if (loaded?.revision !== revision) return <div className="text-text-muted">loading #{revision}…</div>;
  if (loaded.error) return <div className="text-destructive">{loaded.error}</div>;
  const changes = compareDocuments(loaded.document, current);
  if (changes.length === 0) return <div className="text-text-muted">Same as the current document.</div>;
  return (
    <ul data-testid="history-compare" className="flex flex-col gap-0.5">
      {changes.map(({ section, key, change }) => (
        <li key={`${section}/${key}/${change}`} className="flex gap-1.5">
          <span className="text-text-muted">{section}</span>
          <span className="truncate text-foreground">{key || "(all)"}</span>
          <span className="ml-auto shrink-0 text-text-muted">{CHANGE_LABEL[change]}</span>
        </li>
      ))}
    </ul>
  );
}

export function HistoryPanel({ onClose }: { onClose: () => void }) {
  const history = useWorkspaceHistory();
  const revisions = useSyncExternalStore(history.subscribe, history.list);
  const now = useNow();
  const [selected, setSelected] = useState<number>();
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string>();
  const head = revisions[0]?.revision;

  const restore = async (revision: number) => {
    setRestoring(true);
    setError(undefined);
    try {
      const outcome = await history.restore(revision);
      if (outcome.kind === "conflict") setError("The workspace changed meanwhile; try again.");
      if (outcome.kind === "invalid") setError(outcome.errors.join("\n"));
    } catch (failure) {
      setError(String(failure));
    } finally {
      setRestoring(false);
    }
  };

  return (
    <Panel
      data-testid="history-panel"
      className="flex w-72 shrink-0 flex-col rounded-none border-y-0 border-r-0 font-mono text-2xs"
    >
      <Panel.Header>
        <span>History</span>
        <Button variant="ghost" size="xs" onClick={onClose}>
          close
        </Button>
      </Panel.Header>
      <ScrollArea className="min-h-0 flex-1" contentClassName="min-w-0">
        <ul className="flex flex-col p-1">
          {revisions.map((r) => (
            <li key={r.revision}>
              <button
                type="button"
                data-revision={r.revision}
                onClick={() => setSelected(r.revision)}
                className={cn(
                  "flex w-full items-baseline gap-1.5 rounded px-1.5 py-1 text-left hover:bg-muted",
                  selected === r.revision && "bg-muted",
                )}
              >
                <span className="w-8 shrink-0 text-text-muted">#{r.revision}</span>
                <span className="truncate text-foreground">{actorLabel(r.actor)}</span>
                {r.restoredFrom !== undefined && (
                  <span className="shrink-0 text-primary">restored #{r.restoredFrom}</span>
                )}
                <span className="ml-auto shrink-0 text-text-muted">
                  {r.ops.length} ops · {relativeTime(r.committedAt, now)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </ScrollArea>
      {selected !== undefined && (
        <div className="flex flex-col gap-1.5 border-t border-border p-2">
          <div className="text-text-muted">Current vs #{selected}</div>
          <Compare revision={selected} />
          {error && <div className="whitespace-pre-wrap text-destructive">{error}</div>}
          <Button
            size="sm"
            variant="outline"
            disabled={restoring || selected === head}
            onClick={() => void restore(selected)}
          >
            Restore #{selected}
          </Button>
        </div>
      )}
    </Panel>
  );
}
