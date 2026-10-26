import type { ComponentHost, ComponentModule, MountedBody } from "@ndea/sdk";

import type { AnyComponentDefinition } from "@/core/component/definitions";
import type { HostHandle } from "./host";

type ComponentFailureStage = "module" | "host" | "body";

type ComponentRuntimeState =
  | { readonly status: "unloaded" }
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly element: HTMLElement }
  | { readonly status: "failed"; readonly stage: ComponentFailureStage; readonly error: Error }
  | { readonly status: "disposed" };

export interface ComponentRuntimeDependencies {
  readonly definition: AnyComponentDefinition;
  readonly dockElement: HTMLElement;
  createHost(definition: AnyComponentDefinition): HostHandle<unknown>;
}

interface LiveAttempt {
  hostHandle: HostHandle<unknown> | null;
  body: MountedBody | null;
}

const UNLOADED: ComponentRuntimeState = Object.freeze({ status: "unloaded" });
const LOADING: ComponentRuntimeState = Object.freeze({ status: "loading" });
const DISPOSED: ComponentRuntimeState = Object.freeze({ status: "disposed" });

function errorOf(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function aggregateFailure(primary: Error, teardownErrors: unknown[]): Error {
  if (teardownErrors.length === 0) return primary;
  return new AggregateError([primary, ...teardownErrors.map(errorOf)], `${primary.message}; attempt teardown failed`);
}

function isComponentModule(value: unknown): value is ComponentModule {
  return value !== null && typeof value === "object" && typeof Reflect.get(value, "mountBody") === "function";
}

/**
 * One dashboard element's body. A render can observe it but cannot make it load or
 * mount twice: only `start` and explicit `retry` advance the state machine.
 */
export class ComponentRuntime {
  private readonly dependencies: ComponentRuntimeDependencies;
  private stateValue: ComponentRuntimeState = UNLOADED;
  private readonly listeners = new Set<() => void>();
  private attempt: LiveAttempt = { hostHandle: null, body: null };
  private operation: Promise<void> | null = null;
  private generation = 0;

  constructor(dependencies: ComponentRuntimeDependencies) {
    this.dependencies = dependencies;
  }

  getSnapshot = (): ComponentRuntimeState => this.stateValue;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  start(): Promise<void> {
    if (this.stateValue.status === "disposed") return Promise.reject(new Error("component runtime is disposed"));
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
      return Promise.reject(new Error(`cannot retry component runtime from ${this.stateValue.status}`));
    }
    this.attempt = { hostHandle: null, body: null };
    this.setState(UNLOADED);
    return this.start();
  }

  dispose(): void {
    if (this.stateValue.status === "disposed") return;
    ++this.generation;
    this.setState(DISPOSED);
    const errors = this.disposeAttempt();
    if (errors.length === 1) throw errorOf(errors[0]);
    if (errors.length > 1) throw new AggregateError(errors, "component runtime disposal failed");
  }

  private async loadAttempt(generation: number): Promise<void> {
    const { definition } = this.dependencies;
    let loaded: unknown;
    try {
      loaded = await definition.load();
    } catch (error) {
      this.fail(generation, "module", errorOf(error));
      return;
    }
    if (!isComponentModule(loaded)) {
      this.fail(
        generation,
        "module",
        new TypeError(`component ${definition.type} load did not return a module with mountBody`),
      );
      return;
    }
    const module = loaded;
    if (!this.isCurrent(generation)) return;

    let host: ComponentHost;
    try {
      const hostHandle = this.dependencies.createHost(definition);
      this.attempt.hostHandle = hostHandle;
      host = hostHandle.host;
    } catch (error) {
      this.failAttempt(generation, "host", errorOf(error));
      return;
    }
    if (!this.isCurrent(generation)) {
      this.disposeAttempt();
      return;
    }

    let body: MountedBody;
    try {
      body = await module.mountBody(host);
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

  private failAttempt(generation: number, stage: ComponentFailureStage, error: Error): void {
    const teardownErrors = this.disposeAttempt();
    this.fail(generation, stage, aggregateFailure(error, teardownErrors));
  }

  private fail(generation: number, stage: ComponentFailureStage, error: Error): void {
    if (!this.isCurrent(generation)) return;
    this.setState(Object.freeze({ status: "failed", stage, error }));
  }

  private isCurrent(generation: number): boolean {
    return generation === this.generation && this.stateValue.status !== "disposed";
  }

  private disposeAttempt(): unknown[] {
    const { body, hostHandle } = this.attempt;
    this.attempt = { hostHandle: null, body: null };
    const errors: unknown[] = [];
    for (const dispose of [body ? () => body.dispose() : null, hostHandle ? () => hostHandle.dispose() : null]) {
      if (!dispose) continue;
      try {
        dispose();
      } catch (error) {
        errors.push(error);
      }
    }
    return errors;
  }

  private setState(state: ComponentRuntimeState): void {
    if (this.stateValue === state) return;
    this.stateValue = state;
    for (const listener of this.listeners) listener();
  }
}
