import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { z } from "zod";
import type { ObsSetId } from "../../lib/branded-types";
import type { ObsSet } from "../../lib/schemas";
import { ObsSetSchema } from "../../lib/schemas";
import { obsSetStore, setActiveObsSet, updateObsSets } from "../../stores/ObsSetStore";

const ObsSetListSchema = z.array(ObsSetSchema);

export interface CreateObsSetBody {
  name: string;
  color?: string | null;
  members: { dataset_key: string; obs_name: string }[];
}

export function useObsSets() {
  const query = useQuery({
    queryKey: ["obssets"],
    queryFn: (): Promise<ObsSet[]> =>
      fetch("/api/obssets")
        .then((r) => r.json())
        .then((d) => ObsSetListSchema.parse(d)),
    staleTime: 30_000,
  });

  // Sync server data → obsSetStore outside React render cycle
  useEffect(() => {
    if (query.data) updateObsSets(query.data);
  }, [query.data]);

  return query;
}

export function useCreateObsSet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateObsSetBody): Promise<ObsSet> =>
      fetch("/api/obssets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then((r) => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["obssets"] }),
  });
}

export function useDeleteObsSet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: ObsSetId): Promise<void> => fetch(`/api/obssets/${id}`, { method: "DELETE" }).then(() => {}),
    onSuccess: (_data, deletedId) => {
      // Clear active obsset if it was the deleted one
      if (obsSetStore.state.activeObsSetId === deletedId) {
        setActiveObsSet(null);
      }
      void qc.invalidateQueries({ queryKey: ["obssets"] });
    },
  });
}
