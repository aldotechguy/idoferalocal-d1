import React, { useState, useEffect } from 'react';

interface Props {
  children: React.ReactNode;
}

export const ErrorBoundary: React.FC<Props> = ({ children }) => {
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    const handleGlobalError = (event: ErrorEvent) => {
      console.warn('Caught global runtime error:', event.error || event.message);
    };

    const handleRejection = (event: PromiseRejectionEvent) => {
      console.warn('Caught unhandled rejection:', event.reason);
      event.preventDefault();
    };

    window.addEventListener('error', handleGlobalError);
    window.addEventListener('unhandledrejection', handleRejection);

    return () => {
      window.removeEventListener('error', handleGlobalError);
      window.removeEventListener('unhandledrejection', handleRejection);
    };
  }, []);

  if (hasError) {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-slate-800 border border-slate-700 rounded-2xl p-6 space-y-4 text-center">
          <h2 className="text-xl font-bold text-rose-400">Application Recovered</h2>
          <p className="text-xs text-slate-300">
            An unexpected display issue occurred. Operating safely on local cached version.
          </p>
          <button
            onClick={() => setHasError(false)}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition-all cursor-pointer"
          >
            Reload View
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};
