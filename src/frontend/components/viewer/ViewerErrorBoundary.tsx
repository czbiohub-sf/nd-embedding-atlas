import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ViewerErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-surface p-4">
          <span className="font-medium text-accent-rose text-xs">Viewer error</span>
          <span className="max-w-[80%] text-center font-mono text-3xs text-text-muted">{this.state.error.message}</span>
          <button
            type="button"
            className="mt-2 rounded bg-elevated px-3 py-1 text-text-secondary text-xs hover:bg-elevated/80"
            onClick={() => this.setState({ error: null })}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
