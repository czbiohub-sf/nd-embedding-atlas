/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { createBuiltinNodeDefinitions, createNodeCatalog, type NodeCatalogServices } from "./catalog";

const mountBody = () => ({
  element: {} as HTMLElement,
  dispose() {},
});

describe("built-in node definitions", () => {
  test("preserves portable source and proxy identities", () => {
    const { obs, proxy } = createBuiltinNodeDefinitions({
      mountBody,
    });

    expect(String(obs.ref.nodeTypeId)).toBe("obs");
    expect(String(obs.ref.nodeTypeVersion)).toBe("1.0.0");
    expect(String(proxy.ref.nodeTypeId)).toBe("proxy");
    expect(String(proxy.ref.nodeTypeVersion)).toBe("1.0.0");
    expect(obs.outputs).toEqual([{ id: "out", kind: "pred", label: "Out" }]);
    expect(proxy.inputs).toEqual([{ id: "in", kind: "pred", label: "In" }]);
  });

  test("constructs complete catalog from injected app services", () => {
    const empty = {};
    const services = {
      annotate: empty,
      cache: empty,
      charts: empty,
      count: empty,
      carousel: empty,
      gallery: empty,
      imageViewer: empty,
      scatter: empty,
      subnet: empty,
      table: empty,
      transformFilter: empty,
      wrangle: empty,
    } as NodeCatalogServices;

    const catalog = createNodeCatalog({ mountBody, services });

    expect(Object.keys(catalog)).toHaveLength(17);
    expect(String(catalog.scatter.ref.nodeTypeId)).toBe("scatter");
    expect(String(catalog.imageViewer.ref.nodeTypeId)).toBe("image-viewer");
    expect(String(catalog.carousel.ref.nodeTypeId)).toBe("carousel");
  });
});
