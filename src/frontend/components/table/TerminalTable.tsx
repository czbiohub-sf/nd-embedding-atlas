/**
 * TerminalTable — ⌘J-toggled floating card above the status footer.
 * Tabs: Table | Track | Gallery. Open/size driven by the panel registry.
 */

import { DatabaseIcon } from "lucide-react";
import { useState } from "react";
import { useSelector } from "@tanstack/react-store";
import { useDashboard } from "../../hooks/useDashboard";
import { capabilitiesOf } from "../../lib/capabilities";
import { selectionSyncStore } from "../../stores/SelectionSyncStore";
import { Kbd, KbdGroup, KbdMod } from "../ui/kbd";
import { SlidePanel } from "../ui/slide-panel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { GalleryPane } from "../gallery/GalleryPane";
import { DataTable } from "./DataTable";
import { TrackPane } from "./TrackPane";

const FALLBACK_TABLE_COLUMNS = ["_dataset"];

export function TerminalTable() {
  const [totalCount, setTotalCount] = useState(0);
  const { state, actions, meta } = useDashboard();
  const { metadata, highlightId, trajectories } = state;
  const hasAnyTrajectory = Object.keys(trajectories).length > 0;
  const hasGallerySelection = useSelector(selectionSyncStore, (s) => s.type === "active");
  const galleryEnabled = capabilitiesOf(metadata).has("plate-image");
  const { coordinator, brushSelection, table } = meta;

  return (
    <SlidePanel id="table">
      <SlidePanel.Content>
        <SlidePanel.ResizeHandle />
        <Tabs defaultValue="table" className="flex min-h-0 flex-1 flex-col">
          <SlidePanel.Header icon={DatabaseIcon} className="gap-0 py-1.5 pr-2 pl-3">
            <TabsList className="border-b-0 bg-transparent px-0">
              <TabsTrigger value="table">
                Table
                {totalCount > 0 && (
                  <span className="ml-1.5 text-3xs text-muted-foreground/50 tabular-nums">
                    {totalCount.toLocaleString()}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="track">
                Track
                {hasAnyTrajectory && <span className="ml-1.5 inline-block size-1.5 rounded-full bg-primary/70" />}
              </TabsTrigger>
              {galleryEnabled && (
                <TabsTrigger value="gallery">
                  Gallery
                  {hasGallerySelection && <span className="ml-1.5 inline-block size-1.5 rounded-full bg-primary/70" />}
                </TabsTrigger>
              )}
            </TabsList>
          </SlidePanel.Header>

          <SlidePanel.Body className="flex flex-col">
            <TabsContent value="table" className="flex flex-col overflow-hidden">
              <DataTable
                coordinator={coordinator}
                table={table}
                columns={metadata.obs_columns ?? FALLBACK_TABLE_COLUMNS}
                selection={brushSelection}
                highlightId={highlightId}
                onRowClick={(id) => actions.setHighlight(id)}
                onTotalCountChange={setTotalCount}
              />
            </TabsContent>

            <TabsContent value="track" className="flex flex-col overflow-hidden">
              <TrackPane />
            </TabsContent>

            {galleryEnabled && (
              <TabsContent value="gallery" className="flex flex-col overflow-hidden">
                <GalleryPane />
              </TabsContent>
            )}
          </SlidePanel.Body>

          <SlidePanel.Footer>
            <span className="inline-flex items-center gap-1.5">
              Toggle
              <KbdGroup>
                <KbdMod />
                <Kbd>J</Kbd>
              </KbdGroup>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Kbd>Esc</Kbd> to close
            </span>
          </SlidePanel.Footer>
        </Tabs>
      </SlidePanel.Content>
    </SlidePanel>
  );
}
