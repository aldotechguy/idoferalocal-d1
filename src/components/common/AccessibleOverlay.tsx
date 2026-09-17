import React from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export type AccessibleOverlayProps = {
  open: boolean; onClose: () => void; title: string; description?: string;
  children: React.ReactNode; footer?: React.ReactNode; kind?: 'modal' | 'drawer';
  className?: string; closeLabel?: string; placement?: 'left' | 'right';
};

export const AccessibleOverlay: React.FC<AccessibleOverlayProps> = ({
  open, onClose, title, description, children, footer, kind = 'modal', className = '', closeLabel = 'Close', placement = 'right',
}) => {
  const panelRef = React.useRef<HTMLDivElement>(null);
  const titleId = React.useId();
  const descriptionId = React.useId();
  React.useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => (panelRef.current?.querySelector(FOCUSABLE) as HTMLElement | null)?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
      if (event.key !== 'Tab' || !panelRef.current) return;
      const controls = Array.from(panelRef.current.querySelectorAll(FOCUSABLE)) as HTMLElement[];
      if (!controls.length) return;
      const first = controls[0]; const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('keydown', onKeyDown); document.body.style.overflow = oldOverflow; previous?.focus?.(); };
  }, [onClose, open]);
  if (!open) return null;
  const drawer = kind === 'drawer';
  return createPortal(
    <div className={`fixed inset-0 z-[9999] ${drawer ? '' : 'flex items-center justify-center p-4'}`}>
      <button type="button" className="absolute inset-0 bg-slate-950/60 backdrop-blur-xs cursor-default" onClick={onClose} aria-label={closeLabel} tabIndex={-1} />
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined}
        className={`relative bg-white dark:bg-slate-900 text-slate-900 dark:text-white border border-slate-200 dark:border-slate-800 shadow-2xl ${drawer ? `${placement === 'left' ? 'mr-auto' : 'ml-auto'} h-full w-full max-w-md flex flex-col` : 'w-full max-w-lg max-h-[92vh] rounded-3xl flex flex-col'} ${className}`}>
        <header className="flex items-start justify-between gap-4 p-4 border-b border-slate-200 dark:border-slate-800">
          <div><h2 id={titleId} className="text-base font-black">{title}</h2>{description && <p id={descriptionId} className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{description}</p>}</div>
          <button type="button" onClick={onClose} aria-label={closeLabel} className="min-w-10 min-h-10 inline-flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"><X className="w-5 h-5" /></button>
        </header>
        <div className="flex-1 min-h-0 overflow-y-auto p-4">{children}</div>
        {footer && <footer className="p-4 border-t border-slate-200 dark:border-slate-800">{footer}</footer>}
      </div>
    </div>, document.body,
  );
};