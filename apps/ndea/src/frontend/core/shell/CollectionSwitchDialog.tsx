/** The one confirm dialog for a collection switch, from the Data flyout or ⌘K. Mounted once, with the ⌘K menu. */

import { useSelector } from "@tanstack/react-store";
import { toast } from "sonner";

import { Button } from "@ndea/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@ndea/ui/components/dialog";

import { pendingSwitch } from "./collections";

async function switchCollection(name: string): Promise<void> {
  const res = await fetch("/api/collection", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  // On success `session/watch` reloads every tab, this one included.
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
}

const close = () => pendingSwitch.setState((s) => ({ ...s, open: false }));

export function CollectionSwitchDialog() {
  const { name, open } = useSelector(pendingSwitch, (s) => s);
  const confirm = () => {
    close();
    toast.promise(switchCollection(name), {
      loading: `Loading collection ${name}…`,
      success: "Reloading",
      error: (error: Error) => `Switch failed: ${error.message}`,
    });
  };
  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Switch to {name}?</DialogTitle>
          <DialogDescription>Switching re-loads the data; views keep their settings.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button onClick={confirm}>Switch</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
