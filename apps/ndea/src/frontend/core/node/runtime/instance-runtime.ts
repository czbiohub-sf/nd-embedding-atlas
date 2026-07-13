import type { ExactNodeTypeRef, MountedNodeBody, NodeModule, NodeRuntime } from "@ndea/sdk";

import type { NodeCatalog } from "@/core/plugin/catalog";
import type { CatalogNodeDefinition } from "@/core/plugin/registration";
import { assertNodeHostCapabilities } from "@/core/node/host-capabilities";
import type { HostHandle } from "./host";

export type NodeInstanceRuntimeStatus = "unloaded" | "loading" | "ready" | "failed" | "disposed";
export type NodeInstanceFailureStage = "definition" | "module" | "capability" | "runtime" | "body" | "teardown";

export type NodeInstanceRuntimeState =
  | { readonly status: "unloaded" }
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly element: HTMLElement }
  | { readonly status: "failed"; readonly stage: NodeInstanceFailureStage; readonly error: Error }
  | { readonly status: "disposed" };

export interface NodeInstanceRuntimeDependencies {
  readonly catalog: NodeCatalog;
  readonly definitionRef: ExactNodeTypeRef;
  readonly dockElement: HTMLElement;
  createHost(definition: CatalogNodeDefinition): HostHandle<unknown>;
}

interface LiveAttempt {
  module: NodeModule | null;
  hostHandle: HostHandle<unknown> | null;
  moduleRuntime: NodeRuntime | null;
  body: MountedNodeBody | null;
}

const UNLOADED: NodeInstanceRuntimeState = Object.freeze({ status: "unloaded" });
const LOADING: NodeInstanceRuntimeState = Object.freeze({ status: "loading" });
const DISPOSED: NodeInstanceRuntimeState = Object.freeze({ status: "disposed" });

