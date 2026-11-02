// One bad row must never take the whole window down: without a boundary a render error in the Activity desk unmounted
// the app and left a blank grey window (the 2026-11-02 "clicking Log freezes the app"). This shows the error in place,
// with a way back, and the rest of the app keeps working.
import { Component, type ReactNode } from 'react'

interface Props { children: ReactNode; label: string; onReset?: () => void }
interface State { error: string | null }

export class DeskBoundary extends Component<Props, State> {
  state: State = { error: null }
  static getDerivedStateFromError(e: unknown): State { return { error: e instanceof Error ? e.message : String(e) } }
  componentDidCatch(e: unknown) { console.error(`[${this.props.label}]`, e) }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="oa-empty-card oa-card-empty" role="alert" data-testid="desk-boundary">
        <h3>{this.props.label} could not be shown</h3>
        <p>{this.state.error}</p>
        <div className="oa-empty-actions">
          <button type="button" className="btn sm" onClick={() => { this.props.onReset?.(); this.setState({ error: null }) }}>Try again</button>
        </div>
      </div>
    )
  }
}
