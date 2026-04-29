/**
 * Field — form-field primitive with auto label↔control wiring.
 *
 * Built on @base-ui/react/field. Each <Field.Root> auto-generates an `id` +
 * wires `<Field.Label htmlFor>` + `aria-describedby` (description + error)
 * on the controlled `<Field.Control>`. Replaces hand-wired label/input
 * pairs and ad-hoc error spans.
 *
 * Error precedence (PR2 contract — see `<FieldError>` below):
 *   1. clientError (zod safeParse on each onChange)  — wins when set
 *   2. serverError (mutation onError)                — clears on next keystroke
 *   3. neither                                       — no error rendered
 *
 * Per-field scoped: typing in one Field's Control does NOT clear another
 * Field's serverError. Server errors that span multiple fields must be
 * keyed by field name on the consumer side.
 */

import { Field as FieldPrimitive } from "@base-ui/react/field";
import type * as React from "react";
import { cn } from "@/lib/utils";

function Field({ className, ...props }: FieldPrimitive.Root.Props) {
  return <FieldPrimitive.Root data-slot="field" className={cn("flex flex-col gap-1.5", className)} {...props} />;
}

function FieldLabel({ className, ...props }: FieldPrimitive.Label.Props) {
  return (
    <FieldPrimitive.Label
      data-slot="field-label"
      className={cn("flex items-baseline gap-1.5 font-medium text-foreground text-xs", className)}
      {...props}
    />
  );
}

function FieldDescription({ className, ...props }: FieldPrimitive.Description.Props) {
  return (
    <FieldPrimitive.Description
      data-slot="field-description"
      className={cn("text-[10px]/relaxed text-muted-foreground", className)}
      {...props}
    />
  );
}

/**
 * Render the precedence-resolved error string.
 *
 * Pass both `clientError` (current zod result) and `serverError` (last
 * mutation error). The component picks the right one to render via the
 * documented contract above. Pass null/undefined for both → renders
 * nothing (the slot is omitted, not just visually hidden).
 */
function FieldError({
  clientError,
  serverError,
  className,
  ...props
}: Omit<FieldPrimitive.Error.Props, "children"> & {
  clientError?: string | null;
  serverError?: string | null;
}) {
  const message = clientError ?? serverError ?? null;
  if (!message) return null;
  return (
    <FieldPrimitive.Error
      data-slot="field-error"
      data-error-source={clientError ? "client" : "server"}
      forceShow
      className={cn("flex items-center gap-1 text-[10px]/relaxed text-destructive", className)}
      {...props}
    >
      {message}
    </FieldPrimitive.Error>
  );
}

/** A small "optional" / "required" annotation for Field.Label. */
function FieldHint({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="field-hint"
      className={cn("font-normal text-[10px] text-muted-foreground", className)}
      {...props}
    />
  );
}

export { Field, FieldLabel, FieldDescription, FieldError, FieldHint, FieldPrimitive };
