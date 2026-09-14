import React, { useState } from 'react';
import {
  Monitor,
  Download,
  ExternalLink,
  X,
  CheckCircle2,
  Compass,
  ArrowRight,
  ShieldCheck,
  Zap,
  Laptop,
  Check
} from 'lucide-react';
import { usePWAInstall } from '../../hooks/usePWAInstall';

interface DesktopInstallModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const DesktopInstallModal: React.FC<DesktopInstallModalProps> = ({ isOpen, onClose }) => {
  const { isInstallable, isInstalled, triggerInstall } = usePWAInstall();
  const [activeTab, setActiveTab] = useState<'chrome' | 'edge' | 'safari' | 'firefox'>('chrome');
  const [installedSuccess, setInstalledSuccess] = useState(false);
  const [installing, setInstalling] = useState(false);

  if (!isOpen) return null;

  const handleNativeInstall = async () => {
    setInstalling(true);
    const success = await triggerInstall();
    setInstalling(false);
    if (success) {
      setInstalledSuccess(true);
      setTimeout(() => {
        setInstalledSuccess(false);
        onClose();
      }, 3000);
    }
  };

  const handleOpenStandaloneTab = () => {
    window.open(window.location.href, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md overflow-y-auto animate-fade-in">
      <div className="relative w-full max-w-2xl bg-slate-900 border border-slate-800 text-white rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] my-auto">
        
        {/* Header */}
        <div className="p-6 bg-gradient-to-r from-blue-900/60 via-slate-900 to-indigo-900/60 border-b border-slate-800 flex items-start justify-between relative">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-blue-600/20 text-blue-400 rounded-2xl border border-blue-500/30 shadow-inner">
              <Monitor className="w-7 h-7" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-black text-white">Install on Computer / Laptop</h3>
                <span className="px-2 py-0.5 text-[10px] font-extrabold uppercase bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded-full flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3 text-emerald-400" /> Standalone Desktop App
                </span>
              </div>
              <p className="text-xs text-slate-300 mt-1">
                Install Idofera Packaging POS onto your Windows, macOS, or Linux PC for full-screen offline operations.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition-colors cursor-pointer"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-y-6">
          
          {/* Quick Action Banner */}
          <div className="p-4 bg-slate-800/80 border border-slate-700/80 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <h4 className="text-xs font-black text-white flex items-center gap-1.5">
                <Zap className="w-4 h-4 text-amber-400" />
                <span>Instant Installation Action</span>
              </h4>
              <p className="text-xs text-slate-300">
                {isInstalled
                  ? 'App is already installed on this device!'
                  : isInstallable
                  ? 'Click below to launch the native Desktop installation prompt.'
                  : 'Open the app in a standalone tab or follow the browser menu steps below.'}
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {isInstallable && !isInstalled ? (
                <button
                  onClick={handleNativeInstall}
                  disabled={installing}
                  className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 active:scale-95 text-white font-extrabold text-xs rounded-xl transition-all shadow-lg flex items-center gap-2 cursor-pointer shadow-blue-500/20"
                >
                  <Download className="w-4 h-4" />
                  <span>{installing ? 'Installing...' : 'Install App Now'}</span>
                </button>
              ) : (
                <button
                  onClick={handleOpenStandaloneTab}
                  className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white font-bold text-xs rounded-xl transition-all flex items-center gap-2 cursor-pointer"
                >
                  <ExternalLink className="w-4 h-4 text-blue-400" />
                  <span>Open Direct Window</span>
                </button>
              )}
            </div>
          </div>

          {/* Desktop App Benefits */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="p-3 bg-slate-950/60 border border-slate-800 rounded-2xl space-y-1">
              <div className="flex items-center gap-1.5 text-xs font-extrabold text-blue-400">
                <ShieldCheck className="w-4 h-4" />
                <span>100% Offline Ready</span>
              </div>
              <p className="text-[11px] text-slate-400">Works directly without internet using Chrome local IndexedDB storage.</p>
            </div>

            <div className="p-3 bg-slate-950/60 border border-slate-800 rounded-2xl space-y-1">
              <div className="flex items-center gap-1.5 text-xs font-extrabold text-emerald-400">
                <Laptop className="w-4 h-4" />
                <span>Desktop Shortcut</span>
              </div>
              <p className="text-[11px] text-slate-400">Launches from Windows Desktop, Start Menu, or Mac Dock in standalone window.</p>
            </div>

            <div className="p-3 bg-slate-950/60 border border-slate-800 rounded-2xl space-y-1">
              <div className="flex items-center gap-1.5 text-xs font-extrabold text-amber-400">
                <Zap className="w-4 h-4" />
                <span>High Performance</span>
              </div>
              <p className="text-[11px] text-slate-400">No browser address bars or navigation clutter — feels like native desktop software.</p>
            </div>
          </div>

          {/* Browser Specific Installation Guide */}
          <div className="space-y-3">
            <h4 className="text-xs font-black text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
              <Compass className="w-4 h-4 text-indigo-400" />
              <span>Step-by-Step Desktop Guide by Browser</span>
            </h4>

            {/* Browser Tabs */}
            <div className="flex items-center gap-2 border-b border-slate-800 pb-2 overflow-x-auto">
              <button
                onClick={() => setActiveTab('chrome')}
                className={`px-3 py-1.5 rounded-xl text-xs font-extrabold transition-all cursor-pointer whitespace-nowrap ${
                  activeTab === 'chrome'
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'bg-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                Google Chrome
              </button>
              <button
                onClick={() => setActiveTab('edge')}
                className={`px-3 py-1.5 rounded-xl text-xs font-extrabold transition-all cursor-pointer whitespace-nowrap ${
                  activeTab === 'edge'
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'bg-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                Microsoft Edge
              </button>
              <button
                onClick={() => setActiveTab('safari')}
                className={`px-3 py-1.5 rounded-xl text-xs font-extrabold transition-all cursor-pointer whitespace-nowrap ${
                  activeTab === 'safari'
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'bg-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                Apple Safari (macOS)
              </button>
              <button
                onClick={() => setActiveTab('firefox')}
                className={`px-3 py-1.5 rounded-xl text-xs font-extrabold transition-all cursor-pointer whitespace-nowrap ${
                  activeTab === 'firefox'
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'bg-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                Firefox / Other
              </button>
            </div>

            {/* Instructions per browser */}
            <div className="p-4 bg-slate-950/80 border border-slate-800 rounded-2xl text-xs space-y-3 text-slate-300">
              {activeTab === 'chrome' && (
                <ol className="space-y-2 list-decimal list-inside">
                  <li>
                    Look at the right side of the browser URL address bar for the <strong className="text-white">Install Icon</strong> (computer monitor with down arrow or <span className="text-blue-400 font-bold">(+)</span>).
                  </li>
                  <li>
                    Click <strong className="text-white">Install Idofera Packaging POS...</strong> when prompted.
                  </li>
                  <li>
                    <strong className="text-white">Alternative:</strong> Click Chrome's top right three dots menu (<strong className="text-white font-mono">⋮</strong>) &rarr; <strong className="text-white">Save and Share</strong> &rarr; <strong className="text-white">Install Idofera POS...</strong>
                  </li>
                </ol>
              )}

              {activeTab === 'edge' && (
                <ol className="space-y-2 list-decimal list-inside">
                  <li>
                    Look at Microsoft Edge's URL bar on the right for the <strong className="text-white font-bold">App Available (+)</strong> icon.
                  </li>
                  <li>
                    Click <strong className="text-white">Install</strong> to create an app window on your PC.
                  </li>
                  <li>
                    <strong className="text-white">Alternative:</strong> Click Edge menu (<strong className="text-white font-mono">...</strong>) &rarr; <strong className="text-white">Apps</strong> &rarr; <strong className="text-white">Install this site as an app</strong>.
                  </li>
                </ol>
              )}

              {activeTab === 'safari' && (
                <ol className="space-y-2 list-decimal list-inside">
                  <li>
                    On macOS (Sonoma, Sequoia or newer), open Safari and click <strong className="text-white">File</strong> in the top Mac menu bar.
                  </li>
                  <li>
                    Select <strong className="text-white">Add to Dock...</strong>
                  </li>
                  <li>
                    Click <strong className="text-white">Add</strong>. The Idofera POS icon will appear in your Mac Launchpad & Dock as a standalone Mac Desktop App!
                  </li>
                </ol>
              )}

              {activeTab === 'firefox' && (
                <ol className="space-y-2 list-decimal list-inside">
                  <li>
                    Open app in standalone window by clicking <button onClick={handleOpenStandaloneTab} className="text-blue-400 underline font-bold cursor-pointer">Open Direct Window</button>.
                  </li>
                  <li>
                    Click browser menu &rarr; <strong className="text-white">More Tools</strong> &rarr; <strong className="text-white">Create Shortcut...</strong>
                  </li>
                  <li>
                    Check <strong className="text-white">Open in new window</strong> and click <strong className="text-white">Add</strong>.
                  </li>
                </ol>
              )}
            </div>
          </div>

          {installedSuccess && (
            <div className="p-3 bg-emerald-950/80 border border-emerald-500/40 text-emerald-200 rounded-xl text-xs font-bold flex items-center gap-2 animate-bounce">
              <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              <span>Idofera POS has been successfully installed as a Desktop Computer App!</span>
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="p-4 bg-slate-950 border-t border-slate-800 flex items-center justify-between">
          <span className="text-[11px] text-slate-400 flex items-center gap-1">
            <Check className="w-3.5 h-3.5 text-emerald-400" />
            <span>Compatible with Windows 10/11, macOS, Linux & ChromeOS</span>
          </span>

          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-xl transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>

      </div>
    </div>
  );
};
