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
        <div className="flex flex-col items-center justify-center h-screen bg-[#111] text-white gap-4 px-6">
          <h1 className="text-xl font-semibold">Something went wrong</h1>
          <p className="text-sm text-white/50 max-w-md text-center">
            {this.state.error?.message}
          </p>
          <button
            onClick={() => window.location.reload()}
            className="mt-2 px-5 py-2 rounded-lg bg-white/10 text-sm text-white/90
                       hover:bg-white/20 cursor-pointer transition-colors duration-150"
          >
            Reload
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
