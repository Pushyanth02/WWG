import { Component, type ErrorInfo, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

interface BoundaryState {
  error: Error | null;
}

class AppErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Archmage runtime error:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-[#171321] p-6 text-[#EFEAF7]">
          <div className="arcane-panel max-w-lg rounded-xl p-6 space-y-3">
            <h1 className="font-display text-xl font-bold text-[#E96578]">
              Application Runtime Error
            </h1>
            <p className="font-mono text-xs text-[#FFD5DC] break-words">
              {this.state.error.message}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="rounded-lg border border-[#D9BA72] bg-[#34283F] px-4 py-2 text-xs font-semibold text-[#F8E7BF] hover:bg-[#463657] cursor-pointer"
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>
);
