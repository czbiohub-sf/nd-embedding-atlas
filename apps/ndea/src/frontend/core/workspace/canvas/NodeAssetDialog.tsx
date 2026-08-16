import { useEffect, useMemo, useState, type ReactElement } from "react";

import { Button } from "@ndea/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@ndea/ui/components/dialog";
import { Field, FieldLabel } from "@ndea/ui/components/field";
import { Input } from "@ndea/ui/components/input";
import { Textarea } from "@ndea/ui/components/textarea";
import type { NodeAssetParameterDraftBinding } from "@/core/node-asset/authoring";
import { useWorkspace } from "../workspace-context";

interface NodeAssetDialogProps {
  readonly mode: "create" | "edit";
  readonly nodeId?: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

export function NodeAssetDialog({ mode, nodeId, open, onOpenChange }: NodeAssetDialogProps): ReactElement {
  const workspace = useWorkspace();
  const published = useMemo(() => {
    if (!nodeId) return null;
    const node = workspace.store.state.nodes[nodeId];
    return node
      ? (workspace.nodeLibrary.assetSnapshot().assets.getExact(node.definitionRef)?.definition ?? null)
      : null;
  }, [nodeId, workspace]);
  const [title, setTitle] = useState("");
  const [assetId, setAssetId] = useState("");
  const [version, setVersion] = useState("1.0.0");
  const [disposition, setDisposition] = useState<"linked" | "embedded">("linked");
  const [includeFallback, setIncludeFallback] = useState(true);
  const [parameterText, setParameterText] = useState("[]");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTitle(published?.title ?? "");
    setAssetId(published?.assetId ?? "org.local/");
    setVersion(published ? nextPatchVersion(published.assetVersion) : "1.0.0");
    setDisposition("linked");
    setIncludeFallback(true);
    setParameterText("[]");
    setError(null);
  }, [open, published]);

  const submit = () => {
    try {
      const draft =
        mode === "edit" && nodeId
          ? workspace.editNodeAssetDefinition(nodeId, version, title)
          : workspace.createNodeAssetDraft({
              assetId: assetId.trim(),
              assetVersion: version.trim(),
              title: title.trim(),
              parameters: parseParameterBindings(parameterText),
            });
      const selected = workspace.store.state.selectedNodeIds;
      const positions = selected
        .map((id) => workspace.store.state.positions[id])
        .filter((position): position is { x: number; y: number } => Boolean(position));
      const position =
        positions.length > 0
          ? {
              x: positions.reduce((sum, value) => sum + value.x, 0) / positions.length + 260,
              y: positions.reduce((sum, value) => sum + value.y, 0) / positions.length,
            }
          : { x: 120, y: 120 };
      workspace.publishNodeAssetDraft(draft, {
        disposition,
        includeFallback: disposition === "linked" && includeFallback,
        position,
      });
      onOpenChange(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{mode === "edit" ? "Edit node asset definition" : "Create node asset"}</DialogTitle>
          <DialogDescription>
            Publish declarative graph data only. Existing instances remain pinned to their exact version.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Field>
            <FieldLabel>Title</FieldLabel>
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="High-quality observations"
            />
          </Field>
          <Field>
            <FieldLabel>Asset ID</FieldLabel>
            <Input
              value={assetId}
              disabled={mode === "edit"}
              onChange={(event) => setAssetId(event.target.value)}
              placeholder="org.local/high-quality"
            />
          </Field>
          <Field>
            <FieldLabel>New semantic version</FieldLabel>
            <Input value={version} onChange={(event) => setVersion(event.target.value)} placeholder="1.0.0" />
          </Field>
          {mode === "create" ? (
            <Field>
              <FieldLabel>Promoted parameter bindings (JSON)</FieldLabel>
              <Textarea
                value={parameterText}
                onChange={(event) => setParameterText(event.target.value)}
                rows={4}
                spellCheck={false}
                placeholder='[{"id":"threshold","label":"Threshold","nodeId":"filter-1","configPath":["threshold"],"defaultValue":0.5}]'
              />
            </Field>
          ) : null}
          <Field>
            <FieldLabel>Workspace disposition</FieldLabel>
            <select
              className="h-8 rounded-md border border-input bg-background px-2 text-xs"
              value={disposition}
              onChange={(event) => setDisposition(event.target.value as "linked" | "embedded")}
            >
              <option value="linked">Linked user asset</option>
              <option value="embedded">Embedded in Workspace</option>
            </select>
          </Field>
          {disposition === "linked" ? (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={includeFallback}
                onChange={(event) => setIncludeFallback(event.target.checked)}
              />
              Embed an exact offline fallback
            </label>
          ) : null}
          {error ? (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" size="sm" onClick={submit}>
            {mode === "edit" ? "Publish new version" : "Create and publish"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function parseParameterBindings(value: string): readonly NodeAssetParameterDraftBinding[] {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed)) throw new Error("promoted parameter bindings must be a JSON array");
  return parsed as NodeAssetParameterDraftBinding[];
}

function nextPatchVersion(version: string): string {
  const [major, minor, patch] = version.split(".").map(Number);
  if (![major, minor, patch].every(Number.isSafeInteger)) return version;
  return `${major}.${minor}.${patch + 1}`;
}
