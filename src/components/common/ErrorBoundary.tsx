import React from 'react';

type Props = { children: React.ReactNode };
type State = { error: Error | null; retryKey: number };

export class ErrorBoundary extends React.Component<Props, State> {
  declare readonly props: Readonly<Props>;
  declare setState: (updater: (state: State) => State) => void;
  state: State = { error: null, retryKey: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Frontend render failure', error, info.componentStack);
  }

  private retry = () => this.setState((state) => ({ error: null, retryKey: state.retryKey + 1 }));

  render() {
    if (!this.state.error) return <React.Fragment key={this.state.retryKey}>{this.props.children}</React.Fragment>;
    return (
      <main className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-6">
        <section className="max-w-md w-full bg-slate-900 border border-slate-700 rounded-2xl p-6 space-y-4 text-center" role="alert">
          <p className="text-xs font-bold uppercase tracking-wider text-rose-400">Display error</p>
          <h1 className="text-xl font-black">This view could not be displayed</h1>
          <p className="text-sm text-slate-300">Your saved data is unchanged. Try the view again or reload the application.</p>
          <details className="text-left rounded-xl bg-slate-950 p-3 text-xs text-slate-400">
            <summary className="cursor-pointer font-bold">Technical details</summary>
            <code className="mt-2 block break-words">{this.state.error.message}</code>
          </details>
          <div className="flex gap-2 justify-center">
            <button type="button" onClick={this.retry} className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-xl text-sm font-extrabold">Try again</button>
            <button type="button" onClick={() => window.location.reload()} className="px-4 py-2 border border-slate-600 hover:bg-slate-800 rounded-xl text-sm font-bold">Reload app</button>
          </div>
        </section>
      </main>
    );
  }
}
