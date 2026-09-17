import React from 'react';
import { Trash2, AlertTriangle, Info } from 'lucide-react';
import { AccessibleOverlay } from './AccessibleOverlay';

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning' | 'info';
  onConfirm: () => void;
  onClose: () => void;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  title,
  message,
  confirmText = 'Confirm Delete',
  cancelText = 'Cancel',
  variant = 'danger',
  onConfirm,
  onClose,
}) => {
  if (!isOpen) return null;

  let iconBg = 'bg-rose-100 text-rose-600 dark:bg-rose-950/80 dark:text-rose-400';
  let buttonBg = 'bg-rose-600 hover:bg-rose-700 text-white';
  let IconComponent = Trash2;

  if (variant === 'warning') {
    iconBg = 'bg-amber-100 text-amber-600 dark:bg-amber-950/80 dark:text-amber-400';
    buttonBg = 'bg-amber-600 hover:bg-amber-700 text-white';
    IconComponent = AlertTriangle;
  } else if (variant === 'info') {
    iconBg = 'bg-blue-100 text-blue-600 dark:bg-blue-950/80 dark:text-blue-400';
    buttonBg = 'bg-blue-600 hover:bg-blue-700 text-white';
    IconComponent = Info;
  }

  return (
    <AccessibleOverlay open={isOpen} onClose={onClose} title={title} description="Confirmation required" className="max-w-md" footer={
      <div className="flex items-center justify-end gap-2.5">
        <button type="button" onClick={onClose} className="min-h-10 px-4 text-sm font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl">{cancelText}</button>
        <button type="button" onClick={() => { onConfirm(); onClose(); }} className={`min-h-10 px-4 text-sm font-extrabold rounded-xl shadow-xs ${buttonBg}`}>{confirmText}</button>
      </div>
    }>
      <div className="space-y-4">
        <div className="flex items-center gap-3">
            <div className={`p-3 rounded-2xl shrink-0 ${iconBg}`}>
              <IconComponent className="w-5 h-5" />
            </div>
          <p className="text-sm font-bold">Please review this action before continuing.</p>
        </div>
        <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed bg-slate-50 dark:bg-slate-800/50 p-3.5 rounded-2xl border border-slate-100 dark:border-slate-800">
          {message}
        </p>
      </div>
    </AccessibleOverlay>
  );
};
