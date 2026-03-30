import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DashboardProvider, DashboardShell } from "./dashboard";
import { ThemeProvider } from "./providers/ThemeProvider";
import { ScatterUIStateProvider } from "./providers/ScatterUIStateProvider";
import { TerminalTableProvider } from "./providers/TerminalTableProvider";
import { TooltipProvider } from "./components/ui/tooltip";
import { Toaster } from "./components/ui/sonner";

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
