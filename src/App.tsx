import React, { useEffect, Suspense } from 'react';
import { ThemeProvider } from './context/ThemeContext';
import { ToastProvider } from './context/ToastContext';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { MallProvider } from './context/MallContext';
import { StaffProviders } from './staff/StaffProviders';
import { useRoute } from './hooks/useRoute';
import { MallSite } from './mall-site/MallSite';
import { StaffApp } from './staff/StaffApp';

function StaffFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-300 text-sm font-bold">
      Loading staff workspace…
    </div>
  );
}


export default function App() {
  useEffect(() => {
    const handleRejection = (event: PromiseRejectionEvent) => {
      console.warn('Handled async promise rejection safely:', event.reason);
      event.preventDefault();
    };
    window.addEventListener('unhandledrejection', handleRejection);
    return () => {
      window.removeEventListener('unhandledrejection', handleRejection);
    };
  }, []);

  return (
    <ErrorBoundary>
      <ThemeProvider>
        <ToastProvider>
          <RootRouter />
        </ToastProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

function RootRouter() {
  const route = useRoute();
  if (route.surface === 'mall') {
    return (
      <MallProvider>
        <MallSite />
      </MallProvider>
    );
  }
  return (
    <StaffProviders>
      <Suspense fallback={<StaffFallback />}>
        <StaffApp />
      </Suspense>
    </StaffProviders>
  );
}
