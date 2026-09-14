import React, { useState, useEffect } from 'react';
import {
  Download,
  WifiOff,
  X,
  Monitor,
  CheckCircle2,
  Share2,
  Smartphone,
  ChevronRight,
  ShieldCheck,
  Zap,
} from 'lucide-react';
import { usePWAInstall } from '../../hooks/usePWAInstall';
import { DesktopInstallModal } from '../modals/DesktopInstallModal';

export const PWAInstallBanner: React.FC = () => {
  const {
    isInstallable,
    isInstalled,
    isIOS,
    isOnline,
    isDismissed,
    dismiss,
    triggerInstall,
  } = usePWAInstall();

  const [installing, setInstalling] = useState(false);
  const [installedSuccess, setInstalledSuccess] = useState(false);
  const [showDesktopModal, setShowDesktopModal] = useState(false);
  const [showIOSDetails, setShowIOSDetails] = useState(false);
  const [hasWaitedDelay, setHasWaitedDelay] = useState(false);

  // Soft entrance delay (1.5 seconds) so app views load smoothly without jarring popups
  useEffect(() => {
    const timer = setTimeout(() => {
      setHasWaitedDelay(true);
    }, 1500);
    return () => clearTimeout(timer);
  }, []);

  // Strict Rule: Never pop up if already installed or if snoozed/dismissed
  const shouldShowPopup = !isInstalled && !isDismissed && hasWaitedDelay && (isInstallable || isIOS);

  const handleSeamlessInstallClick = async () => {
    if (isInstallable) {
      setInstalling(true);
      const success = await triggerInstall();
      setInstalling(false);
      if (success) {
        setInstalledSuccess(true);
        setTimeout(() => setInstalledSuccess(false), 4500);
        return;
      }
    } else if (isIOS) {
      setShowIOSDetails((prev) => !prev);
      return;
    } else {
      setShowDesktopModal(true);
    }
  };

  return (
    <>
      {/* Offline Alert Bar (Visible whenever connection is dropped) */}
      {!isOnline && (
        <div className="fixed top-0 inset-x-0 bg-amber-500 text-slate-950 px-4 py-2 text-xs font-bold flex items-center justify-between shadow-lg z-50 animate-pulse">
          <div className="flex items-center gap-2 mx-auto sm:mx-0">
            <WifiOff className="w-4 h-4 text-slate-950 shrink-0" />
            <span>
              Offline Mode Active — IndexedDB local database is taking sales & updating stock securely without internet.
            </span>
          </div>
          <span className="hidden sm:inline-block text-[10px] uppercase tracking-wider bg-slate-950 text-amber-400 px-2 py-0.5 rounded-md font-black">
            Local Sync Ready
          </span>
        </div>
      )}

      {/* Seamless 1-Click Install Pop-up (Only when NOT installed) */}
      {shouldShowPopup && (
        <div
          id="pwa-install-popup"
          className="fixed bottom-4 sm:bottom-6 right-4 sm:right-6 left-4 sm:left-auto sm:w-[420px] bg-slate-900/95 backdrop-blur-xl text-white p-5 rounded-3xl border border-blue-500/30 shadow-2xl shadow-blue-950/40 z-50 transition-all animate-in fade-in slide-in-from-bottom-5 duration-300"
        >
          {/* Top Row: App Icon Brand, Title, and Close Button */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-blue-600 via-indigo-600 to-violet-600 flex items-center justify-center text-white shadow-md shadow-blue-500/20 font-black text-xl shrink-0">
                I
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <h4 className="text-sm font-black text-white tracking-tight">
                    Install Idofera POS
                  </h4>
                  <span className="px-1.5 py-0.5 rounded-full text-[9px] font-black uppercase bg-blue-500/20 text-blue-300 border border-blue-500/30">
                    1-Click App
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 font-medium mt-0.5">
                  Full-screen desktop & mobile access + offline mode
                </p>
              </div>
            </div>

            <button
              onClick={dismiss}
              className="text-slate-400 hover:text-white p-1 rounded-xl hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
              title="Dismiss for now"
              aria-label="Dismiss install prompt"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Value highlights */}
          <div className="grid grid-cols-2 gap-2 my-3.5 pt-1">
            <div className="flex items-center gap-1.5 text-[11px] text-slate-300 bg-slate-800/60 px-2.5 py-1.5 rounded-xl border border-slate-700/60">
              <Zap className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span>Instant Launch</span>
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-slate-300 bg-slate-800/60 px-2.5 py-1.5 rounded-xl border border-slate-700/60">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span>100% Offline Sales</span>
            </div>
          </div>

          {/* iOS Safari Guided Steps (if user is on iPhone/iPad) */}
          {isIOS && !isInstallable && (
            <div className="mb-3.5 p-3 bg-slate-800/80 border border-slate-700/80 rounded-2xl text-[11px] text-slate-200 space-y-1.5">
              <div className="font-bold flex items-center gap-1.5 text-blue-400">
                <Smartphone className="w-3.5 h-3.5" />
                <span>iPhone / iPad Setup:</span>
              </div>
              <ol className="list-decimal list-inside space-y-1 text-slate-300">
                <li>
                  Tap the Safari <strong className="text-white">Share</strong> button{' '}
                  <Share2 className="w-3 h-3 inline text-blue-400" />.
                </li>
                <li>
                  Scroll down and tap <strong className="text-white">Add to Home Screen</strong>.
                </li>
              </ol>
            </div>
          )}

          {/* Actions: Primary 1-Click Install Button & Secondary Options */}
          <div className="flex items-center gap-2 pt-1">
            {isInstallable ? (
              <button
                onClick={handleSeamlessInstallClick}
                disabled={installing}
                className="flex-1 py-2.5 px-4 bg-blue-600 hover:bg-blue-500 active:scale-95 text-white text-xs font-black rounded-xl transition-all shadow-lg shadow-blue-600/30 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                <Download className="w-4 h-4" />
                <span>{installing ? 'Launching Installer...' : 'Install Now (1 Click)'}</span>
              </button>
            ) : isIOS ? (
              <button
                onClick={() => setShowIOSDetails((prev) => !prev)}
                className="flex-1 py-2.5 px-4 bg-blue-600 hover:bg-blue-500 active:scale-95 text-white text-xs font-black rounded-xl transition-all shadow-lg shadow-blue-600/30 flex items-center justify-center gap-2 cursor-pointer"
              >
                <Smartphone className="w-4 h-4" />
                <span>{showIOSDetails ? 'Hide Instructions' : 'How to Install on iOS'}</span>
              </button>
            ) : (
              <button
                onClick={() => setShowDesktopModal(true)}
                className="flex-1 py-2.5 px-4 bg-blue-600 hover:bg-blue-500 active:scale-95 text-white text-xs font-black rounded-xl transition-all shadow-lg shadow-blue-600/30 flex items-center justify-center gap-2 cursor-pointer"
              >
                <Monitor className="w-4 h-4" />
                <span>Install Guide</span>
              </button>
            )}

            <button
              onClick={dismiss}
              className="py-2.5 px-3.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-bold rounded-xl transition-colors cursor-pointer"
              title="Dismiss install suggestion"
            >
              Not Now
            </button>

            <button
              onClick={() => setShowDesktopModal(true)}
              className="p-2.5 bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white rounded-xl transition-colors cursor-pointer"
              title="View browser-specific install guide (Chrome, Edge, Safari, Firefox)"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Success Notification */}
      {installedSuccess && (
        <div className="fixed bottom-6 right-6 bg-emerald-600 text-white px-5 py-3.5 rounded-2xl shadow-2xl z-50 flex items-center gap-3 font-bold text-xs animate-in fade-in slide-in-from-bottom-4">
          <div className="p-1.5 bg-white/20 rounded-xl">
            <CheckCircle2 className="w-5 h-5 text-white" />
          </div>
          <div>
            <p className="font-extrabold text-sm">Idofera POS Installed!</p>
            <p className="text-[11px] text-emerald-100 font-medium">
              You can now launch the app directly from your home screen or desktop.
            </p>
          </div>
        </div>
      )}

      {/* Desktop Installation Guide Modal */}
      <DesktopInstallModal
        isOpen={showDesktopModal}
        onClose={() => setShowDesktopModal(false)}
      />
    </>
  );
};

