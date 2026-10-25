import { Component, type ErrorInfo, type ReactNode } from 'react'

type State = { error: Error | null }

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
 state: State = { error: null }

 static getDerivedStateFromError(error: Error): State { return { error } }

 componentDidCatch(error: Error, info: ErrorInfo) {
   console.error('[InspectAI] frontend runtime error', error, info)
 }

 render() {
   if (!this.state.error) return this.props.children
   return (
     <main role="alert" className="min-h-screen bg-bg text-text p-8">
       <h1 className="text-xl font-semibold">Unable to display this page</h1>
       <p className="mt-2 text-text-2">The application encountered a frontend error.</p>
       <pre className="mt-4 max-w-4xl whitespace-pre-wrap rounded border border-border bg-bg-2 p-4 text-sm text-red-300">
         {this.state.error.message}
       </pre>
       <button className="mt-4 rounded bg-accent px-4 py-2 text-white" onClick={() => window.location.reload()}>
         Reload
       </button>
     </main>
   )
 }
}
