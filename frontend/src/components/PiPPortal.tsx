/**
 * PiPPortal — renders children into a Picture-in-Picture window via React portal.
 *
 * Usage:
 *   const { isPiP, pipWindow, open, close } = usePictureInPicture();
 *
 *   return (
 *     <>
 *       <PiPButton isPiP={isPiP} isSupported={isSupported} onOpen={open} onClose={close} />
 *       {isPiP && pipWindow
 *         ? <PiPPortal pipWindow={pipWindow}><MyContent /></PiPPortal>
 *         : <MyContent />
 *       }
 *     </>
 *   );
 */

import type { ReactNode } from "react";
import { createPortal } from "react-dom";

interface Props {
  pipWindow: Window;
  children: ReactNode;
}

export function PiPPortal({ pipWindow, children }: Props) {
  return createPortal(children, pipWindow.document.body);
}
