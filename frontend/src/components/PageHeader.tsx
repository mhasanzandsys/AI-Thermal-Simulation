import type { ReactNode } from 'react';

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-2 pb-1">
      <div>
        <h1 className="text-[20px] font-semibold text-navy-900">{title}</h1>
        {subtitle && <p className="text-[12.5px] text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
