/**
 * WorkspaceShell: the dashboard frame plus a one-line status bar. An invalid
 * server document opens a read-only notice instead.
 */

import type { WorkspaceSnapshot } from "@ndea/protocol";
import { useEffect, useState } from "react";

import { Hud } from "@/components/dashboard/primitives";
import { LAYOUT_EDITING_ENABLED } from "@/feature-flags";
import { useDatasetSession } from "@/hooks/useDatasetSession";
import { DashboardPane } from "./DashboardPane";
import { fetchWorkspaceSnapshot } from "./sync";
import { useWorkspacePersistence, WorkspaceProvider, type WorkspacePersistenceState } from "./workspace-context";

function StatusBar() {
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
      <span className="inline-flex items-center gap-[5px]">
        ws <span className="inline-block size-[5px] shrink-0 rounded-full bg-success" />
      </span>
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
  if (persistence.mode === "recovery") return <RecoveryWorkspaceSurface persistence={persistence} />;
  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-background select-none">
      <div className="relative min-h-0 flex-1">
        {/* Layout editing (split, swap, remove, fill) is editor-only; agents edit any build. */}
        <DashboardPane editable={LAYOUT_EDITING_ENABLED} />
      </div>
      <StatusBar />
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

export function WorkspaceShell() {
  const loaded = useInitialWorkspaceSnapshot();
  if (!loaded) return null;
  if ("error" in loaded) return <RecoveryWorkspaceSurface persistence={{ mode: "recovery", errors: [loaded.error] }} />;
  return (
    <WorkspaceProvider snapshot={loaded.snapshot}>
      <WorkspaceFrame />
    </WorkspaceProvider>
  );
}
