import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { useState } from "react";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface ComboboxOption {
  value: string;
  label: string;
}

export interface ComboboxProps {
  value: string;
  onValueChange: (value: string) => void;
  options: ComboboxOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  /** Extra className on the PopoverContent panel */
  contentClassName?: string;
  /** Extra className on the trigger button */
  triggerClassName?: string;
}

/**
 * Combobox — searchable dropdown built from Popover + Command.
 * Use when the options list may be large (10+) or needs filtering.
 */
export function Combobox({
  value,
  onValueChange,
  options,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  emptyText = "No results.",
  disabled,
  contentClassName,
  triggerClassName,
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={disabled}
        aria-expanded={open}
        className={cn(
          "flex h-7 min-w-0 items-center justify-between gap-1.5 whitespace-nowrap rounded-md border border-input bg-input/20 px-2 text-xs/relaxed outline-none transition-colors",
          "hover:bg-input/40 focus-visible:ring-2 focus-visible:ring-ring/30",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "dark:bg-input/30",
          triggerClassName,
        )}
      >
        <span className={cn("flex-1 truncate text-left", !selected && "text-muted-foreground")}>
          {selected?.label ?? placeholder}
        </span>
        <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent className={cn("w-52 p-0", contentClassName)} side="bottom" align="start" sideOffset={4}>
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
                >
                  <CheckIcon
                    className={cn("mr-1 size-3 shrink-0", opt.value === value ? "opacity-100" : "opacity-0")}
                  />
                  {opt.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
