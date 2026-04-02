import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ScatterUIStateProvider } from "./components/scatter/ScatterUIStateProvider";
import { TerminalTableProvider } from "./components/table/TerminalTableProvider";
import { Toaster } from "./components/ui/sonner";
import { TooltipProvider } from "./components/ui/tooltip";
import { DashboardProvider, DashboardShell } from "./dashboard";
import { ThemeProvider } from "./ThemeProvider";

// Module scope — survives HMR
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider delay={400}>
          <ScatterUIStateProvider>
            <DashboardProvider>
              <TerminalTableProvider>
                <DashboardShell />
                <Toaster position="bottom-right" />
              </TerminalTableProvider>
            </DashboardProvider>
          </ScatterUIStateProvider>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
