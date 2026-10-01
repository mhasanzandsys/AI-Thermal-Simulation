'use client';
import { useEffect, useId, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { CheckCircle2, AlertTriangle, XCircle, Info, ChevronDown } from 'lucide-react';
import { useIssue } from '@/store/project';

export function Card({ title, actions, children, className, bodyClass }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClass?: string }) {
  return (
    <section className={clsx('card flex min-w-0 flex-col', className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-2 px-4 pt-3 pb-2">
          {title && <h2 className="card-title">{title}</h2>}
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={clsx('px-4 pb-4 flex-1 min-h-0', bodyClass)}>{children}</div>
    </section>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange, className, size = 'md' }: { tabs: { id: T; label: ReactNode; disabled?: boolean; hint?: string }[]; value: T; onChange: (v: T) => void; className?: string; size?: 'sm' | 'md' }) {
  return (
    <div className={clsx('flex flex-wrap border-b border-slate-200', className)} role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} disabled={t.disabled} title={t.hint}
          onClick={() => onChange(t.id)}
          className={clsx('-mb-px border border-transparent px-3 text-[12px] transition-colors', size === 'sm' ? 'py-1' : 'py-1.5',
            value === t.id ? 'bg-brand-600 text-white rounded-t border-brand-600' : 'text-slate-600 hover:text-brand-600',
            t.disabled && 'opacity-40 cursor-not-allowed hover:text-slate-600')}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function FieldError({ path }: { path?: string }) {
  const issue = useIssue(path ?? '__none__');
  if (!path || !issue) return null;
  return <p className={clsx('mt-0.5 text-[11px] leading-tight', issue.severity === 'Error' ? 'text-red-600' : 'text-amber-600')}>{issue.message}</p>;
}

export function Field({ label, children, path, unit, hint, className, inline = true }: { label: ReactNode; children: ReactNode; path?: string; unit?: string; hint?: string; className?: string; inline?: boolean }) {
  return (
    <div className={clsx(inline ? 'grid grid-cols-[minmax(110px,42%)_1fr] items-start gap-2' : 'flex flex-col gap-1', className)}>
      <label className="label pt-1.5 leading-tight" title={hint ?? path}>{label}{unit && <span className="text-slate-400"> ({unit})</span>}</label>
      <div className="min-w-0">{children}<FieldError path={path} /></div>
    </div>
  );
}

export function TextInput({ value, onChange, path, placeholder, disabled, type = 'text', className }: { value: string; onChange: (v: string) => void; path?: string; placeholder?: string; disabled?: boolean; type?: string; className?: string }) {
  const issue = useIssue(path ?? '__none__');
  return <input type={type} className={clsx('input', issue?.severity === 'Error' && 'input-error', issue?.severity === 'Warning' && 'input-warn', className)} value={value} placeholder={placeholder} disabled={disabled} onChange={(e) => onChange(e.target.value)} />;
}

export function TextArea({ value, onChange, rows = 3, path }: { value: string; onChange: (v: string) => void; rows?: number; path?: string }) {
  const issue = useIssue(path ?? '__none__');
  return <textarea rows={rows} className={clsx('input h-auto py-1', issue?.severity === 'Error' && 'input-error')} value={value} onChange={(e) => onChange(e.target.value)} />;
}

const fmt = (v: number | null | undefined) => (v == null || Number.isNaN(v) ? '' : String(v));

export function NumInput({ value, onChange, path, min, max, step, disabled, allowNull, className, placeholder, suffix }: {
  value: number | null | undefined; onChange: (v: number | null) => void; path?: string; min?: number; max?: number; step?: number; disabled?: boolean; allowNull?: boolean; className?: string; placeholder?: string; suffix?: string;
}) {
  const [text, setText] = useState(fmt(value));
  const [focus, setFocus] = useState(false);
  const issue = useIssue(path ?? '__none__');
  useEffect(() => { if (!focus) setText(fmt(value)); }, [value, focus]);
  const commit = (t: string) => {
    if (t.trim() === '') { if (allowNull) onChange(null); return; }
    const n = Number(t);
    if (Number.isFinite(n)) onChange(n);
  };
  const bad = text.trim() !== '' && !Number.isFinite(Number(text));
  return (
    <div className={clsx('relative', className)}>
      <input inputMode="decimal" className={clsx('input', suffix && 'pr-9', (bad || issue?.severity === 'Error') && 'input-error', issue?.severity === 'Warning' && 'input-warn')}
        value={text} disabled={disabled} placeholder={placeholder} min={min} max={max} step={step}
        onFocus={() => setFocus(true)}
        onBlur={() => { setFocus(false); commit(text); }}
        onChange={(e) => { setText(e.target.value); commit(e.target.value); }} />
      {suffix && <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-slate-400">{suffix}</span>}
    </div>
  );
}

export function Select<T extends string>({ value, onChange, options, disabled, path, className }: { value: T; onChange: (v: T) => void; options: readonly (T | { value: T; label: string })[]; disabled?: boolean; path?: string; className?: string }) {
  const issue = useIssue(path ?? '__none__');
  return (
    <div className={clsx('relative', className)}>
      <select className={clsx('input appearance-none pr-7', issue?.severity === 'Error' && 'input-error')} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => { const v = typeof o === 'string' ? o : o.value; const l = typeof o === 'string' ? o : o.label; return <option key={v} value={v}>{l}</option>; })}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
    </div>
  );
}

export function Check({ checked, onChange, label, disabled, className }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; disabled?: boolean; className?: string }) {
  const id = useId();
  return (
    <label htmlFor={id} className={clsx('flex items-center gap-2 text-[12.5px] text-slate-700 select-none', disabled ? 'opacity-50' : 'cursor-pointer', className)}>
      <input id={id} type="checkbox" className="h-3.5 w-3.5 accent-brand-600" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean }) {
  return (
    <button type="button" disabled={disabled} onClick={() => onChange(!checked)} className={clsx('flex items-center gap-2 text-[12.5px] text-slate-700', disabled && 'opacity-50')}>
      <span className={clsx('relative h-4 w-7 rounded-full transition-colors', checked ? 'bg-brand-600' : 'bg-slate-300')}>
        <span className={clsx('absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-all', checked ? 'left-3.5' : 'left-0.5')} />
      </span>
      {label}
    </button>
  );
}

export function Radio<T extends string>({ value, onChange, options, name }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; name: string }) {
  return (
    <div className="flex flex-col gap-1">
      {options.map((o) => (
        <label key={o.value} className="flex cursor-pointer items-center gap-2 text-[12.5px] text-slate-700">
          <input type="radio" name={name} className="h-3.5 w-3.5 accent-brand-600" checked={value === o.value} onChange={() => onChange(o.value)} />
          {o.label}
        </label>
      ))}
    </div>
  );
}

