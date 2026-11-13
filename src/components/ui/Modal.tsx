import { X } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function Modal({ open, onClose, title, children, size = 'md' }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode; size?: 'sm' | 'md' | 'lg';
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-navy/60 backdrop-blur-sm" onClick={onClose} />
      <div className={cn(
        'relative max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl',
        size === 'sm' ? 'sm:max-w-md' : size === 'lg' ? 'sm:max-w-3xl' : 'sm:max-w-xl',
      )}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-navy/[0.06] bg-white px-5 py-4 sm:px-6">
          <h2 className="font-display text-2xl font-semibold text-navy">{title}</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-navy/50 hover:bg-navy/5 hover:text-navy" aria-label="Fechar"><X className="h-5 w-5" /></button>
        </div>
        <div className="p-5 sm:p-6">{children}</div>
      </div>
    </div>
  );
}

export function ConfirmDialog({ open, title, message, confirmLabel = 'Confirmar', danger, loading, onConfirm, onCancel }: {
  open: boolean; title: string; message: ReactNode; confirmLabel?: string; danger?: boolean; loading?: boolean;
  onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <Modal open={open} onClose={onCancel} title={title} size="sm">
      <div className="text-[15px] text-navy/75">{message}</div>
      <div className="mt-6 flex justify-end gap-2">
        <button onClick={onCancel} className="h-11 rounded-lg px-4 text-navy/70 hover:bg-navy/5">Cancelar</button>
        <button
          onClick={onConfirm}
          disabled={loading}
          className={cn('h-11 rounded-lg px-5 font-medium text-white disabled:opacity-60', danger ? 'bg-red-700 hover:bg-red-800' : 'bg-navy hover:bg-royal')}
        >
          {loading ? 'Aguarde…' : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
