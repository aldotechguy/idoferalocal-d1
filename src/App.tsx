import React, { Suspense } from 'react';
import { ThemeProvider } from './context/ThemeContext';
import { ToastProvider } from './context/ToastContext';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { MallProvider } from './context/MallContext';
import { StaffProviders } from './staff/StaffProviders';
import { useRoute } from './hooks/useRoute';
import { MallSite } from './mall-site/MallSite';
import { StaffApp } from './staff/StaffApp';
import { InteractionProvider } from './context/InteractionContext';

function StaffFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-300 text-sm font-bold">
      Loading staff workspace…
    </div>
  );
}


export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <ToastProvider>
          <InteractionProvider>
            <a href="#main-content" className="skip-link">Skip to main content</a>
            <RootRouter />
          </InteractionProvider>
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
