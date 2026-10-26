/**
 * WorkspaceShell: loads the server document once and opens the shell frame
 * (`core/shell/Shell.tsx`). An invalid server document opens a read-only
 * notice instead. Remote rendering's headless tab shows only its element's body.
 */

import type { WorkspaceSnapshot } from "@ndea/protocol";
import { useEffect, useState } from "react";

import { RENDER_PAGE } from "@/core/component/definitions";
import { CommandMenu } from "@/core/shell/CommandMenu";
import { themeCommands } from "@/core/shell/commands";
import { Shell } from "@/core/shell/Shell";
import { useTheme } from "@/ThemeProvider";
import { BodySocket, BodyStatus } from "./body-dock";
import { fetchWorkspaceSnapshot } from "./sync";
import { useWorkspacePersistence, WorkspaceProvider, type WorkspacePersistenceState } from "./workspace-context";

/** The read-only notice; ⌘K still opens the command menu, with the theme commands only. */
function RecoveryWorkspaceSurface({ persistence }: { persistence: WorkspacePersistenceState }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const { theme, setTheme } = useTheme();
  return (
    <div className="fixed inset-0 grid place-items-center overflow-hidden bg-background p-8 select-none">
      <div role="alert" className="max-w-xl rounded-lg bg-card p-4 text-ui shadow-(--shadow-popover)">
        <div className="mb-2 text-md font-semibold text-warning">Workspace opened read-only</div>
        {persistence.errors.map((error) => (
          <div key={error} className="mt-2 font-mono text-sm break-words text-text-muted">
            {error}
          </div>
        ))}
        <div className="mt-3 text-text-muted">
          Edits are disabled and nothing is saved. Fix or remove the workspace file, then restart ndea view.
        </div>
      </div>
      <CommandMenu
        open={menuOpen}
        onOpenChange={setMenuOpen}
        commands={themeCommands(theme)}
        onSelect={(command) => command.kind === "theme" && setTheme(command.theme)}
      />
    </div>
  );
}

function WorkspaceFrame() {
  const persistence = useWorkspacePersistence();
  if (persistence.mode === "recovery") return <RecoveryWorkspaceSurface persistence={persistence} />;
  return <Shell />;
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
