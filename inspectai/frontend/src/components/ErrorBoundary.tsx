import { Component, type ReactNode } from 'react'
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
 state = { failed: false }
 static getDerivedStateFromError() { return { failed: true } }
 render() { return this.state.failed ? <main role="alert" className="p-8"><h1>Unable to display this page</h1><p>Saved server records are unchanged. Reload the page to recover.</p><button onClick={() => window.location.reload()}>Reload</button></main> : this.props.children }
}
