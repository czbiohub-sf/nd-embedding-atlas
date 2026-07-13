import type { NodeModule } from "@ndea/sdk";

export const nonReactBodyFixture: NodeModule = {
  mountBody(host) {
    const element = document.createElement("div");
    element.dataset.instanceId = host.instanceId;
    element.textContent = "non-React fixture";
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
};
