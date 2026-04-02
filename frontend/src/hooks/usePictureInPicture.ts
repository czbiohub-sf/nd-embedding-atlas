/**
 * usePictureInPicture — Document Picture-in-Picture API hook.
 *
 * Opens any content in an always-on-top floating window.
 * Chrome 116+, Edge 116+. Not supported in Firefox or Safari.
 *
 * Usage:
 *   const { isSupported, isPiP, pipWindow, open, close } = usePictureInPicture();
 *   if (isPiP && pipWindow) {
 *     return <PiPPortal pipWindow={pipWindow}><MyContent /></PiPPortal>;
 *   }
 */

import { useCallback, useEffect, useRef, useState } from "react";

export interface PiPOptions {
  width?: number;
  height?: number;
  /** Hides the "back to tab" button in the PiP window. Default false. */
  disallowReturnToOpener?: boolean;
}

export interface PiPHandle {
  isSupported: boolean;
  isPiP: boolean;
  pipWindow: Window | null;
  open: () => Promise<void>;
  close: () => void;
}

export function usePictureInPicture(options: PiPOptions = {}): PiPHandle {
  const [pipWindow, setPipWindow] = useState<Window | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const isSupported = typeof window !== "undefined" && "documentPictureInPicture" in window;

  // Keep dark-class in sync with main document
  useEffect(() => {
    if (!pipWindow) return;
    const observer = new MutationObserver(() => {
      const isDark = document.documentElement.classList.contains("dark");
      pipWindow.document.documentElement.classList.toggle("dark", isDark);
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, [pipWindow]);

  const open = useCallback(async () => {
    if (!isSupported) {
      console.warn("Document Picture-in-Picture is not supported in this browser.");
      return;
    }

    const { width = 480, height = 480, disallowReturnToOpener = false } = optionsRef.current;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pip: Window = await (window as any).documentPictureInPicture.requestWindow({
      width,
      height,
      disallowReturnToOpener,
    });

    // Copy all stylesheets into the PiP document
    [...document.styleSheets].forEach((sheet) => {
      try {
        const rules = [...sheet.cssRules].map((r) => r.cssText).join("");
        const style = pip.document.createElement("style");
        style.textContent = rules;
        pip.document.head.appendChild(style);
      } catch {
        // Cross-origin sheets — link them by href instead
        if (sheet.href) {
          const link = pip.document.createElement("link");
          link.rel = "stylesheet";
          link.href = sheet.href;
          pip.document.head.appendChild(link);
        }
      }
    });

    // Match dark mode
    if (document.documentElement.classList.contains("dark")) {
      pip.document.documentElement.classList.add("dark");
    }

    // Style the PiP window body to fill edge-to-edge
    pip.document.body.style.cssText = "margin:0;padding:0;width:100%;height:100%;overflow:hidden;";

    pip.addEventListener("pagehide", () => setPipWindow(null));
    setPipWindow(pip);
  }, [isSupported]);

  const close = useCallback(() => {
    pipWindow?.close();
    setPipWindow(null);
  }, [pipWindow]);

  return { isSupported, isPiP: !!pipWindow, pipWindow, open, close };
}
