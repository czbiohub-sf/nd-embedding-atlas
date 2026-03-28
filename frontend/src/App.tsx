import { DashboardProvider, DashboardShell } from "./dashboard";
import { ThemeProvider } from "./providers/ThemeProvider";
import { ScatterUIStateProvider } from "./providers/ScatterUIStateProvider";

export default function App() {
    return (
        <ThemeProvider>
            <ScatterUIStateProvider>
                <DashboardProvider>
                    <DashboardShell />
                </DashboardProvider>
            </ScatterUIStateProvider>
        </ThemeProvider>
    );
}
