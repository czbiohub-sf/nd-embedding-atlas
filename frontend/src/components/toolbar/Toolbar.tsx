import type { ReactNode } from "react";

interface Props {
    children: ReactNode;
}

export function Toolbar({ children }: Props) {
    return (
        <div className="flex h-9 shrink-0 items-center gap-3 border-border-subtle border-b bg-elevated px-3 text-xs">
            {children}
        </div>
    );
}
