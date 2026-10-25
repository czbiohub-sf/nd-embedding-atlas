/** The settings fields of a component's config schema, read from each field's `.meta()` (see ViewSettings). */

import { z } from "zod";

export interface ConfigField {
  /** Prop path: `[key]`, or `[key, child]` for one level of nesting. */
  readonly path: readonly string[];
  readonly title: string;
  readonly section: "display" | "data";
  readonly control: z.GlobalMeta["control"];
  readonly nullable: boolean;
  /** The field with nullable/optional/default wrappers removed. */
  readonly schema: z.ZodType;
}

function unwrap(schema: z.ZodType): [z.ZodType, boolean] {
  let nullable = false;
  while (schema instanceof z.ZodNullable || schema instanceof z.ZodOptional || schema instanceof z.ZodDefault) {
    nullable ||= !(schema instanceof z.ZodDefault);
    schema = schema.unwrap() as z.ZodType;
  }
  return [schema, nullable];
}

/** Visible fields in shape order (`hidden` ones dropped); nested objects open one level with dotted titles. */
export function configFields(
  schema: z.ZodType,
  parent?: { key: string; title: string; section: ConfigField["section"] },
): ConfigField[] {
  if (!(schema instanceof z.ZodObject)) return [];
  return Object.entries(schema.shape as Record<string, z.ZodType>).flatMap(([key, field]): ConfigField[] => {
    const meta = field.meta() ?? {};
    if (meta.hidden) return [];
    const title = parent ? `${parent.title}.${meta.title ?? key}` : (meta.title ?? key);
    const section = meta.section ?? parent?.section ?? "display";
    const [inner, nullable] = unwrap(field);
    if (inner instanceof z.ZodObject) return parent ? [] : configFields(inner, { key, title, section });
    const path = parent ? [parent.key, key] : [key];
    return [{ path, title, section, control: meta.control, nullable, schema: inner }];
  });
}
