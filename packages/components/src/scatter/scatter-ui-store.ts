import { useSelector } from "@tanstack/react-store";
import { Store } from "@tanstack/store";

export interface ScatterUIState {
  fps: number | null;
  zoom: number;
  selectedCount: number | null;
  embeddingKey: string | null;
  numPoints: number;
  statusMsg: string | null;
}

const scatterUIStore = new Store<ScatterUIState>({
  fps: null,
  zoom: 1,
  selectedCount: null,
  embeddingKey: null,
  numPoints: 0,
  statusMsg: null,
});

const scatterUIActions = Object.freeze({
  setFps(fps: number) {
    scatterUIStore.setState((state) => ({ ...state, fps }));
  },
  setZoom(zoom: number) {
    scatterUIStore.setState((state) => ({ ...state, zoom }));
  },
  setSelection(selectedCount: number | null) {
    scatterUIStore.setState((state) => ({ ...state, selectedCount }));
  },
  setEmbedding(embeddingKey: string | null) {
    scatterUIStore.setState((state) => ({ ...state, embeddingKey }));
  },
  setNumPoints(numPoints: number) {
    scatterUIStore.setState((state) => ({ ...state, numPoints }));
  },
  setStatus(statusMsg: string | null) {
    scatterUIStore.setState((state) => ({ ...state, statusMsg }));
  },
});

export function useScatterUIState(): ScatterUIState {
  return useSelector(scatterUIStore, (state) => state);
}

export function useScatterUIDispatch(): typeof scatterUIActions {
  return scatterUIActions;
}