function errorOf(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function aggregateFailure(primary: Error, teardownErrors: unknown[]): Error {
  if (teardownErrors.length === 0) return primary;
  return new AggregateError([primary, ...teardownErrors.map(errorOf)], `${primary.message}; attempt teardown failed`);
}

/**
 * One exact node occurrence. A render can observe it but cannot make it load or
 * mount twice: only `start` and explicit `retry` advance the state machine.
 */
export class NodeInstanceRuntime {
  private readonly dependencies: NodeInstanceRuntimeDependencies;
  private stateValue: NodeInstanceRuntimeState = UNLOADED;
  private readonly listeners = new Set<() => void>();
  private attempt: LiveAttempt = { module: null, hostHandle: null, moduleRuntime: null, body: null };
  private operation: Promise<void> | null = null;
  private generation = 0;

  constructor(dependencies: NodeInstanceRuntimeDependencies) {
    this.dependencies = dependencies;
  }

  getSnapshot = (): NodeInstanceRuntimeState => this.stateValue;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  start(): Promise<void> {
    if (this.stateValue.status === "disposed") return Promise.reject(new Error("node instance runtime is disposed"));
    if (this.stateValue.status === "ready" || this.stateValue.status === "failed") return Promise.resolve();
    if (this.operation) return this.operation;

    const generation = ++this.generation;
    this.setState(LOADING);
    const operation = this.loadAttempt(generation).finally(() => {
      if (this.operation === operation) this.operation = null;
    });
    this.operation = operation;
    return operation;
  }

  retry(): Promise<void> {
    if (this.stateValue.status !== "failed") {
      return Promise.reject(new Error(`cannot retry node instance runtime from ${this.stateValue.status}`));
    }
    this.attempt = { module: null, hostHandle: null, moduleRuntime: null, body: null };
    this.setState(UNLOADED);
    return this.start();
  }

  dispose(): void {
    if (this.stateValue.status === "disposed") return;
    ++this.generation;
    this.setState(DISPOSED);
    const errors = this.disposeAttempt();
    if (errors.length === 1) throw errorOf(errors[0]);
    if (errors.length > 1) throw new AggregateError(errors, "node instance runtime disposal failed");
  }

  private async loadAttempt(generation: number): Promise<void> {
    const definition = this.dependencies.catalog.resolveExact(this.dependencies.definitionRef);
    if (!definition) {
      this.fail(
        generation,
        "definition",
        new Error(
          `node definition not found: ${this.dependencies.definitionRef.nodeTypeId}@${this.dependencies.definitionRef.nodeTypeVersion}`,
        ),
      );
      return;
    }
    if (!definition.load) {
      this.fail(
        generation,
        "module",
        new Error(`node definition has no module: ${definition.ref.nodeTypeId}@${definition.ref.nodeTypeVersion}`),
      );
      return;
    }

    let module: NodeModule;
    try {
      module = (await definition.load()) as NodeModule;
    } catch (error) {
      this.fail(generation, "module", errorOf(error));
      return;
    }
    if (!module || typeof module !== "object") {
      this.fail(generation, "module", new TypeError("node definition load did not return a module"));
      return;
    }
    if (!this.isCurrent(generation)) return;
    this.attempt.module = module;

    try {
      this.attempt.hostHandle = this.dependencies.createHost(definition);
      assertNodeHostCapabilities(definition, this.attempt.hostHandle.host);
    } catch (error) {
      this.failAttempt(generation, "capability", errorOf(error));
      return;
    }
    if (!this.isCurrent(generation)) {
      this.disposeAttempt();
      return;
    }

    if (module.createRuntime) {
      try {
        this.attempt.moduleRuntime = module.createRuntime(this.attempt.hostHandle.host);
      } catch (error) {
        this.failAttempt(generation, "runtime", errorOf(error));
        return;
      }
    }

    if (!module.mountBody) {
      this.failAttempt(
        generation,
        "body",
        new Error(`node module has no Body mount: ${definition.ref.nodeTypeId}@${definition.ref.nodeTypeVersion}`),
      );
      return;
    }

    let body: MountedNodeBody;
    try {
      body = await module.mountBody(this.attempt.hostHandle.host);
    } catch (error) {
      this.failAttempt(generation, "body", errorOf(error));
      return;
    }

    if (!this.isCurrent(generation)) {
      body.dispose();
      return;
    }

    this.attempt.body = body;
    try {
      this.dependencies.dockElement.appendChild(body.element);
    } catch (error) {
      this.failAttempt(generation, "body", errorOf(error));
      return;
    }
    this.setState(Object.freeze({ status: "ready", element: body.element }));
  }

  private failAttempt(generation: number, stage: NodeInstanceFailureStage, error: Error): void {
    const teardownErrors = this.disposeAttempt();
    this.fail(generation, stage, aggregateFailure(error, teardownErrors));
  }

  private fail(generation: number, stage: NodeInstanceFailureStage, error: Error): void {
    if (!this.isCurrent(generation)) return;
    this.setState(Object.freeze({ status: "failed", stage, error }));
  }

  private isCurrent(generation: number): boolean {
    return generation === this.generation && this.stateValue.status !== "disposed";
  }

  private disposeAttempt(): unknown[] {
    const { body, moduleRuntime, hostHandle } = this.attempt;
    this.attempt = { module: null, hostHandle: null, moduleRuntime: null, body: null };
    const errors: unknown[] = [];
    for (const dispose of [
      body ? () => body.dispose() : null,
      moduleRuntime ? () => moduleRuntime.dispose() : null,
      hostHandle ? () => hostHandle.dispose() : null,
    ]) {
      if (!dispose) continue;
      try {
        dispose();
      } catch (error) {
        errors.push(error);
      }
    }
    return errors;
  }

  private setState(state: NodeInstanceRuntimeState): void {
    if (this.stateValue === state) return;
    this.stateValue = state;
    for (const listener of this.listeners) listener();
  }
}
