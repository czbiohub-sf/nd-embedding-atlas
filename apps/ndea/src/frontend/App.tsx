import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "./components/ui/sonner";
import { TooltipProvider } from "@ndea/ui/components/tooltip";
import { WorkspaceShell } from "./core/workspace/WorkspaceShell";
import { DatasetSessionProvider } from "./core/session/DatasetSessionProvider";
import { ThemeProvider } from "./ThemeProvider";
import { appQueryClient } from "./query-client";

export default function App() {
  return (
    <QueryClientProvider client={appQueryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <DatasetSessionProvider>
            <WorkspaceShell />
            <Toaster position="bottom-right" />
          </DatasetSessionProvider>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
