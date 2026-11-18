import { Component, type ReactNode } from 'react'

/** Keeps one broken panel from blanking the whole window. */
export class ErrorBoundary extends Component<{ children: ReactNode; label: string; resetKey?: string }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidUpdate(prev: { resetKey?: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null })
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <div className="text-sm font-medium text-bad">{this.props.label} crashed</div>
        <pre className="selectable max-w-full overflow-auto text-xs whitespace-pre-wrap text-muted">{this.state.error.message}</pre>
        <button className="text-xs text-accent-strong hover:underline" onClick={() => this.setState({ error: null })}>
          Try again
        </button>
      </div>
    )
  }
}
