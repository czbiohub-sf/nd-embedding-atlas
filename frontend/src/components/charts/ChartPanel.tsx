import { type ReactNode, useState } from "react";
import { useDashboard } from "../../hooks/useDashboard";

interface Props {
    id: string;
    title: string;
    children: ReactNode;
    collapsible?: boolean;
}

export function ChartPanel({ id, title, children, collapsible = true }: Props) {
    const { actions } = useDashboard();
    const [collapsed, setCollapsed] = useState(false);

    return (
        <div className="group/panel border-border-subtle border-b">
            {/* Header */}
            <div className="flex h-7 items-center gap-1 px-2">
                {collapsible ? (
                    <button
                        type="button"
                        className="w-4 shrink-0 text-[10px] text-text-muted hover:text-text-secondary"
                        onClick={() => setCollapsed(!collapsed)}
                    >
                        {collapsed ? "\u25B6" : "\u25BC"}
                    </button>
                ) : null}
                <span className="flex-1 truncate font-[DM_Sans,system-ui] font-medium text-text-secondary text-xs">
                    {title}
                </span>
                <button
                    type="button"
                    className="w-4 shrink-0 text-[10px] text-text-muted opacity-0 transition-opacity hover:text-accent-rose group-hover/panel:opacity-100"
                    onClick={() => actions.removePanel(id)}
                    title="Remove panel"
                >
                    &#x2715;
                </button>
            </div>

            {/* Body */}
            {collapsed ? null : <div className="px-2 pb-2">{children}</div>}
        </div>
    );
}
