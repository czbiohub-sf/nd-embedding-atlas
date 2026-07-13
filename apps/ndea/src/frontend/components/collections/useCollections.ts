/**
 * useCollections — TanStack Query hooks over /api/collections.
 *
 * Mutation hooks are UI-agnostic: they return the parsed envelope (Create
 * + AddMembers) or the raw Collection (Patch) and invalidate the list
 * query on success. Toasts and other UI side-effects belong at call sites.
 *
 * Hook onSuccess runs FIRST (invalidation), then any options.onSuccess
 * passed by the caller — useful for sequencing toasts after the cache
 * refreshes. Use `mutateAsync` + await if you need ordering across
 * multiple mutations.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  type AppendMembersBody,
  CollectionMutationResultSchema,
  type CollectionMutationResult,
  CollectionSchema,
  type Collection,
} from "@ndea/protocol";
import type { CollectionId } from "../../lib/branded-types";

const CollectionListSchema = z.array(CollectionSchema);

interface CreateCollectionBase {
  name: string;
  color?: string | null;
  notes?: string | null;
  tags?: string[];
  provenance?: unknown;
}

export type CreateCollectionBody =
  | (CreateCollectionBase & {
      members: { dataset_key: string; obs_name: string }[];
      row_indices?: never;
      from_scatter_selection?: never;
    })
  | (CreateCollectionBase & { row_indices: number[]; members?: never; from_scatter_selection?: never })
  | (CreateCollectionBase & { from_scatter_selection: true; members?: never; row_indices?: never });

export interface PatchCollectionBody {
  name?: string;
  color?: string | null;
  notes?: string | null;
  tags?: string[];
  version: number;
}

export type { AppendMembersBody };

export function useCollections() {
  return useQuery({
    queryKey: ["collections"],
    queryFn: async (): Promise<Collection[]> => {
      const r = await fetch("/api/collections");
      const data: unknown = await r.json().catch(() => null);
      if (!r.ok) {
        const msg =
          data && typeof data === "object" && "error" in data && typeof (data as { error: unknown }).error === "string"
            ? (data as { error: string }).error
            : `HTTP ${r.status}`;
        throw new Error(msg);
      }
      return CollectionListSchema.parse(data);
    },
    staleTime: 30_000,
  });
}

/**
 * Create a collection. Returns the full envelope so call sites can show
 * dedupe counts in the success toast (e.g. "Saved · 1,240 added, 87
 * already in collection").
 */
export function useCreateCollection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateCollectionBody): Promise<CollectionMutationResult> => {
      const r = await fetch("/api/collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
      return CollectionMutationResultSchema.parse(data);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["collections"] }),
  });
}

export function usePatchCollection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: CollectionId; body: PatchCollectionBody }): Promise<Collection> => {
      const r = await fetch(`/api/collections/${args.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args.body),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
      return CollectionSchema.parse(data);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["collections"] }),
  });
}

export function useDeleteCollection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: CollectionId): Promise<void> => {
      const r = await fetch(`/api/collections/${id}`, { method: "DELETE" });
      if (!r.ok) {
        const data = await r.json().catch(() => null);
        const msg =
          data && typeof data === "object" && "error" in data && typeof (data as { error: unknown }).error === "string"
            ? (data as { error: string }).error
            : `HTTP ${r.status}`;
        throw new Error(msg);
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["collections"] }),
  });
}

/**
 * Append additional members to an existing collection.
 *
 * Body is `AppendMembersBody` — does NOT take `name` (server schema split
 * from create in PR2; older code that sent `{name: "ignored"}` should be
 * updated to match).
 */
export function useAddMembers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: CollectionId; body: AppendMembersBody }): Promise<CollectionMutationResult> => {
      const r = await fetch(`/api/collections/${args.id}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args.body),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
      return CollectionMutationResultSchema.parse(data);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["collections"] }),
  });
}

// Activate is no longer a per-call mutation — it's driven by the
// activeCollectionStore subscriber in DashboardProvider, which calls
// POST /api/active-selection directly. Components flip activation by
// calling setActiveCollection(id) from ActiveCollectionStore.
