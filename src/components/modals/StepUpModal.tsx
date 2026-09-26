import React, { useEffect, useState } from 'react';
import { KeyRound, ShieldAlert, X } from 'lucide-react';

/**
 * Password confirmation for privileged staff actions.
 *
 * Access SSO proves who the caller is, but it removes the password as an
 * independent factor. Anything that can change staff accounts — creating a
 * user, editing a role, deleting an account, resetting somebody else's
 * password — therefore asks for the caller's own password again. The server
 * answers those calls with 403 `STEP_UP_REQUIRED` until this succeeds; the
 * proof is short-lived and bound to the account that confirmed it
 * (see docs/staff-access.md).
 */
export const StepUpModal: React.FC<{
  isOpen: boolean;
  busy?: boolean;
  error?: string;
  onConfirm: (password: string) => void;
  onCancel: () => void;
}> = ({ isOpen, busy = false, error, onConfirm, onCancel }) => {
  const [password, setPassword] = useState('');

  useEffect(() => {
    if (isOpen) setPassword('');
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl max-w-sm w-full overflow-hidden flex flex-col my-auto">
        <div className="flex items-center justify-between p-5 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 rounded-xl">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-extrabold text-slate-900 dark:text-white">Confirm it is you</h2>
              <p className="text-[11px] text-slate-500">This action changes staff access.</p>
            </div>
          </div>
          <button
            onClick={onCancel}
            disabled={busy}
            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
            aria-label="Cancel"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form
          className="p-5 space-y-3 text-xs"
          onSubmit={(event) => {
            event.preventDefault();
            if (!password || busy) return;
            onConfirm(password);
          }}
        >
          <label className="block font-bold text-slate-700 dark:text-slate-300" htmlFor="step-up-password">
            Your account password
          </label>
          <div className="relative">
            <KeyRound className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              id="step-up-password"
              type="password"
              autoFocus
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full pl-9 pr-3 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:border-blue-500 text-slate-900 dark:text-white text-xs rounded-xl focus:outline-none transition-all"
              placeholder="••••••••"
            />
          </div>
          {error && <p className="text-[11px] font-bold text-rose-600 dark:text-rose-400">{error}</p>}
          <p className="text-[10px] text-slate-500 leading-relaxed">
            Signing in through the company identity provider is not enough on its own: your password confirms the
            change and expires after a few minutes.
          </p>
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="flex-1 py-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold text-xs rounded-xl transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || !password}
              className="flex-1 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-black text-xs rounded-xl shadow-lg shadow-blue-600/30 transition-all disabled:opacity-50"
            >
              {busy ? 'Confirming…' : 'Confirm'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
