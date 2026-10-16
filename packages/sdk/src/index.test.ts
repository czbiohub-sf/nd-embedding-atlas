/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { defineComponent } from "@ndea/sdk";

const definition = defineComponent({
  type: "example/view",
  title: "Example view",
  documentation: { summary: "An example.", use: "Tests." },
  config: {
    schema: z.object({ threshold: z.number() }),
    defaultValue: { threshold: 0 },
  },
  binds: ["focus", "filter"],
  load: () =>
    Promise.resolve({
      mountBody(host) {
        const element = document.createElement("div");
        element.dataset.elementId = host.elementId;
        let disposed = false;
        return {
          element,
          dispose() {
            if (disposed) return;
            disposed = true;
            element.remove();
          },
        };
      },
    }),
});

describe("component SDK barrel", () => {
  test("defines a framework-neutral mounted component", () => {
    expect(definition.type).toBe("example/view");
    expect(definition.binds).toEqual(["focus", "filter"]);
    expect(definition.load).toBeFunction();
  });
});
