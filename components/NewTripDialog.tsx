'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { Plus, X } from 'lucide-react';
import { useLanguage } from '@/lib/i18n';

export default function NewTripDialog({ children, open, onOpenChange, busy }: { children: ReactNode; open: boolean; onOpenChange: (open: boolean) => void; busy: boolean }) {
  const { t } = useLanguage();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) { dialog.current?.close(); return; }
    dialog.current?.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [open]);
  const close = () => {
    if (busy) return;
    dialog.current?.close();
    onOpenChange(false);
    trigger.current?.focus();
  };
  return <>
    <button ref={trigger} type="button" className="primary small" aria-haspopup="dialog" onClick={() => onOpenChange(true)}><Plus size={16} /> {t('New trip')}</button>
    <dialog ref={dialog} className="new-trip-dialog" aria-labelledby="create-trip-title" onCancel={event => { event.preventDefault(); close(); }} onClose={() => { onOpenChange(false); trigger.current?.focus(); }}>
      <header className="new-trip-dialog-header"><button type="button" className="icon-button" aria-label={t('Dismiss')} disabled={busy} onClick={close} autoFocus><X size={22} /></button></header>
      {children}
    </dialog>
  </>;
}
