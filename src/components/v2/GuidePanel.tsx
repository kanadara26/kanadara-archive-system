import React, { useEffect, useMemo, useState } from 'react';
import { PaymentSplitItem, SplitCardCompany } from '../../types';
import {
  DEFAULT_GUIDE,
  GUIDE_WHEN_LIST,
  GuideData,
  GuideSection,
  GuideStep,
  GuideWhen,
} from '../../guide/guideData';
import { BookOpen, Check, ChevronDown, Copy, Pencil, Plus, RotateCcw, Trash2, X } from 'lucide-react';

// ponytail: 가이드 수정본·진행 체크는 이 브라우저(localStorage)에만 저장. 팀 공유·관리자 관리가 필요해지면 시트 탭으로 옮김
const MODE_KEY = 'kanadara.guideMode';
const DATA_KEY = 'kanadara.guide.data';
const PROGRESS_KEY = 'kanadara.guide.progress.';

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 저장 불가(사생활 보호 모드 등)면 이번 화면에서만 유지 */
  }
}

export function useGuideMode() {
  const [on, setOn] = useState<boolean>(() => load(MODE_KEY, false));
  const toggle = () =>
    setOn((v) => {
      save(MODE_KEY, !v);
      return !v;
    });
  return { guideMode: on, toggleGuideMode: toggle };
}

const CARD_LABEL: Record<SplitCardCompany, string> = {
  국민: '국민카드',
  농협: '농협카드',
  롯데: '롯데카드',
  신한: '신한카드',
  우리: '우리카드',
  하나: '하나카드',
  '제휴카드사(삼성)': '삼성카드',
};

const won = (n: number) => n.toLocaleString('ko-KR');
const uid = () => Math.random().toString(36).slice(2, 9);

type CardGroup = { card: SplitCardCompany; when: Set<GuideWhen>; splits: PaymentSplitItem[] };

function groupByCard(splits: PaymentSplitItem[]): CardGroup[] {
  const map = new Map<SplitCardCompany, CardGroup>();
  splits.forEach((s) => {
    const g = map.get(s.cardCompany) || { card: s.cardCompany, when: new Set<GuideWhen>(), splits: [] };
    g.splits.push(s);
    if (s.paymentMethod === '일시불') g.when.add('일시불');
    else if (s.paymentMethod === '할부') g.when.add('할부');
    else g.when.add('다이렉트할부'); // '다이렉트할부' · '다이렉트'
    map.set(s.cardCompany, g);
  });
  map.forEach((g) => {
    if (g.when.has('일시불') && (g.when.has('할부') || g.when.has('다이렉트할부'))) g.when.add('복합');
  });
  return [...map.values()];
}

const shows = (sec: GuideSection, when: Set<GuideWhen> | null) =>
  !sec.when || sec.when.length === 0 || !when || when.size === 0 || sec.when.some((w) => when.has(w));

function fillTemplate(tpl: string, splits: PaymentSplitItem[], cards: string, customer: string, cm: string, agent: string) {
  const lump = splits.filter((s) => s.paymentMethod === '일시불');
  const inst = splits.filter((s) => s.paymentMethod !== '일시불');
  const sum = (xs: PaymentSplitItem[]) => xs.reduce((n, s) => n + (s.amount || 0), 0);
  const method = lump.length && inst.length ? '일시불+할부' : inst.length ? '할부' : lump.length ? '일시불' : '[결제방식]';
  const vals: Record<string, string> = {
    고객명: customer || '[고객명]',
    카드사: cards || '[카드사]',
    결제방식: method,
    일시불금액: lump.length ? won(sum(lump)) : '[금액]',
    할부원금: inst.length ? won(sum(inst)) : '[원금]',
    개월: inst.length ? [...new Set(inst.map((s) => s.installmentMonths))].join('/') : '[개월]',
    총금액: splits.length ? won(sum(splits)) : '[금액]',
    CM: cm || '[CM 이름]',
    모집인: agent || '[이름]',
  };
  return tpl.replace(/\{(고객명|카드사|결제방식|일시불금액|할부원금|개월|총금액|CM|모집인)\}/g, (_, k) => vals[k]);
}

