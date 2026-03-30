import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DashboardProvider, DashboardShell } from "./dashboard";
import { ThemeProvider } from "./providers/ThemeProvider";
import { ScatterUIStateProvider } from "./providers/ScatterUIStateProvider";
import { TerminalTableProvider } from "./providers/TerminalTableProvider";

// Module scope — survives HMR
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <ScatterUIStateProvider>
          <DashboardProvider>
            <TerminalTableProvider>
              <DashboardShell />
            </TerminalTableProvider>
          </DashboardProvider>
        </ScatterUIStateProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
