import { z } from "zod";
import {
  defineNode,
  exactNodeTypeRef,
  nodeConfigVersion,
  type JsonValue,
  type NodeAvailability,
  type NodeAvailabilityCheck,
  type PluginFactory,
} from "@ndea/sdk";

interface GreetingConfig {
  message: string;
  emphasised: boolean;
}

function availabilityWhileActive(signal: AbortSignal): NodeAvailabilityCheck {
  return (): NodeAvailability =>
    signal.aborted
      ? { available: false, reason: "disabled", detail: "The plugin session has ended." }
      : { available: true };
}

function migrateGreetingV1(value: JsonValue): JsonValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { message: "Hello from a custom node", emphasised: false };
  }
  const record = value as Record<string, JsonValue>;
  return {
    message: typeof record.text === "string" ? record.text : "Hello from a custom node",
    emphasised: false,
  };
}

function passThroughDefinition(signal: AbortSignal) {
  return defineNode({
    ref: exactNodeTypeRef("org.ndea.example/pass-through", "1.0.0"),
    title: "Example Pass Through",
    role: "transform",
    inputs: [{ id: "in", kind: "pred", label: "In" }],
    outputs: [{ id: "out", kind: "pred", label: "Out" }],
    capabilities: ["compute"] as const,
    availability: availabilityWhileActive(signal),
    evaluate(inputs) {
      const input = inputs.get("in")?.[0];
      const predicate = input === null || typeof input === "string" ? input : null;
      return new Map([["out", predicate]]);
    },
    documentation: {
      summary: "Forwards one predicate without changing it.",
      use: "Use this node to verify a custom transform through the plugin boundary.",
    },
    presentation: { icon: "arrow-right" },
  });
}

function greetingDefinition(signal: AbortSignal) {
  const configSchema = z.strictObject({
    message: z.string().min(1).max(120),
    emphasised: z.boolean(),
  });

  return defineNode<GreetingConfig, readonly []>({
    ref: exactNodeTypeRef("org.ndea.example/greeting", "1.0.0"),
    title: "Example Greeting",
    role: "view",
    inputs: [],
    outputs: [{ id: "out", kind: "sel", label: "Selection" }],
    capabilities: [] as const,
    availability: availabilityWhileActive(signal),
    config: {
      schema: configSchema,
      version: nodeConfigVersion(2),
      defaultValue: { message: "Hello from a custom node", emphasised: false },
      migrations: [
        {
          from: nodeConfigVersion(1),
          to: nodeConfigVersion(2),
          migrate: migrateGreetingV1,
        },
      ],
    },
    documentation: {
      summary: "Mounts a framework-neutral Body through the public NodeHost contract.",
      use: "Edit the message to exercise versioned node configuration.",
      note: "Its stylesheet is an allowlisted static plugin asset.",
    },
    presentation: {
      icon: "message-square",
      preferredBodySize: { width: 320, height: 180 },
    },
    evaluate: () => new Map([["out", null]]),
    load: () =>
      Promise.resolve({
        mountBody(host) {
          const element = document.createElement("section");
          element.className = "ndea-example-card";

          const stylesheet = document.createElement("link");
          stylesheet.rel = "stylesheet";
          stylesheet.href = new URL("../assets/styles.css", import.meta.url).href;

          const messageLabel = document.createElement("label");
          messageLabel.textContent = "Message";
          const messageInput = document.createElement("input");
          messageInput.value = host.config.message;
          messageInput.maxLength = 120;
          messageLabel.append(messageInput);

          const emphasisLabel = document.createElement("label");
          const emphasisInput = document.createElement("input");
          emphasisInput.type = "checkbox";
          emphasisInput.checked = host.config.emphasised;
          emphasisLabel.append(emphasisInput, " Emphasise message");

          const output = document.createElement("output");
          const render = () => {
            output.value = messageInput.value;
            output.dataset.emphasised = String(emphasisInput.checked);
          };
          render();

          const updateMessage = () => {
            render();
            host.patchConfig({ message: messageInput.value });
          };
          const updateEmphasis = () => {
            render();
            host.patchConfig({ emphasised: emphasisInput.checked });
          };
          messageInput.addEventListener("input", updateMessage);
          emphasisInput.addEventListener("change", updateEmphasis);
          element.append(stylesheet, messageLabel, emphasisLabel, output);

          let disposed = false;
          const dispose = () => {
            if (disposed) return;
            disposed = true;
            messageInput.removeEventListener("input", updateMessage);
            emphasisInput.removeEventListener("change", updateEmphasis);
            element.remove();
          };
          host.onDispose(dispose);
          return { element, dispose };
        },
      }),
  });
}

const plugin: PluginFactory = ({ registerNode }) => {
  const lifecycle = new AbortController();
  registerNode(passThroughDefinition(lifecycle.signal));
  registerNode(greetingDefinition(lifecycle.signal));
  return () => lifecycle.abort();
};

export default plugin;
