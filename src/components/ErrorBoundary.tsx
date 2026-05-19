import React from "react";

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends React.Component<
  React.PropsWithChildren,
  State
> {
  constructor(props: React.PropsWithChildren) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-screen bg-[var(--np-overlay)] text-[var(--np-text)] gap-4 px-6">
          <h1 className="text-xl font-semibold">Something went wrong</h1>
          <p className="text-sm text-[var(--np-text-tertiary)] max-w-md text-center">
            {this.state.error?.message}
          </p>
          <button
            onClick={() => window.location.reload()}
            className="mt-2 px-5 py-2 rounded-lg bg-[var(--np-hover)] text-sm text-[var(--np-text)]
                       hover:bg-[var(--np-selected)] cursor-pointer transition-colors duration-150"
          >
            Reload
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
