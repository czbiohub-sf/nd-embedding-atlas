import { describe, expect, test } from "bun:test";
import { z } from "zod";

import { configFields } from "./config-fields";
import { COMPONENTS } from "./dashboard";

const summary = (schema: z.ZodType) =>
  configFields(schema).map(({ path, title, section, control, nullable, schema: inner }) => ({
    path: path.join("."),
    title,
    section,
    control,
    nullable,
    kind: inner.def.type,
  }));

describe("configFields", () => {
  test("scatter settings show only the embedding; the rest sit on the view", () => {
    expect(summary(COMPONENTS.scatter.props)).toEqual([
      { path: "obsmKey", title: "Embedding", section: "data", control: "obsm", nullable: true, kind: "string" },
    ]);
  });

  test("image viewer: dataset on Data, render on Display", () => {
    expect(summary(COMPONENTS["image-viewer"].props)).toEqual([
      { path: "datasetKey", title: "Dataset", section: "data", control: "dataset", nullable: true, kind: "string" },
      { path: "render", title: "Render", section: "display", control: undefined, nullable: false, kind: "enum" },
    ]);
  });

  test("nested objects open one level with dotted titles and inherit the section", () => {
    const schema = z.object({
      style: z
        .object({ size: z.number(), deep: z.object({ x: z.number() }) })
        .meta({ title: "Style", section: "data" }),
    });
    expect(summary(schema)).toEqual([
      { path: "style.size", title: "Style.size", section: "data", control: undefined, nullable: false, kind: "number" },
    ]);
  });

  test("field meta reaches list_components' JSON Schema", () => {
    const json = z.toJSONSchema(COMPONENTS.scatter.props, { unrepresentable: "any" }) as {
      properties: Record<string, Record<string, unknown>>;
    };
    expect(json.properties.obsmKey).toMatchObject({ control: "obsm", section: "data", title: "Embedding" });
    expect(json.properties.pointSize).toMatchObject({ hidden: true });
  });
});
