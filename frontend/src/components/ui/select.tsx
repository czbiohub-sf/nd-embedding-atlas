import { cn } from "@/lib/utils";

interface SelectOption {
  value: string;
  label: string;
}

interface CompactSelectProps {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

export function CompactSelect({
  options,
  value,
  onChange,
  disabled = false,
  placeholder,
  className,
}: CompactSelectProps) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className={cn(
        "h-6 rounded border border-border bg-input px-1.5 text-xs text-foreground",
        "focus:outline-none focus:ring-1 focus:ring-ring",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}
