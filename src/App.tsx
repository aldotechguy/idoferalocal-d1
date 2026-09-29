import React, { Suspense } from 'react';
import { ThemeProvider } from './context/ThemeContext';
import { ToastProvider } from './context/ToastContext';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { MallProvider } from './context/MallContext';
import { useRoute } from './hooks/useRoute';
import { MallSite } from './mall-site/MallSite';
import { InteractionProvider } from './context/InteractionContext';

// The staff POS is code-split out of the Mall entry. It used to be a static
// import, so the `Suspense` below was decorative: every shopper downloaded the
// Dashboard, POS, Finance, Reports and Settings hubs (the bulk of the ~820 kB
// entry chunk) to render a product grid. Only a staff member on /labs pays this
// cost, and only once.
const StaffApp = React.lazy(() => import('./staff/StaffApp').then((m) => ({ default: m.StaffApp })));
const StaffProviders = React.lazy(() => import('./staff/StaffProviders').then((m) => ({ default: m.StaffProviders })));

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
            <ManifestBySurface />
            <RootRouter />
          </InteractionProvider>
        </ToastProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

/**
 * index.html is served identically for the storefront and /labs, but the two must
 * not install as the same app: a customer who installed the Mall was getting
 * "Idofera POS" with staff shortcuts. Each surface now points at its own
 * manifest, so the installed name, icon, colour and shortcuts all match.
 */
function ManifestBySurface() {
  const route = useRoute();
  React.useEffect(() => {
    const href = route.surface === 'staff' ? '/manifest-staff.json' : '/manifest.json';
    const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    if (link) link.setAttribute('href', href);
    // The app-switcher and the browser UI tint follow theme-color too.
    const isStaff = route.surface === 'staff';
    document.querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', isStaff ? '#2563eb' : '#0d9488');
    document.title = isStaff
      ? 'Idofera Packaging POS & Business System'
      : 'IdoferaMall — Packaging & Everyday Goods';
  }, [route.surface]);
  return null;
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
