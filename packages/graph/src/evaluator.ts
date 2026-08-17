import { Store } from "@tanstack/store";
import {
  GraphEngine,
  type GraphEngineOptions,
  type GraphEvaluationEdge,
  type GraphNodeEvaluationSpec,
  type GraphSinkListener,
} from "./engine";
import type { GraphPortValue } from "./values";

export interface GraphEvaluationState {
  epoch: number;
  cooking: Record<string, boolean>;
  dirty: Record<string, boolean>;
  cookMs: Record<string, number>;
  enabled: boolean;
}

export type GraphEvaluationStore = Pick<Store<GraphEvaluationState>, "state" | "get" | "subscribe">;

export interface GraphEvaluatorOptions extends GraphEngineOptions<GraphPortValue> {
  onFlush?: () => void;
}

/** Owns the engine and live telemetry for NDEA graph-runtime values. */
export class GraphEvaluator {
  private readonly engine: GraphEngine<GraphPortValue>;
  private readonly telemetryStore = new Store<GraphEvaluationState>({
    epoch: 0,
    cooking: {},
    dirty: {},
    cookMs: {},
    enabled: true,
  });
  readonly telemetry: GraphEvaluationStore = this.telemetryStore;
  private readonly unsubscribeTelemetry: () => void;

  constructor({ onFlush, ...engineOptions }: GraphEvaluatorOptions = {}) {
    this.engine = new GraphEngine(engineOptions);
    this.unsubscribeTelemetry = this.engine.onTelemetry((event) => {
      if (event.type === "flush") {
        onFlush?.();
        return;
      }
      this.telemetryStore.setState((state) => {
        switch (event.type) {
          case "emit":
            return { ...state, epoch: event.epoch };
          case "dirty":
            return { ...state, epoch: event.epoch, dirty: { ...state.dirty, [event.node]: true } };
          case "cook-start":
            return { ...state, epoch: event.epoch, cooking: { ...state.cooking, [event.node]: true } };
          case "cook-end": {
            const cooking = { ...state.cooking };
            delete cooking[event.node];
            const dirty = { ...state.dirty };
            delete dirty[event.node];
            return {
              ...state,
              epoch: event.epoch,
              cooking,
              dirty,
              cookMs: event.ms === undefined ? state.cookMs : { ...state.cookMs, [event.node]: event.ms },
            };
          }
          default:
            return state;
        }
      });
    });
  }

  get epoch(): number {
    return this.engine.epoch;
  }

  addNode(spec: GraphNodeEvaluationSpec<GraphPortValue>): void {
    this.engine.addNode(spec);
  }

  removeNode(id: string): void {
    this.engine.removeNode(id);
  }

  canConnect(edge: Pick<GraphEvaluationEdge, "from" | "to">): boolean {
    return this.engine.canConnect(edge);
  }

  connect(edge: GraphEvaluationEdge): boolean {
    return this.engine.connect(edge);
  }

  disconnect(edge: GraphEvaluationEdge): void {
    this.engine.disconnect(edge);
  }

  markDirty(id: string): void {
    this.engine.markDirty(id);
  }

  emit(id: string, port: string, value: GraphPortValue): void {
    this.engine.emit(id, port, value);
  }

  getEmission(id: string, port: string): GraphPortValue | undefined {
    return this.engine.getEmission(id, port);
  }

  pull(id: string): GraphPortValue {
    return this.engine.pull(id);
  }

  setBypass(id: string, on: boolean): void {
    this.engine.setBypass(id, on);
  }

  setTelemetryEnabled(enabled: boolean): void {
    this.telemetryStore.setState((state) => ({ ...state, enabled }));
  }

  registerSink(id: string, listener: GraphSinkListener<GraphPortValue>): () => void {
    return this.engine.registerSink(id, listener);
  }

  dispose(): void {
    this.unsubscribeTelemetry();
  }
}
