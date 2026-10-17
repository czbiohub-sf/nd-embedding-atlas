/**
 * WorkspaceShell: the dashboard frame, the History panel, and a one-line
 * status bar. An invalid server document opens a read-only notice instead.
 * Remote rendering's headless tab shows only its element's body.
 */

import type { WorkspaceSnapshot } from "@ndea/protocol";
import { useEffect, useState } from "react";

import { Hud } from "@/components/dashboard/primitives";
import { LAYOUT_EDITING_ENABLED } from "@/feature-flags";
import { RENDER_PAGE } from "@/core/component/definitions";
import { useDatasetSession } from "@/hooks/useDatasetSession";
import { BodySocket, BodyStatus } from "./body-dock";
import { DashboardPane } from "./DashboardPane";
import { HistoryPanel, LastChange } from "./HistoryPanel";
import { fetchWorkspaceSnapshot } from "./sync";
import { useWorkspacePersistence, WorkspaceProvider, type WorkspacePersistenceState } from "./workspace-context";

function StatusBar({ onToggleHistory }: { onToggleHistory: () => void }) {
  const { runtime } = useDatasetSession();
  return (
    <div className="flex h-[22px] shrink-0 items-center justify-between overflow-hidden border-t border-border bg-background px-2.5 font-mono text-3xs whitespace-nowrap text-text-muted select-none">
      <div className="flex min-w-0 items-center gap-3.5">
        <span className="grid size-4 shrink-0 place-items-center rounded bg-primary">
          <Hud size={7} className="text-primary-foreground normal-case">
            nD
          </Hud>
        </span>
        <span className="rounded border border-border px-1.5 py-px">{runtime.table}</span>
      </div>
      <div className="flex items-center gap-3.5">
        <LastChange onClick={onToggleHistory} />
        <span className="inline-flex items-center gap-[5px]">
          ws <span className="inline-block size-[5px] shrink-0 rounded-full bg-success" />
        </span>
      </div>
    </div>
  );
}

function RecoveryWorkspaceSurface({ persistence }: { persistence: WorkspacePersistenceState }) {
  return (
    <div className="fixed inset-0 grid place-items-center overflow-hidden bg-background p-8 select-none">
      <div
        role="alert"
        className="max-w-xl rounded-md border border-warning/60 bg-card p-4 font-mono text-xs shadow-xl"
      >
        <div className="mb-2 font-semibold text-warning">Workspace opened read-only</div>
        {persistence.errors.map((error) => (
          <div key={error} className="mt-2 break-words text-text-muted">
            {error}
          </div>
        ))}
        <div className="mt-3 text-text-muted">
          Edits are disabled and nothing is saved. Fix or remove the workspace file, then restart ndea view.
        </div>
      </div>
    </div>
  );
}

function WorkspaceFrame() {
  const persistence = useWorkspacePersistence();
  const [historyOpen, setHistoryOpen] = useState(false);
  if (persistence.mode === "recovery") return <RecoveryWorkspaceSurface persistence={persistence} />;
  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-background select-none">
      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          {/* Layout editing (split, swap, remove, fill) is editor-only; agents edit any build. */}
          <DashboardPane editable={LAYOUT_EDITING_ENABLED} />
        </div>
        {historyOpen && <HistoryPanel onClose={() => setHistoryOpen(false)} />}
      </div>
      <StatusBar onToggleHistory={() => setHistoryOpen((open) => !open)} />
    </div>
  );
}

/** One read: the Workspace is built once from this snapshot; `WorkspaceSync` tracks it afterwards. */
function useInitialWorkspaceSnapshot(): { snapshot: WorkspaceSnapshot } | { error: string } | null {
  const [loaded, setLoaded] = useState<{ snapshot: WorkspaceSnapshot } | { error: string } | null>(null);
  useEffect(() => {
    let live = true;
    fetchWorkspaceSnapshot().then(
      (snapshot) => live && setLoaded({ snapshot }),
      (error: unknown) => live && setLoaded({ error: error instanceof Error ? error.message : String(error) }),
    );
    return () => {
      live = false;
    };
  }, []);
  return loaded;
}

/** The headless render page: one element's body filling the viewport, no dashboard chrome. */
function RenderFrame({ id }: { id: string }) {
  return (
    <div className="fixed inset-0 overflow-hidden bg-background">
      <BodyStatus id={id} label={id} />
      <BodySocket id={id} className="flex h-full min-h-0 flex-col overflow-hidden" />
    </div>
  );
}

export function WorkspaceShell() {
  const loaded = useInitialWorkspaceSnapshot();
  if (!loaded) return null;
  if ("error" in loaded) return <RecoveryWorkspaceSurface persistence={{ mode: "recovery", errors: [loaded.error] }} />;
  return (
    <WorkspaceProvider snapshot={loaded.snapshot}>
      {RENDER_PAGE ? <RenderFrame id={RENDER_PAGE.element} /> : <WorkspaceFrame />}
    </WorkspaceProvider>
  );
}
