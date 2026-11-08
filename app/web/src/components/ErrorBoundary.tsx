import { Component, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button, IconBadge, Panel } from "./ui";

/** Last line of defence: a render bug on one page must never blank the whole app mid-demo. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <Panel role="alert">
        <div className="flex items-start gap-3">
          <IconBadge tone="crit"><AlertTriangle size={17} /></IconBadge>
          <div className="min-w-0">
            <div className="font-display text-heading font-semibold text-ink">This view hit an unexpected problem</div>
            <p className="mt-1 break-words text-support text-ink-3">{this.state.error.message}</p>
            <div className="mt-3">
              <Button size="sm" icon={<RefreshCw size={13} />} onClick={() => this.setState({ error: null })}>Try again</Button>
            </div>
          </div>
        </div>
      </Panel>
    );
  }
}
