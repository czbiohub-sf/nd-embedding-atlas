import { use } from "react";
import type { DashboardContextValue } from "../dashboard/DashboardContext";
import { DashboardContext } from "../dashboard/DashboardContext";

export function useDashboard(): DashboardContextValue {
    const ctx = use(DashboardContext);
    if (ctx === null) {
        const msg = "useDashboard must be used within a Dashboard.Provider";
        throw new Error(msg);
    }
    return ctx;
}
