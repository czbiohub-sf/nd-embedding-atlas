import { useViewer } from "./useViewer";

export function ViewerLoadingOverlay() {
  const { state } = useViewer();

  if (state.error) {
    return (
      <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-card/60 backdrop-blur-md">
        <span className="text-accent-rose text-xs">{state.error}</span>
      </div>
    );
  }

  if (state.aggregateState === "loading") {
    return (
      <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-card/50">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
      </div>
    );
  }

  return null;
}
