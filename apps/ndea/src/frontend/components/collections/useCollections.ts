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
import {
  type AppendMembersBody,
  CollectionListResponseSchema,
  CollectionMutationResultSchema,
  type CollectionMutationResult,
  CollectionSchema,
  type Collection,
  type CreateCollectionBody,
  ErrorResponseSchema,
  type PatchCollectionBody,
} from "@ndea/protocol";
import type { CollectionId } from "../../lib/branded-types";

export type { AppendMembersBody, CreateCollectionBody, PatchCollectionBody };

function errorMessage(data: unknown, fallback: string): string {
  const parsed = ErrorResponseSchema.safeParse(data);
  return parsed.success ? parsed.data.error : fallback;
}

export function useCollections() {
  return useQuery({
    queryKey: ["collections"],
    queryFn: async (): Promise<Collection[]> => {
      const r = await fetch("/api/collections");
      const data: unknown = await r.json().catch(() => null);
      if (!r.ok) {
        throw new Error(errorMessage(data, `HTTP ${r.status}`));
      }
      return CollectionListResponseSchema.parse(data);
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
      const data: unknown = await r.json();
      if (!r.ok) throw new Error(errorMessage(data, `HTTP ${r.status}`));
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
      const data: unknown = await r.json();
      if (!r.ok) throw new Error(errorMessage(data, `HTTP ${r.status}`));
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
        const data: unknown = await r.json().catch(() => null);
        throw new Error(errorMessage(data, `HTTP ${r.status}`));
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
      const data: unknown = await r.json();
      if (!r.ok) throw new Error(errorMessage(data, `HTTP ${r.status}`));
      return CollectionMutationResultSchema.parse(data);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["collections"] }),
  });
}
