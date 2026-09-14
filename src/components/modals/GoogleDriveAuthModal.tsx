import React, { useState } from 'react';
import {
  HardDrive,
  Cloud,
  CheckCircle2,
  AlertCircle,
  X,
  ExternalLink,
  ShieldCheck,
  RefreshCw,
  FolderOpen,
  Mail,
  Key,
} from 'lucide-react';
import {
  requestGoogleDriveAuthorization,
  getGoogleDriveConnectedEmail,
  getGoogleDriveAccessToken,
  DEDICATED_DRIVE_FOLDER_ID,
} from '../../services/googleDriveService';

interface GoogleDriveAuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAuthorized?: (email?: string) => void;
  actionReason?: string;
}

export const GoogleDriveAuthModal: React.FC<GoogleDriveAuthModalProps> = ({
  isOpen,
  onClose,
  onAuthorized,
  actionReason = 'To upload and synchronize database backups to your dedicated Google Drive folder, Google Drive authorization is required.',
}) => {
  const [isAuthorizing, setIsAuthorizing] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  if (!isOpen) return null;

  const currentEmail = getGoogleDriveConnectedEmail();
  const hasAccessToken = Boolean(getGoogleDriveAccessToken());

  const handleAuthorize = async () => {
    setIsAuthorizing(true);
    setAuthError(null);
    try {
      const res = await requestGoogleDriveAuthorization();
      setIsAuthorizing(false);
      if (onAuthorized) {
        onAuthorized(res.email);
      }
      onClose();
    } catch (err: any) {
      setIsAuthorizing(false);
      setAuthError(err?.message || 'Google Drive authorization was cancelled or failed. Please try again.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md overflow-y-auto animate-fade-in">
      <div className="relative w-full max-w-lg bg-slate-900 border border-emerald-500/30 text-white rounded-3xl shadow-2xl overflow-hidden flex flex-col my-auto animate-scale-up">
        {/* Modal Header */}
        <div className="p-6 bg-gradient-to-r from-emerald-950 via-slate-900 to-slate-950 border-b border-slate-800 flex items-start justify-between relative">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-emerald-600/20 text-emerald-400 rounded-2xl border border-emerald-500/30 shadow-inner">
              <HardDrive className="w-7 h-7" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-black text-white">Authorize Google Drive</h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  Cloud Backup
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Idofera POS Dedicated Cloud Storage
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-4 text-xs">
          {/* Reason Card */}
          <div className="p-3.5 bg-slate-800/80 border border-slate-700/80 rounded-2xl space-y-1.5 text-slate-300 leading-relaxed">
            <div className="flex items-center gap-2 text-emerald-400 font-bold">
              <Cloud className="w-4 h-4 shrink-0" />
              <span>Drive Authorization Required</span>
            </div>
            <p className="text-[11px] text-slate-300">{actionReason}</p>
          </div>

          {/* Connected state if token exists */}
          {hasAccessToken && currentEmail && (
            <div className="p-3 bg-emerald-950/40 border border-emerald-500/30 rounded-xl flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Mail className="w-4 h-4 text-emerald-400" />
                <div>
                  <p className="text-[10px] text-slate-400 uppercase font-bold">Currently Connected Account</p>
                  <p className="text-xs font-mono font-bold text-emerald-300">{currentEmail}</p>
                </div>
              </div>
              <span className="px-2 py-0.5 text-[10px] font-bold bg-emerald-500/20 text-emerald-300 rounded-full border border-emerald-500/30">
                Connected
              </span>
            </div>
          )}

          {/* Folder & Security Info */}
          <div className="space-y-2">
            <div className="p-3 bg-slate-950/70 border border-slate-800 rounded-xl space-y-1">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Dedicated Folder ID</p>
              <p className="text-xs font-mono font-bold text-emerald-300 truncate">{DEDICATED_DRIVE_FOLDER_ID}</p>
              <a
                href={`https://drive.google.com/drive/folders/${DEDICATED_DRIVE_FOLDER_ID}?usp=sharing`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] text-emerald-400 hover:underline flex items-center gap-1 mt-1 font-bold inline-flex"
              >
                <FolderOpen className="w-3 h-3" />
                <span>View Google Drive Folder</span>
                <ExternalLink className="w-2.5 h-2.5 ml-0.5" />
              </a>
            </div>

            <div className="p-3 bg-slate-950/70 border border-slate-800 rounded-xl space-y-1">
              <div className="flex items-center gap-1.5 text-emerald-400 font-bold text-[11px]">
                <ShieldCheck className="w-4 h-4" />
                <span>Safe Direct Google Sign-In</span>
              </div>
              <p className="text-[10px] text-slate-400 leading-relaxed">
                Clicking the button below opens Google's secure account selector directly from your click gesture, preventing browser popup blockers from stopping authorization.
              </p>
            </div>
          </div>

          {/* Error display */}
          {authError && (
            <div className="p-3 bg-rose-950/50 border border-rose-500/50 rounded-xl flex items-start gap-2 text-rose-300">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
              <div className="space-y-0.5">
                <p className="text-[11px] font-bold">Authorization Notice</p>
                <p className="text-[10px] leading-relaxed">{authError}</p>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-5 bg-slate-950 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            className="w-full sm:w-auto px-4 py-2.5 text-xs font-bold text-slate-400 hover:text-white rounded-xl bg-slate-800 hover:bg-slate-700 transition-colors cursor-pointer"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={handleAuthorize}
            disabled={isAuthorizing}
            className="w-full sm:w-auto px-5 py-2.5 text-xs font-black text-slate-950 bg-emerald-400 hover:bg-emerald-300 rounded-xl transition-all shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
          >
            {isAuthorizing ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Opening Google Sign-In...</span>
              </>
            ) : (
              <>
                <HardDrive className="w-4 h-4" />
                <span>Authorize with Google Drive</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
