import type { ComponentModule } from "@ndea/sdk";

export const nonReactBodyFixture: ComponentModule = {
  mountBody(host) {
    const element = document.createElement("div");
    element.dataset.elementId = host.elementId;
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
