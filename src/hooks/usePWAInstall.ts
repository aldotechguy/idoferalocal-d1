import { useState, useEffect, useCallback } from 'react';

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

const DISMISSED_KEY = 'idofera_pwa_prompt_dismissed_at';
const INSTALLED_KEY = 'pwa_installed';
// Snooze for 3 days if dismissed by user
const SNOOZE_DURATION_MS = 3 * 24 * 60 * 60 * 1000;

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstallable, setIsInstallable] = useState(false);
  const [isInstalled, setIsInstalled] = useState<boolean>(() => {
    try {
      if (typeof window === 'undefined') return false;
      const stored = localStorage.getItem(INSTALLED_KEY) === 'true';
      const isStandalone =
        window.matchMedia('(display-mode: standalone)').matches ||
        (window.navigator as unknown as { standalone?: boolean }).standalone === true ||
        document.referrer.includes('android-app://');
      return stored || isStandalone;
    } catch {
      return false;
    }
  });

  const [isIOS] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    const ua = window.navigator.userAgent.toLowerCase();
    return /iphone|ipad|ipod/.test(ua) && !(window as unknown as { MSStream?: unknown }).MSStream;
  });

  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [swRegistered, setSwRegistered] = useState(false);

  const [isDismissed, setIsDismissed] = useState<boolean>(() => {
    try {
      const dismissedAt = localStorage.getItem(DISMISSED_KEY);
      if (!dismissedAt) return false;
      const diff = Date.now() - parseInt(dismissedAt, 10);
      return diff < SNOOZE_DURATION_MS;
    } catch {
      return false;
    }
  });

  useEffect(() => {
    // 1. Comprehensive standalone / installation verification
    const checkStandalone = () => {
      const isStandalone =
        window.matchMedia('(display-mode: standalone)').matches ||
        (window.navigator as unknown as { standalone?: boolean }).standalone === true ||
        document.referrer.includes('android-app://') ||
        localStorage.getItem(INSTALLED_KEY) === 'true';

      if (isStandalone) {
        setIsInstalled(true);
        try {
          localStorage.setItem(INSTALLED_KEY, 'true');
        } catch {}
      }
    };
    checkStandalone();

    // 2. Query getInstalledRelatedApps if supported (Chromium)
    if ('getInstalledRelatedApps' in navigator) {
      (navigator as unknown as { getInstalledRelatedApps: () => Promise<unknown[]> })
        .getInstalledRelatedApps()
        .then((relatedApps) => {
          if (Array.isArray(relatedApps) && relatedApps.length > 0) {
            setIsInstalled(true);
            try {
              localStorage.setItem(INSTALLED_KEY, 'true');
            } catch {}
          }
        })
        .catch(() => {});
    }

    // 3. Register Service Worker from /sw.js
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js')
        .then((reg) => {
          setSwRegistered(true);
        })
        .catch((err) => {
          console.warn('[PWA] ServiceWorker registration warning:', err);
        });
    }

    // 4. Capture beforeinstallprompt for seamless 1-click execution
    const handleBeforeInstallPrompt = (e: Event) => {
      // Prevent browser mini-infobar so our custom 1-click popup can trigger it
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setIsInstallable(true);
    };

    // 5. Handle appinstalled event when user completes installation
    const handleAppInstalled = () => {
      setIsInstalled(true);
      setIsInstallable(false);
      setDeferredPrompt(null);
      try {
        localStorage.setItem(INSTALLED_KEY, 'true');
      } catch {}
      console.log('[PWA] App was successfully installed!');
    };

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const triggerInstall = useCallback(async (): Promise<boolean> => {
    if (!deferredPrompt) {
      return false;
    }

    try {
      await deferredPrompt.prompt();
      const choiceResult = await deferredPrompt.userChoice;
      if (choiceResult.outcome === 'accepted') {
        setIsInstalled(true);
        setIsInstallable(false);
        setDeferredPrompt(null);
        try {
          localStorage.setItem(INSTALLED_KEY, 'true');
        } catch {}
        return true;
      }
    } catch (err) {
      console.error('[PWA] Error during install prompt execution:', err);
    }
    return false;
  }, [deferredPrompt]);

  const dismiss = useCallback(() => {
    setIsDismissed(true);
    try {
      localStorage.setItem(DISMISSED_KEY, Date.now().toString());
    } catch {}
  }, []);

  const resetDismiss = useCallback(() => {
    setIsDismissed(false);
    try {
      localStorage.removeItem(DISMISSED_KEY);
    } catch {}
  }, []);

  return {
    isInstallable,
    isInstalled,
    isIOS,
    isOnline,
    swRegistered,
    isDismissed,
    dismiss,
    resetDismiss,
    triggerInstall,
  };
}
