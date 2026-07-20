import { CheckIcon, ChevronDownIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useSheetBoundary } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

export interface ComboboxOption {
  value: string;
  label: string;
}

export interface ComboboxProps<O extends ComboboxOption = ComboboxOption> {
  value: string;
  onValueChange: (value: string) => void;
  options: O[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  /** Extra className on the PopoverContent panel */
  contentClassName?: string;
  /** Extra className on the trigger button */
  triggerClassName?: string;
  /** Side to open the popover. Defaults to "bottom". */
  side?: "top" | "bottom" | "left" | "right";
  /** Optional ref to a container element. Used as the popover's collision boundary
   * so it stays inside e.g. a floating Sheet panel rather than the full viewport. */
  collisionBoundary?: Element | Element[] | null;
  /**
   * Optional leading slot per option (e.g. a color swatch). Renders before
   * the label inside both the trigger (for the selected option) and each
   * dropdown row. Receiving the option lets callers pull arbitrary fields
   * (e.g. `opt.color`) without sub-classing.
   */
  leading?: (opt: O) => ReactNode;
  /**
   * Optional trailing slot per option (e.g. a count or badge). Renders
   * after the label, right-aligned via `ml-auto` inside dropdown rows.
   * Not rendered in the trigger by default: pass `triggerTrailing` if
   * you also want it visible when collapsed.
   */
  trailing?: (opt: O) => ReactNode;
  /** When true (default false), renders `trailing` inside the trigger too. */
  triggerTrailing?: boolean;
  /**
   * When true, hide the dropdown chevron and let the trigger size to its
   * content (no `flex-1` on the label). Used for the compact "chip" triggers
   * in the scatter overlay where the brackets/fill carry the affordance.
   */
  hideChevron?: boolean;
}

/**
 * Combobox: searchable dropdown built from Popover + Command.
 *
 * Use when the options list may be large (10+) or needs filtering.
 *
 * Slot model: `leading` and `trailing` are optional render props per
 * option: they keep the row layout consistent (free a11y + truncation
 * via `flex-1` on the label) while letting consumers add visual prefixes
 * (color swatches, icons) and trailing meta (counts, badges). Don't pass
 * a custom `renderOption`; the constrained slot shape is intentional.
 */
export function Combobox<O extends ComboboxOption = ComboboxOption>({
  value,
  onValueChange,
  options,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  emptyText = "No results.",
  disabled,
  contentClassName,
  triggerClassName,
  side = "bottom",
  collisionBoundary,
  leading,
  trailing,
  triggerTrailing = false,
  hideChevron = false,
}: ComboboxProps<O>) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);
  const sheetBoundary = useSheetBoundary();
  const effectiveBoundary = collisionBoundary ?? sheetBoundary;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={disabled}
        aria-expanded={open}
        className={cn(
          "flex h-7 min-w-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-input bg-input/20 px-2 text-xs/relaxed outline-none transition-colors",
          "hover:bg-input/40 focus-visible:ring-2 focus-visible:ring-ring/30",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "dark:bg-input/30",
          triggerClassName,
        )}
      >
        {selected && leading ? leading(selected) : null}
        <span className={cn("truncate text-left", !hideChevron && "flex-1", !selected && "text-muted-foreground")}>
          {selected?.label ?? placeholder}
        </span>
        {selected && triggerTrailing && trailing ? trailing(selected) : null}
        {!hideChevron && <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" />}
      </PopoverTrigger>
      <PopoverContent
        className={cn("max-h-[240px] w-52 overflow-hidden p-0", contentClassName)}
        side={side}
        align="start"
        sideOffset={4}
        collisionBoundary={effectiveBoundary ?? undefined}
        collisionPadding={12}
      >
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {options.map((opt) => (
                <CommandItem
                  key={opt.value}
                  value={opt.value}
                  onSelect={(v) => {
                    onValueChange(v === value ? "" : v);
                    setOpen(false);
                  }}
                  className="gap-1.5"
                >
                  <CheckIcon className={cn("size-3 shrink-0", opt.value === value ? "opacity-100" : "opacity-0")} />
                  {leading ? leading(opt) : null}
                  <span className="flex-1 truncate">{opt.label}</span>
                  {trailing ? trailing(opt) : null}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
