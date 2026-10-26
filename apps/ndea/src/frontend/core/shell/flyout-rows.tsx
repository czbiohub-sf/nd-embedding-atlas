/** The rows and section headings every rail flyout is built from, and the MCP endpoint row (Harness, Settings). */

import { CopyIcon } from "lucide-react";
import { toast } from "sonner";

import { IconButton } from "@ndea/ui/components/icon-button";
import { cn } from "@ndea/ui/lib/utils";

export function Heading({ children }: { children: React.ReactNode }) {
  return <div className="px-2 pt-3.5 pb-1 text-sm font-medium text-text-muted first:pt-1">{children}</div>;
}

export function Row({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("flex items-center gap-2 rounded-md px-2 py-1.5", className)}>{children}</div>;
}

export function Muted({ children }: { children: React.ReactNode }) {
  return <div className="px-2 py-1.5 text-text-muted">{children}</div>;
}

export function McpEndpoint() {
  const url = `${window.location.origin}/mcp`;
  const copy = () =>
    navigator.clipboard.writeText(url).then(
      () => toast("MCP endpoint copied", { description: url }),
      (error: unknown) => toast.error("Copy failed", { description: String(error) }),
    );
  return (
    <Row className="pr-1">
      <span className="min-w-0 flex-1 truncate font-mono text-ui-sm">{url}</span>
      <IconButton size="md" label="Copy MCP endpoint" onClick={() => void copy()}>
        <CopyIcon />
      </IconButton>
    </Row>
  );
}
