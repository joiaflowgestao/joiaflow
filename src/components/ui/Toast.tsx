import { CheckCircle2, AlertCircle, X } from 'lucide-react';
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

type ToastKind = 'success' | 'error';
interface ToastItem { id: number; kind: ToastKind; message: string }
const ToastCtx = createContext<(kind: ToastKind, message: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const dismiss = (id: number) => setItems((l) => l.filter((t) => t.id !== id));
  const push = useCallback((kind: ToastKind, message: string) => {
    const id = Date.now() + Math.random();
    setItems((l) => [...l, { id, kind, message }]);
    setTimeout(() => dismiss(id), 4500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-4 z-[60] flex flex-col items-center gap-2 px-4 sm:items-end sm:pr-6" aria-live="polite">
        {items.map((t) => (
          <div
            key={t.id}
            className={cn(
              'pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border bg-white px-4 py-3 shadow-card',
              t.kind === 'success' ? 'border-gold-300' : 'border-red-200',
            )}
          >
            {t.kind === 'success' ? <CheckCircle2 className="mt-0.5 h-5 w-5 text-gold-500" /> : <AlertCircle className="mt-0.5 h-5 w-5 text-red-700" />}
            <p className="flex-1 text-sm text-navy">{t.message}</p>
            <button onClick={() => dismiss(t.id)} className="text-navy/40 hover:text-navy" aria-label="Fechar"><X className="h-4 w-4" /></button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => {
  const push = useContext(ToastCtx);
  return { success: (m: string) => push('success', m), error: (m: string) => push('error', m) };
};
