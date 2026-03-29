import { DashboardProvider, DashboardShell } from "./dashboard";
import { ThemeProvider } from "./providers/ThemeProvider";
import { ScatterUIStateProvider } from "./providers/ScatterUIStateProvider";
import { TerminalTableProvider } from "./providers/TerminalTableProvider";

export default function App() {
    return (
        <ThemeProvider>
            <ScatterUIStateProvider>
                <DashboardProvider>
                    <TerminalTableProvider>
                        <DashboardShell />
                    </TerminalTableProvider>
                </DashboardProvider>
            </ScatterUIStateProvider>
        </ThemeProvider>
    );
}
