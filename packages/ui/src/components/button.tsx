import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@ndea/ui/lib/utils";

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-sm leading-[1.3] outline-none select-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-45 aria-invalid:ring-1 aria-invalid:ring-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
  {
    variants: {
      // Design core/Button.jsx: default = primary fill, secondary = muted fill.
      variant: {
        default: "bg-primary text-primary-foreground hover:opacity-85",
        secondary: "bg-muted text-foreground hover:bg-muted-2 aria-expanded:bg-muted-2",
        outline:
          "bg-transparent text-foreground shadow-[inset_0_0_0_1px_var(--line-2)] hover:bg-muted aria-expanded:bg-muted",
        accent: "bg-accent text-accent-foreground hover:opacity-85",
        ghost:
          "bg-transparent text-text-muted hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground aria-pressed:bg-accent aria-pressed:text-accent-foreground",
        destructive: "bg-destructive-bg text-destructive hover:opacity-85",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-[26px] gap-1.5 px-2.5 text-ui-lg",
        xs: "h-5 gap-1 px-1.5 text-2xs [&_svg:not([class*='size-'])]:size-2.5",
        sm: "h-[22px] gap-1 px-[7px] text-ui-sm [&_svg:not([class*='size-'])]:size-3",
        lg: "h-8 gap-1.5 px-3 text-ui-lg",
        icon: "size-[26px]",
        "icon-xs": "size-5 [&_svg:not([class*='size-'])]:size-2.5",
        "icon-sm": "size-[22px] [&_svg:not([class*='size-'])]:size-3",
        "icon-lg": "size-8 [&_svg:not([class*='size-'])]:size-4",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return <ButtonPrimitive data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

export { Button, buttonVariants };
