/**
 * ScatterUIStateProvider — lightweight context for real-time scatter metrics.
 *
 * The scatter panel pushes FPS, zoom, and selection count here via the
 * `useScatterUIDispatch` hook. The status bar (and any other consumer)
 * reads from `useScatterUIState` without prop drilling through DashboardShell.
 */
import { createContext, use, useCallback, useReducer } from "react";

interface ScatterUIState {
    fps: number | null;
    zoom: number;
    selectedCount: number | null;
    embeddingKey: string | null;
    numPoints: number;
}

type ScatterUIAction =
    | { type: "SET_FPS"; fps: number }
    | { type: "SET_ZOOM"; zoom: number }
    | { type: "SET_SELECTION"; count: number | null }
    | { type: "SET_EMBEDDING"; key: string | null }
    | { type: "SET_NUM_POINTS"; n: number };

const initial: ScatterUIState = {
    fps: null,
    zoom: 1,
    selectedCount: null,
    embeddingKey: null,
    numPoints: 0,
};

function reducer(state: ScatterUIState, action: ScatterUIAction): ScatterUIState {
    switch (action.type) {
        case "SET_FPS":       return { ...state, fps: action.fps };
        case "SET_ZOOM":      return { ...state, zoom: action.zoom };
        case "SET_SELECTION": return { ...state, selectedCount: action.count };
        case "SET_EMBEDDING":  return { ...state, embeddingKey: action.key };
        case "SET_NUM_POINTS": return { ...state, numPoints: action.n };
        default:              return state;
    }
}

const StateContext   = createContext<ScatterUIState>(initial);
const DispatchContext = createContext<React.Dispatch<ScatterUIAction>>(() => {});

export function ScatterUIStateProvider({ children }: { children: React.ReactNode }) {
    const [state, dispatch] = useReducer(reducer, initial);
    return (
        <StateContext value={state}>
            <DispatchContext value={dispatch}>
                {children}
            </DispatchContext>
        </StateContext>
    );
}

export function useScatterUIState(): ScatterUIState {
    return use(StateContext);
}

/** Returns stable dispatch callbacks for the scatter panel to call. */
export function useScatterUIDispatch() {
    const dispatch = use(DispatchContext);
    return {
        setFps:       useCallback((fps: number)          => dispatch({ type: "SET_FPS", fps }),           [dispatch]),
        setZoom:      useCallback((zoom: number)          => dispatch({ type: "SET_ZOOM", zoom }),          [dispatch]),
        setSelection: useCallback((count: number | null)  => dispatch({ type: "SET_SELECTION", count }),    [dispatch]),
        setEmbedding: useCallback((key: string | null)    => dispatch({ type: "SET_EMBEDDING", key }),      [dispatch]),
        setNumPoints: useCallback((n: number)             => dispatch({ type: "SET_NUM_POINTS", n }),        [dispatch]),
    };
}
