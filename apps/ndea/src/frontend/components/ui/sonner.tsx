import { Loader2Icon } from "lucide-react";
import { Toaster as Sonner, type ToasterProps } from "sonner";
import { useTheme } from "@/ThemeProvider";

/** Tone dot (design overlay/Toast.jsx) in place of Sonner's icons. */
const dot = (tone: string) => <span className={`size-2 rounded-full ${tone}`} />;

/**
 * Toasts per design overlay/Toast.jsx: bottom-right stack, 356px wide, title +
 * muted description, card surface with the toast shadow, 4s.
 * ponytail: no dismiss button; toasts auto-close and swipe away. Add Sonner's
 * `closeButton` (restyled to the 12px top-right x) if a toast ever needs to stay.
 */
const Toaster = ({ ...props }: ToasterProps) => {
  const { theme } = useTheme();

  return (
    <Sonner
      theme={theme}
      position="bottom-right"
      offset={16}
      gap={8}
      duration={4000}
      className="toaster group"
      icons={{
        success: dot("bg-success"),
        info: dot("bg-text-muted"),
        warning: dot("bg-dirty"),
        error: dot("bg-destructive"),
        loading: <Loader2Icon className="size-2 animate-spin text-text-muted" />,
      }}
      style={{ "--width": "356px" } as React.CSSProperties}
      toastOptions={{
        classNames: {
          toast:
            "items-start! gap-2.5! rounded-lg! border-0! bg-card! px-4! py-3.5! font-sans! text-card-foreground! shadow-(--shadow-toast)!",
          icon: "m-0! mt-[5px]! size-2!",
          content: "gap-0.5!",
          title: "font-medium! text-md! leading-[1.35]!",
          description: "text-text-muted! text-ui! leading-[1.4]!",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
