import { Component, type ReactNode, type ErrorInfo } from "react";

interface Props {
  panelName: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class PanelErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[PanelErrorBoundary:${this.props.panelName}]`, error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
          <div className="text-sm font-medium text-text-primary">{this.props.panelName} crashed</div>
          <div className="max-w-xs font-mono text-xs text-text-muted break-all">{this.state.error.message}</div>
          <button
            className="rounded border border-border-subtle px-3 py-1 text-xs text-text-secondary hover:bg-elevated"
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