export function Badge({ kind = 'neutral', children }: { kind?: 'ok' | 'warn' | 'error' | 'info' | 'neutral'; children: ReactNode }) {
  return (
    <span className={clsx('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium', {
      'bg-emerald-50 text-emerald-700': kind === 'ok', 'bg-amber-50 text-amber-700': kind === 'warn', 'bg-red-50 text-red-700': kind === 'error',
      'bg-brand-50 text-brand-600': kind === 'info', 'bg-slate-100 text-slate-600': kind === 'neutral',
    })}>{children}</span>
  );
}

export function StatusIcon({ ok, warn, className }: { ok: boolean; warn?: boolean; className?: string }) {
  if (ok) return <CheckCircle2 className={clsx('h-4 w-4 text-emerald-600', className)} />;
  if (warn) return <AlertTriangle className={clsx('h-4 w-4 text-amber-500', className)} />;
  return <XCircle className={clsx('h-4 w-4 text-red-500', className)} />;
}

export function Kpi({ label, value, unit, sub, warn }: { label: string; value: ReactNode; unit?: string; sub?: ReactNode; warn?: ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
      <div className="flex items-center justify-between text-[11px] text-slate-500">{label}{warn && <span title={typeof warn === 'string' ? warn : undefined}><AlertTriangle className="h-3.5 w-3.5 text-amber-500" /></span>}</div>
      <div className="mt-0.5 text-xl font-semibold text-navy-900">{value}<span className="ml-1 text-[12px] font-normal text-slate-500">{unit}</span></div>
      {sub && <div className="text-[11px] text-slate-500">{sub}</div>}
    </div>
  );
}

export function Empty({ children, icon }: { children: ReactNode; icon?: ReactNode }) {
  return <div className="flex flex-col items-center justify-center gap-2 rounded border border-dashed border-slate-300 py-8 text-center text-[12.5px] text-slate-500">{icon ?? <Info className="h-5 w-5 text-slate-400" />}{children}</div>;
}

export function IssueList({ issues, compact }: { issues: { id: string; message: string; severity: string; path: string }[]; compact?: boolean }) {
  if (!issues.length) return <p className="flex items-center gap-1.5 text-[12px] text-emerald-700"><CheckCircle2 className="h-4 w-4" /> All validation rules pass.</p>;
  return (
    <ul className={clsx('space-y-1', compact && 'max-h-40 overflow-auto')}>
      {issues.map((i, k) => (
        <li key={k} className="flex items-start gap-1.5 text-[12px]">
          {i.severity === 'Error' ? <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" /> : i.severity === 'Warning' ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" /> : <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-500" />}
          <span><span className="font-mono text-[10.5px] text-slate-400">{i.id}</span> {i.message}</span>
        </li>
      ))}
    </ul>
  );
}

export function SubHead({ children }: { children: ReactNode }) {
  return <h3 className="mb-1.5 mt-1 text-[12.5px] font-semibold text-navy-900">{children}</h3>;
}