interface Props {
  splits: PaymentSplitItem[];
  fallbackCard: SplitCardCompany | null; // 아직 결제 행이 없을 때 고른 카드사
  customerName: string;
  cmName: string;
  agentName: string;
  progressKey: string; // 거래 id 또는 'new'
  onClose: () => void;
}

/** 등록 화면 옆 가이드 패널: 카드사·결제방식에 맞는 단계별 체크리스트 */
export const GuidePanel: React.FC<Props> = ({ splits, fallbackCard, customerName, cmName, agentName, progressKey, onClose }) => {
  const [data, setData] = useState<GuideData>(() => {
    const saved = load<GuideData | null>(DATA_KEY, null);
    return saved && saved.version === DEFAULT_GUIDE.version ? saved : DEFAULT_GUIDE;
  });
  const [isCustom, setIsCustom] = useState<boolean>(() => !!load(DATA_KEY, null));
  const [editing, setEditing] = useState<GuideData | null>(null);
  const [done, setDone] = useState<Record<string, boolean>>(() => load(PROGRESS_KEY + progressKey, {}));
  const [openOverride, setOpenOverride] = useState<Record<string, boolean>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => setDone(load(PROGRESS_KEY + progressKey, {})), [progressKey]);

  const groups = useMemo(() => {
    const g = groupByCard(splits);
    if (g.length === 0 && fallbackCard) return [{ card: fallbackCard, when: new Set<GuideWhen>(), splits: [] }];
    return g;
  }, [splits, fallbackCard]);
  const allCards = groups.map((g) => CARD_LABEL[g.card]).join('·');

  const view = editing || data;

  // 보여줄 묶음 (순서대로): 공통 시작 → 카드사별 → 공통 마감
  const blocks = useMemo(() => {
    const out: { key: string; label?: string; summary?: string; section: GuideSection; path: (d: GuideData) => GuideSection[]; ctx: CardGroup | null }[] = [];
    view.commonStart.forEach((s) => out.push({ key: `common:${s.id}`, section: s, path: (d) => d.commonStart, ctx: null }));
    groups.forEach((g) => {
      const card = view.cards[g.card];
      card.sections
        .filter((s) => editing || shows(s, g.when))
        .forEach((s, i) =>
          out.push({
            key: `${g.card}:${s.id}`,
            label: i === 0 ? CARD_LABEL[g.card] : undefined,
            summary: i === 0 ? card.summary : undefined,
            section: s,
            path: (d) => d.cards[g.card].sections,
            ctx: g,
          })
        );
    });
    view.commonEnd.forEach((s) => out.push({ key: `end:${s.id}`, section: s, path: (d) => d.commonEnd, ctx: null }));
    return out;
  }, [view, groups, editing]);

  const allStepKeys = blocks.flatMap((b) => b.section.steps.map((st) => `${b.key}:${st.id}`));
  const doneCount = allStepKeys.filter((k) => done[k]).length;
  const currentKey = allStepKeys.find((k) => !done[k]);

  const toggleStep = (k: string) => {
    const next = { ...done, [k]: !done[k] };
    setDone(next);
    save(PROGRESS_KEY + progressKey, next);
  };
  const resetProgress = () => {
    setDone({});
    setOpenOverride({});
    save(PROGRESS_KEY + progressKey, null);
  };

  const copy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 1500);
    } catch {
      window.prompt('복사할 문구', text);
    }
  };

  // ── 수정 ──
  const mutate = (fn: (d: GuideData) => void) =>
    setEditing((prev) => {
      const d: GuideData = JSON.parse(JSON.stringify(prev || data));
      fn(d);
      return d;
    });
  const findSec = (d: GuideData, path: (d: GuideData) => GuideSection[], id: string) => path(d).find((s) => s.id === id)!;
  const saveEdit = () => {
    if (!editing) return;
    setData(editing);
    save(DATA_KEY, editing);
    setIsCustom(true);
    setEditing(null);
  };
  const resetData = () => {
    if (!window.confirm('수정한 가이드 내용을 모두 지우고 매뉴얼 기본값으로 되돌릴까요?')) return;
    setData(DEFAULT_GUIDE);
    save(DATA_KEY, null);
    setIsCustom(false);
    setEditing(null);
  };

  const inputCls = 'w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 focus:border-slate-900 focus:outline-none';

  return (
    <aside
      aria-label="가이드모드"
      data-arrow-nav="off"
      className="fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l border-slate-200 bg-white shadow-xl sm:w-[360px]"
    >
      <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-slate-900 px-4 py-3 text-white">
        <div className="flex min-w-0 items-center gap-2">
          <BookOpen className="h-4 w-4 shrink-0" />
          <div className="min-w-0">
            <h2 className="truncate text-sm font-extrabold">업무 가이드 {allCards && `· ${allCards}`}</h2>
            <p className="text-[11px] text-slate-300 tabular-nums">
              {doneCount}/{allStepKeys.length} 완료{isCustom && ' · 수정본'}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {!editing && (
            <button type="button" onClick={() => setEditing(JSON.parse(JSON.stringify(data)))} className="rounded-md px-2 py-1 text-[11px] font-bold text-slate-200 hover:bg-slate-800">
              <Pencil className="mr-1 inline h-3 w-3" />
              수정
            </button>
          )}
          <button type="button" aria-label="가이드 닫기" onClick={onClose} className="rounded-md p-1.5 text-slate-300 hover:bg-slate-800 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="h-1 bg-slate-100">
        <div className="h-1 bg-emerald-500 transition-all" style={{ width: `${allStepKeys.length ? (doneCount / allStepKeys.length) * 100 : 0}%` }} />
      </div>

      {editing && (
        <div className="flex flex-wrap items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-[11px] text-amber-900">
          <span className="font-bold">수정 중 · 이 카드사의 모든 묶음이 보입니다</span>
          <div className="ml-auto flex gap-1.5">
            <button type="button" onClick={resetData} className="rounded-md px-2 py-1 font-bold hover:bg-amber-100">기본값으로</button>
            <button type="button" onClick={() => setEditing(null)} className="rounded-md border border-amber-300 bg-white px-2 py-1 font-bold hover:bg-amber-100">취소</button>
            <button type="button" onClick={saveEdit} className="rounded-md bg-slate-900 px-2.5 py-1 font-bold text-white hover:bg-slate-800">저장</button>
          </div>
        </div>
      )}

      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {groups.length === 0 && (
          <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">카드사를 고르면 해당 카드사 절차가 함께 표시됩니다.</p>
        )}
        {blocks.map((b) => {
          const sec = b.section;
          const stepKeys = sec.steps.map((st) => `${b.key}:${st.id}`);
          const secDone = stepKeys.length > 0 && stepKeys.every((k) => done[k]);
          const hasCurrent = !!currentKey && stepKeys.includes(currentKey);
          const open = editing ? true : openOverride[b.key] ?? hasCurrent;
          const ctxSplits = b.ctx ? b.ctx.splits : splits;
          const ctxCards = b.ctx ? CARD_LABEL[b.ctx.card] : allCards;
          const fill = (tpl: string) => fillTemplate(tpl, ctxSplits, ctxCards, customerName, cmName, agentName);
          return (
            <React.Fragment key={b.key}>
              {b.label && (
                <div className="px-1 pt-2">
                  <h3 className="text-sm font-extrabold text-slate-900">{b.label}</h3>
                  {editing ? (
                    <input
                      className={`${inputCls} mt-1`}
                      value={editing.cards[b.ctx!.card].summary}
                      onChange={(e) => mutate((d) => (d.cards[b.ctx!.card].summary = e.target.value))}
                    />
                  ) : (
                    <p className="text-[11px] text-slate-500">{b.summary}</p>
                  )}
                </div>
              )}
              <section className={`rounded-xl border ${hasCurrent && !editing ? 'border-slate-900' : 'border-slate-200'}`}>
                {editing ? (
                  <div className="space-y-1.5 p-3">
                    <div className="flex gap-1.5">
                      <input
                        className={`${inputCls} font-bold`}
                        value={sec.title}
                        onChange={(e) => mutate((d) => (findSec(d, b.path, sec.id).title = e.target.value))}
                      />
                      <button
                        type="button"
                        aria-label="묶음 삭제"
                        onClick={() => window.confirm(`'${sec.title}' 묶음을 삭제할까요?`) && mutate((d) => {
                          const list = b.path(d);
                          list.splice(list.findIndex((s) => s.id === sec.id), 1);
                        })}
                        className="rounded-md p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    {b.ctx && (
                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-600">
                        <span className="font-bold">표시:</span>
                        {GUIDE_WHEN_LIST.map((w) => (
                          <label key={w} className="inline-flex items-center gap-1">
                            <input
                              type="checkbox"
                              checked={!!sec.when?.includes(w)}
                              onChange={(e) =>
                                mutate((d) => {
                                  const s = findSec(d, b.path, sec.id);
                                  const cur = new Set(s.when || []);
                                  if (e.target.checked) cur.add(w);
                                  else cur.delete(w);
                                  s.when = GUIDE_WHEN_LIST.filter((x) => cur.has(x));
                                })
                              }
                            />
                            {w}
                          </label>
                        ))}
                        <span className="text-slate-400">(모두 해제 = 항상)</span>
                      </div>
                    )}
                    <textarea
                      rows={2}
                      placeholder="주의사항 (선택)"
                      className={inputCls}
                      value={sec.caution || ''}
                      onChange={(e) => mutate((d) => (findSec(d, b.path, sec.id).caution = e.target.value))}
                    />
                    {sec.steps.map((st, i) => (
                      <StepEditor
                        key={st.id}
                        step={st}
                        index={i}
                        inputCls={inputCls}
                        onChange={(patch) => mutate((d) => Object.assign(findSec(d, b.path, sec.id).steps[i], patch))}
                        onRemove={() => mutate((d) => findSec(d, b.path, sec.id).steps.splice(i, 1))}
                      />
                    ))}
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        onClick={() => mutate((d) => findSec(d, b.path, sec.id).steps.push({ id: uid(), text: '' }))}
                        className="inline-flex items-center gap-1 rounded-md border border-dashed border-slate-300 px-2 py-1 text-[11px] font-bold text-slate-600 hover:bg-slate-50"
                      >
                        <Plus className="h-3 w-3" />
                        단계 추가
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          mutate((d) => {
                            const list = b.path(d);
                            list.splice(list.findIndex((s) => s.id === sec.id) + 1, 0, { id: uid(), title: '새 묶음', when: sec.when, steps: [] });
                          })
                        }
                        className="inline-flex items-center gap-1 rounded-md border border-dashed border-slate-300 px-2 py-1 text-[11px] font-bold text-slate-600 hover:bg-slate-50"
                      >
                        <Plus className="h-3 w-3" />
                        아래에 묶음 추가
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      aria-expanded={open}
                      onClick={() => setOpenOverride((o) => ({ ...o, [b.key]: !open }))}
                      className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
                    >
                      {secDone ? (
                        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
                          <Check className="h-3 w-3 stroke-[3]" />
                        </span>
                      ) : (
                        <span className="shrink-0 text-[11px] font-bold tabular-nums text-slate-500">
                          {stepKeys.filter((k) => done[k]).length}/{stepKeys.length}
                        </span>
                      )}
                      <span className={`flex-1 text-xs font-extrabold ${secDone ? 'text-slate-500' : 'text-slate-900'}`}>{sec.title}</span>
                      <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
                    </button>
                    {open && (
                      <div className="space-y-1.5 px-3 pb-3">
                        {sec.caution && (
                          <p className="rounded-lg bg-amber-50 px-2.5 py-2 text-[11px] leading-relaxed text-amber-900">{sec.caution}</p>
                        )}
                        <ol className="space-y-1">
                          {sec.steps.map((st) => {
                            const k = `${b.key}:${st.id}`;
                            const isCurrent = k === currentKey;
                            return (
                              <li key={st.id} className={`rounded-lg px-2 py-1.5 ${isCurrent ? 'bg-slate-100' : ''}`}>
                                <label className="flex cursor-pointer items-start gap-2">
                                  <input type="checkbox" checked={!!done[k]} onChange={() => toggleStep(k)} className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-slate-900" />
                                  <span className={`text-xs leading-relaxed ${done[k] ? 'text-slate-400 line-through' : 'font-bold text-slate-800'}`}>
                                    {isCurrent && <span className="mr-1 rounded bg-slate-900 px-1 py-px text-[10px] font-bold text-white no-underline">지금</span>}
                                    {st.text}
                                  </span>
                                </label>
                                {st.detail && !done[k] && <p className="ml-[22px] mt-0.5 text-[11px] leading-relaxed text-slate-600">{st.detail}</p>}
                                {st.copy && !done[k] && (
                                  <div className="ml-[22px] mt-1 rounded-md border border-slate-200 bg-white p-2">
                                    <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-slate-700">{fill(st.copy)}</p>
                                    <button
                                      type="button"
                                      onClick={() => copy(k, fill(st.copy!))}
                                      className="mt-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-bold text-slate-700 hover:bg-slate-100"
                                    >
                                      {copiedId === k ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                                      {copiedId === k ? '복사됨' : '문구 복사'}
                                    </button>
                                  </div>
                                )}
                              </li>
                            );
                          })}
                        </ol>
                      </div>
                    )}
                  </>
                )}
              </section>
            </React.Fragment>
          );
        })}
      </div>

      {!editing && (
        <div className="flex items-center justify-between border-t border-slate-200 px-4 py-2.5 text-[11px] text-slate-500">
          <span>체크 상태는 이 브라우저에만 저장됩니다</span>
          <button type="button" onClick={resetProgress} className="inline-flex items-center gap-1 rounded px-1.5 py-1 font-bold text-slate-600 hover:bg-slate-100">
            <RotateCcw className="h-3 w-3" />
            체크 초기화
          </button>
        </div>
      )}
    </aside>
  );
};

const StepEditor: React.FC<{
  step: GuideStep;
  index: number;
  inputCls: string;
  onChange: (patch: Partial<GuideStep>) => void;
  onRemove: () => void;
}> = ({ step, index, inputCls, onChange, onRemove }) => (
  <div className="space-y-1 rounded-lg border border-slate-200 bg-slate-50 p-2">
    <div className="flex items-start gap-1.5">
      <span className="pt-1 text-[11px] font-bold tabular-nums text-slate-500">{index + 1}.</span>
      <textarea rows={2} placeholder="단계 내용" className={inputCls} value={step.text} onChange={(e) => onChange({ text: e.target.value })} />
      <button type="button" aria-label="단계 삭제" onClick={onRemove} className="rounded-md p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600">
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
    <textarea rows={2} placeholder="설명 (선택)" className={inputCls} value={step.detail || ''} onChange={(e) => onChange({ detail: e.target.value })} />
    <textarea
      rows={2}
      placeholder="복사 문구 (선택) · {고객명} {카드사} {결제방식} {일시불금액} {할부원금} {개월} {총금액} {CM} {모집인}"
      className={inputCls}
      value={step.copy || ''}
      onChange={(e) => onChange({ copy: e.target.value })}
    />
  </div>
);
