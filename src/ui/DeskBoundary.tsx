// An error boundary per desk: a render error in one desk (a crafted project, a bug) shows a recoverable message in
// that desk's place instead of unmounting the whole app (React leaves a blank window when nothing catches). Nothing
// is thrown away: the desk's store keeps its state, and "Try again" mounts the desk afresh (after `onReset`, which a
// desk uses to clear what it was showing, e.g. the Video desk's selection).

import { Component, Fragment } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

interface Props {
  /** The desk's name for the message ("Video"). */
  desk: string
  children: ReactNode
  /** Called before the desk is mounted again (clear the selection or whatever the crash was drawing). */
  onReset?: () => void
  /** Leave the desk (Home). */
  onLeave?: () => void
}
interface State { error: Error | null; tries: number }

export class DeskBoundary extends Component<Props, State> {
  state: State = { error: null, tries: 0 }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[${this.props.desk} desk]`, error, info.componentStack)
  }

  private retry = () => {
    try { this.props.onReset?.() } catch { /* the reset itself must not keep the desk down */ }
    this.setState((s) => ({ error: null, tries: s.tries + 1 }))
  }

  render() {
    const { error, tries } = this.state
    if (!error) return <Fragment key={tries}>{this.props.children}</Fragment>
    return (
      <div className="loading desk-error" role="alert">
        <div style={{ maxWidth: 520, textAlign: 'center', display: 'grid', gap: 12 }}>
          <strong>The {this.props.desk} desk hit a problem and stopped drawing.</strong>
          <span className="muted">Your work is still here: nothing was closed or deleted. Try again to reopen the desk{this.props.onReset ? ' with nothing selected' : ''}.</span>
          <span className="muted" style={{ fontSize: 12, overflowWrap: 'anywhere' }}>{String(error.message || error).slice(0, 300)}</span>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            <button type="button" className="btn primary" onClick={this.retry}>Try again</button>
            {this.props.onLeave && <button type="button" className="btn" onClick={this.props.onLeave}>Go to Home</button>}
          </div>
        </div>
      </div>
    )
  }
}
