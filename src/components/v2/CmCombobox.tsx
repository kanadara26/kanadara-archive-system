import React, { useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { User } from '../../types';
import { focusNext } from '../../utils/keyboardNav';

interface Props {
  id: string;
  cms: User[];
  value: string;
  onChange: (cmId: string) => void;
  disabled?: boolean;
}

const searchText = (c: User) =>
  [c.name, c.affiliation, c.employeeId || '', c.phone || ''].join(' ').toLowerCase().replace(/-/g, '');

/** 담당 CM 선택: 열린 상태에서 이름·소속·사번·연락처로 검색, ↑↓로 고르고 Enter로 선택 */
export const CmCombobox: React.FC<Props> = ({ id, cms, value, onChange, disabled }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const selected = cms.find((c) => c.id === value);

  const matches = useMemo(() => {
    const kw = query.trim().toLowerCase().replace(/-/g, '');
    return kw ? cms.filter((c) => searchText(c).includes(kw)) : cms;
  }, [cms, query]);

  const openList = () => {
    setOpen(true);
    setQuery('');
    setActive(Math.max(0, cms.findIndex((c) => c.id === value)));
  };

  const choose = (c: User) => {
    onChange(c.id);
    setOpen(false);
    setQuery('');
    if (inputRef.current) focusNext(inputRef.current);
  };

  const listId = `${id}-list`;
  return (
    <div className="relative" data-arrow-nav="off">
      <input
        ref={inputRef}
        id={id}
        type="text"
        lang="ko"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        disabled={disabled}
        value={open ? query : selected ? `${selected.name} · ${selected.affiliation}${selected.employeeId ? ` · ${selected.employeeId}` : ''}` : ''}
        placeholder={open ? '이름 · 소속 · 사번 · 연락처로 검색' : 'CM 선택'}
        onFocus={openList}
        onClick={() => !open && openList()}
        onBlur={() => setOpen(false)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (!open) return openList();
            const step = e.key === 'ArrowDown' ? 1 : -1;
            setActive((i) => Math.min(matches.length - 1, Math.max(0, i + step)));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            if (open && matches[active]) choose(matches[active]);
            else if (!open) openList();
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
        className="w-full rounded-xl border border-slate-300 bg-white py-2.5 pl-3.5 pr-9 text-sm font-bold text-slate-900 placeholder:font-medium placeholder:text-slate-400 focus:border-slate-900 focus:outline-none disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
      />
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      {open && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg"
        >
          {matches.length === 0 ? (
            <li className="px-3.5 py-3 text-xs text-slate-400">일치하는 CM이 없습니다.</li>
          ) : (
            matches.map((c, i) => (
              <li
                key={c.id}
                role="option"
                aria-selected={c.id === value}
                ref={(el) => i === active && el?.scrollIntoView({ block: 'nearest' })}
                onMouseDown={(e) => {
                  e.preventDefault(); // 입력칸 포커스 유지
                  choose(c);
                }}
                onMouseEnter={() => setActive(i)}
                className={`flex cursor-pointer items-baseline justify-between gap-3 px-3.5 py-2 text-xs ${
                  i === active ? 'bg-slate-100' : ''
                }`}
              >
                <span className="min-w-0 truncate">
                  <strong className="font-extrabold text-slate-900">{c.name}</strong>
                  <span className="text-slate-500"> · {c.affiliation}</span>
                </span>
                <span className="shrink-0 font-mono text-[11px] text-slate-400">
                  {[c.employeeId, c.phone].filter(Boolean).join(' · ')}
                </span>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
};
