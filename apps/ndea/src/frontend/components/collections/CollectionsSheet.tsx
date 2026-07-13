import { Bookmark } from "lucide-react";
import { SlidePanel } from "@/components/ui/slide-panel";
import { CollectionsSheetBody } from "./CollectionsSheetBody";

export function CollectionsSheet() {
  return (
    <SlidePanel id="collections">
      <SlidePanel.Content>
        <SlidePanel.Header icon={Bookmark} title="Collections" />
        <SlidePanel.Body>
          <CollectionsSheetBody />
        </SlidePanel.Body>
      </SlidePanel.Content>
    </SlidePanel>
  );
}
