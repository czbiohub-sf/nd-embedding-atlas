/**
 * The shell frame: a 32px rail pinned 4px from the window edges and the tile
 * grid beside it. Hovering a rail button opens its flyout over the tiles;
 * clicking it (or ⌘B) pins the flyout, which then docks and pushes the grid.
 * Esc closes an unpinned flyout. No top bar, no status bar. Pending harness
 * proposals preview in the grid with the proposal bar over it.
 */

import { DatabaseIcon, LinkIcon, PanelLeftIcon, SearchIcon, SlidersVerticalIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { IconButton } from "@ndea/ui/components/icon-button";
import { NdHarnessIcon, NdSplitIcon } from "@ndea/ui/components/nd-icons";
import { cn } from "@ndea/ui/lib/utils";

import { isConnected, ProposalsContext, useHarness } from "@/core/proposals/harness";
import { previewProposals, type ProposalPreview } from "@/core/proposals/preview";
import { ProposalBar } from "@/core/proposals/Proposals";
import { DashboardPane } from "@/core/workspace/DashboardPane";
import { OpenLinksContext } from "@/core/workspace/LinksPopover";
import { useWorkspaceSelector } from "@/core/workspace/workspace-context";
import { WorkspaceCommandMenu, type MenuItem } from "./CommandMenu";
import { DataFlyout, HarnessFlyout, LayoutsFlyout, LinksFlyout, SettingsFlyout } from "./flyouts";

type Panel = "layouts" | "data" | "links" | "harness" | "settings";

const PANELS: Record<Panel, { title: string; icon: React.ReactNode }> = {
  layouts: { title: "Layouts", icon: <NdSplitIcon /> },
  data: { title: "Data", icon: <DatabaseIcon /> },
  links: { title: "Links", icon: <LinkIcon /> },
  harness: { title: "Harness", icon: <NdHarnessIcon /> },
  settings: { title: "Settings", icon: <SlidersVerticalIcon /> },
};

/** Hover-open delay from a closed flyout, and the grace period before a left flyout closes. */
const OPEN_DELAY_MS = 80;
const CLOSE_DELAY_MS = 200;

interface FlyoutState {
  panel: Panel;
  /** Open over the tiles while the pointer is on the rail or the flyout. */
  hovered: boolean;
  /** Docked: pushes the tile grid and stays open. */
  pinned: boolean;
}

/** Pinning keeps the flyout open; unpinning closes it. */
const togglePinned = (s: FlyoutState): FlyoutState => ({ ...s, hovered: !s.pinned, pinned: !s.pinned });

const NO_PREVIEW: ProposalPreview = { document: null, ghosts: new Map(), review: [], pending: [] };

export function Shell() {
  const [menuOpen, setMenuOpen] = useState(false);
  const harness = useHarness();
  const { proposals } = harness.state;
  // Follow the document only while proposals are pending; otherwise the shell need not re-render on edits.
  const doc = useWorkspaceSelector((ws) => (proposals.length > 0 ? ws.snapshot() : null));
  const preview = useMemo(() => (doc ? previewProposals(doc, proposals) : NO_PREVIEW), [doc, proposals]);
  const connected = harness.state.agents.some((agent) => isConnected(agent, harness.now));
  const [{ panel, hovered, pinned }, setFlyout] = useState<FlyoutState>({
    panel: "layouts",
    hovered: false,
    pinned: false,
  });
  const timer = useRef(0);
  const open = pinned || hovered;

  const later = (delay: number, action: () => void) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(action, delay);
  };
  const hover = (next: Panel) =>
    later(open ? 0 : OPEN_DELAY_MS, () => setFlyout((s) => ({ ...s, panel: next, hovered: true })));
  const stay = () => window.clearTimeout(timer.current);
  const leave = () => later(CLOSE_DELAY_MS, () => setFlyout((s) => ({ ...s, hovered: false })));
  const togglePin = () => {
    window.clearTimeout(timer.current);
    setFlyout(togglePinned);
  };
  const click = (next: Panel) => {
    window.clearTimeout(timer.current);
    setFlyout((s) =>
      s.pinned && s.panel === next
        ? { ...s, hovered: false, pinned: false }
        : { panel: next, hovered: true, pinned: true },
    );
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "b" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        window.clearTimeout(timer.current);
        setFlyout(togglePinned);
      } else if (event.key === "Escape") {
        window.clearTimeout(timer.current);
        setFlyout((s) => (s.pinned || !s.hovered ? s : { ...s, hovered: false }));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.clearTimeout(timer.current);
    };
  }, [timer]);

  const railButton = (id: Panel) => (
    <IconButton
      key={id}
      size="md"
      label={PANELS[id].title}
      tooltipSide="right"
      className={cn(open && panel === id && "bg-muted text-foreground")}
      onMouseEnter={() => hover(id)}
      onClick={() => click(id)}
    >
      {PANELS[id].icon}
    </IconButton>
  );

  const pin = (next: Panel) => setFlyout({ panel: next, hovered: false, pinned: true });
  const proposalsValue = useMemo(
    () => ({ harness, preview, review: () => setFlyout({ panel: "harness", hovered: false, pinned: true }) }),
    [harness, preview],
  );
  const shellCommands: MenuItem[] = [
    { id: "shell:sidebar", label: "Toggle sidebar", meta: "⌘B", leading: <PanelLeftIcon />, onSelect: togglePin },
    ...(Object.keys(PANELS) as Panel[]).map((id) => ({
      id: `shell:${id}`,
      label: `Open ${PANELS[id].title}`,
      leading: PANELS[id].icon,
      onSelect: () => pin(id),
    })),
  ];

  return (
    <ProposalsContext value={proposalsValue}>
      <div className="fixed inset-0 overflow-hidden bg-background select-none">
        <nav
          aria-label="Sidebar"
          onMouseEnter={stay}
          onMouseLeave={leave}
          className="absolute top-(--edge) bottom-(--edge) left-(--edge) z-40 flex w-(--rail-width) flex-col items-center gap-0.5 rounded-[7px] bg-surface px-[3px] py-1 shadow-(--shadow-tile)"
        >
          <span
            role="img"
            aria-label={connected ? "ndea, harness connected" : "ndea"}
            className="relative px-1 pt-[3px] pb-1.5 text-ui-lg leading-none font-semibold"
          >
            nd
            {connected && <span className="absolute top-0.5 -right-0.5 size-[5px] rounded-full bg-success" />}
          </span>
          <IconButton size="md" label="Search" description="⌘K" tooltipSide="right" onClick={() => setMenuOpen(true)}>
            <SearchIcon />
          </IconButton>
          <span className="my-1 h-px w-5 shrink-0 bg-border" />
          {railButton("layouts")}
          {railButton("data")}
          {railButton("links")}
          <span className="flex-1" />
          {/* Remounts on each rejected harness edit, so the shake plays once per rejection. */}
          <span key={harness.shake} className={cn("flex", harness.shake > 0 && "animate-nd-shake")}>
            {railButton("harness")}
          </span>
          {railButton("settings")}
          <IconButton
            size="md"
            label="Keep sidebar open"
            description="⌘B"
            tooltipSide="right"
            pressed={pinned}
            onClick={togglePin}
          >
            <PanelLeftIcon />
          </IconButton>
        </nav>
        {open && (
          <aside
            aria-label={PANELS[panel].title}
            onMouseEnter={stay}
            onMouseLeave={pinned ? undefined : leave}
            className="absolute top-(--edge) bottom-(--edge) left-[calc(var(--edge)_+_var(--rail-width)_+_var(--gutter))] z-40 flex w-(--flyout-width) animate-nd-in flex-col overflow-hidden rounded-lg bg-card shadow-(--shadow-popover)"
          >
            <div className="flex shrink-0 items-center gap-1.5 py-1.5 pr-1.5 pl-3">
              <span className="min-w-0 flex-1 truncate text-md font-semibold">{PANELS[panel].title}</span>
              <IconButton
                size="md"
                label={pinned ? "Unpin sidebar" : "Keep sidebar open"}
                description="⌘B"
                pressed={pinned}
                onClick={togglePin}
              >
                <PanelLeftIcon />
              </IconButton>
            </div>
            <div className="min-h-0 flex-1 overflow-auto px-1.5 pb-2">
              {panel === "layouts" && <LayoutsFlyout />}
              {panel === "data" && <DataFlyout />}
              {panel === "links" && <LinksFlyout />}
              {panel === "harness" && <HarnessFlyout />}
              {panel === "settings" && <SettingsFlyout />}
            </div>
          </aside>
        )}
        <main
          className={cn(
            "absolute top-(--edge) right-(--edge) bottom-(--edge)",
            pinned
              ? "left-[calc(var(--edge)_+_var(--rail-width)_+_var(--flyout-width)_+_var(--gutter)_*_2)]"
              : "left-[calc(var(--edge)_+_var(--rail-width)_+_var(--gutter))]",
          )}
        >
          <OpenLinksContext value={() => pin("links")}>
            <DashboardPane />
          </OpenLinksContext>
          <ProposalBar />
        </main>
        <WorkspaceCommandMenu open={menuOpen} onOpenChange={setMenuOpen} shellCommands={shellCommands} />
      </div>
    </ProposalsContext>
  );
}
