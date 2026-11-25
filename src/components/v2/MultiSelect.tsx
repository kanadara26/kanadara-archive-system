import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

/** 체크박스 드롭다운. 아무것도 안 고르면 '전체' */
export function MultiSelect<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T[];
  onChange: (next: T[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const picked = options.filter((o) => value.includes(o.value));
  const summary =
    picked.length === 0 ? '전체' : picked.length <= 2 ? picked.map((o) => o.label).join(', ') : `${picked[0].label} 외 ${picked.length - 1}`;
  const toggle = (v: T) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);

  return (
    <div ref={ref} className="relative" data-arrow-nav={open ? 'off' : undefined}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label} 필터`}
        onClick={() => setOpen((o) => !o)}
        className={`flex w-full items-center justify-between gap-2 rounded-lg border bg-white px-3 py-2 text-left text-xs font-bold focus:border-slate-900 focus:outline-none ${
          picked.length ? 'border-slate-900 text-slate-900' : 'border-slate-300 text-slate-800'
        }`}
      >
        <span className="truncate">
          {label}: {summary}
        </span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div role="listbox" aria-multiselectable="true" className="absolute left-0 right-0 z-30 mt-1 max-h-72 min-w-[12rem] overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
          <button
            type="button"
            onClick={() => onChange([])}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs font-bold text-slate-700 hover:bg-slate-100"
          >
            <span className={`flex h-3.5 w-3.5 items-center justify-center rounded border ${picked.length === 0 ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300'}`}>
              {picked.length === 0 && <Check className="h-2.5 w-2.5 stroke-[3]" />}
            </span>
            전체
          </button>
          {options.map((o) => {
            const on = value.includes(o.value);
            return (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={on}
                onClick={() => toggle(o.value)}
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs font-bold text-slate-800 hover:bg-slate-100"
              >
                <span className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${on ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300'}`}>
                  {on && <Check className="h-2.5 w-2.5 stroke-[3]" />}
                </span>
                <span className="truncate">{o.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
