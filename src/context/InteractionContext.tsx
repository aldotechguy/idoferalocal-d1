import React from 'react';
import { ConfirmModal } from '../components/common/ConfirmModal';
import { useToast, type ToastType } from './ToastContext';

type ConfirmOptions = { title: string; message: string; confirmText?: string; variant?: 'danger' | 'warning' | 'info' };
type InteractionValue = {
  notify: (message: string, title?: string, type?: ToastType) => void;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
};

const InteractionContext = React.createContext<InteractionValue | null>(null);

export const InteractionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { showToast } = useToast();
  const [request, setRequest] = React.useState<(ConfirmOptions & { resolve: (value: boolean) => void }) | null>(null);
  const confirm = React.useCallback((options: ConfirmOptions) => new Promise<boolean>((resolve) => setRequest({ ...options, resolve })), []);
  const settle = React.useCallback((value: boolean) => {
    setRequest((current) => { current?.resolve(value); return null; });
  }, []);
  const notify = React.useCallback((message: string, title = 'Action required', type: ToastType = 'error') => showToast({ title, message, type }), [showToast]);
  return <InteractionContext.Provider value={{ notify, confirm }}>
    {children}
    <ConfirmModal isOpen={Boolean(request)} title={request?.title || 'Confirm action'} message={request?.message || ''} confirmText={request?.confirmText || 'Continue'} variant={request?.variant || 'warning'} onConfirm={() => settle(true)} onClose={() => settle(false)} />
  </InteractionContext.Provider>;
};

export function useInteractions(): InteractionValue {
  const value = React.useContext(InteractionContext);
  if (!value) throw new Error('useInteractions must be used within InteractionProvider');
  return value;
}