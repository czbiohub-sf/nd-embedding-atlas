import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { CollectionsSheetBody } from "./CollectionsSheetBody";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CollectionsSheet({ open, onOpenChange }: Props) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex flex-col gap-0 border-border-subtle p-0">
        <SheetHeader className="flex flex-row items-center gap-3 border-border-subtle border-b p-4">
          <span className="inline-flex size-7 items-center justify-center rounded-md bg-emphasis text-[hsl(var(--accent))]">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              aria-hidden
            >
              <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
            </svg>
          </span>
          <div className="min-w-0 flex-1">
            <SheetTitle>Collections</SheetTitle>
            <SheetDescription>Saved selections — lassos, predicates, derived sets.</SheetDescription>
          </div>
        </SheetHeader>
        <CollectionsSheetBody />
      </SheetContent>
    </Sheet>
  );
}
