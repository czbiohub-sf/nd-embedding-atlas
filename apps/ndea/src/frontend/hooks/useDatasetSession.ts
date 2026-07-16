import { useSelector } from "@tanstack/react-store";
import { datasetSessionStore, type DatasetSessionValue } from "@/core/session/dataset-session";

export function useDatasetSession(): DatasetSessionValue {
  const session = useSelector(datasetSessionStore, (value) => value);
  if (session === null) {
    throw new Error("useDatasetSession must be used within DatasetSessionProvider");
  }
  return session;
}
