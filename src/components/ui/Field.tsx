import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

interface FieldWrapProps { label?: string; error?: string | null; hint?: ReactNode; id: string; children: ReactNode }
function FieldWrap({ label, error, hint, id, children }: FieldWrapProps) {
  return (
    <div className="min-w-0">
      {label && <label htmlFor={id} className="field-label">{label}</label>}
      {children}
      {error ? (
        <p id={`${id}-err`} className="mt-1.5 text-sm text-red-700">{error}</p>
      ) : hint ? (
        <p className="mt-1.5 text-xs text-navy/50">{hint}</p>
      ) : null}
    </div>
  );
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string; error?: string | null; hint?: ReactNode; leading?: ReactNode;
}
export const Input = forwardRef<HTMLInputElement, InputProps>(({ label, error, hint, leading, className, id, ...rest }, ref) => {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <FieldWrap label={label} error={error} hint={hint} id={fid}>
      <div className="relative min-w-0">
        {leading && <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-navy/45">{leading}</span>}
        <input
          ref={ref}
          id={fid}
          aria-invalid={!!error}
          aria-describedby={error ? `${fid}-err` : undefined}
          className={cn('field-input', leading && 'pl-10', error && 'border-red-600', className)}
          {...rest}
        />
      </div>
    </FieldWrap>
  );
});
Input.displayName = 'Input';

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> { label?: string; error?: string | null; hint?: ReactNode }
export const Select = forwardRef<HTMLSelectElement, SelectProps>(({ label, error, hint, className, id, children, ...rest }, ref) => {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <FieldWrap label={label} error={error} hint={hint} id={fid}>
      <select ref={ref} id={fid} aria-invalid={!!error} className={cn('field-input appearance-none bg-white', error && 'border-red-600', className)} {...rest}>
        {children}
      </select>
    </FieldWrap>
  );
});
Select.displayName = 'Select';
