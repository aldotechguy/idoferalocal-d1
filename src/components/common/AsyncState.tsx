import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

export const AsyncState: React.FC<{ title: string; message?: string; onRetry?: () => void; busy?: boolean }> = ({ title, message, onRetry, busy }) => <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 bg-white/80 dark:bg-slate-900/80 p-8 text-center" role={busy ? 'status' : 'alert'} aria-busy={busy || undefined}>
  {busy ? <RefreshCw className="w-7 h-7 mx-auto animate-spin text-amber-600" /> : <AlertTriangle className="w-7 h-7 mx-auto text-amber-500" />}
  <h2 className="mt-3 text-base font-black">{title}</h2>{message && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{message}</p>}
  {onRetry && <button type="button" onClick={onRetry} className="mt-4 h-10 px-4 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-sm font-extrabold">Try again</button>}
</div>;