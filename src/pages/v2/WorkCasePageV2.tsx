import React, { useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { CmCombobox } from '../../components/v2/CmCombobox';
import { GuidePanel, useGuideMode } from '../../components/v2/GuidePanel';
import {
  PaymentSplitItem,
  SPLIT_CARD_COMPANIES,
  SplitCardCompany,
  SplitPaymentMethod,
  V2_PAYMENT_METHODS,
  V2PaymentMethodType,
} from '../../types';
import { formatKRW } from '../../utils/format';
import { ArrowRight, Plus, Trash2 } from 'lucide-react';

/**
 * 가이드모드 전용 '업무 진행' 화면.
 * 승인건 등록 전에 공통 접수 정보를 적어 두고 카드사·결제방식에 맞는 체크리스트를 보며 진행 →
 * 마지막에 '승인건으로 넘기기'를 누르면 임시저장으로 만들어 등록 화면에서 조건(요율)만 고르고 등록.
 */
// ponytail: 진행건은 이 브라우저(localStorage)에만 저장 (가이드 체크와 같은 방식). 여러 기기·팀 공유가 필요하면 시트 탭으로
const CASES_KEY = 'kanadara.work.cases';

interface WorkCase {
  id: string;
  createdAt: string;
  status: '진행중' | '승인건 넘김';
  customerName: string;
  customerPhone: string;
  hasCard: '확인 전' | '보유' | '미보유';
  ownership: '단독명의' | '공동명의';
  cmId: string;
  card: SplitCardCompany | null;
  method: V2PaymentMethodType | null;
  mixedInst: '할부' | '다이렉트할부'; // 혼합일 때 할부 쪽 종류
  lumpAmount: number; // 일시불 실제 결제금액
  instAmount: number; // 할부원금
  months: number;
  vehiclePrice: number; // 견적서 순수 차량가격
  downPayment: number; // 견적서 인도금
  deadline: string; // 제조사 결제 마감 일시
  memo: string;
}

const CARD_LABEL: Record<SplitCardCompany, string> = {
  국민: '국민',
  농협: '농협',
  롯데: '롯데',
  신한: '신한',
  우리: '우리',
  하나: '하나',
  '제휴카드사(삼성)': '삼성',
};

function loadCases(): WorkCase[] {
  try {
    return JSON.parse(localStorage.getItem(CASES_KEY) || '[]');
  } catch {
    return [];
  }
}

const newCase = (): WorkCase => ({
  id: `wc-${Date.now()}`,
  createdAt: new Date().toLocaleString('ko-KR'),
  status: '진행중',
  customerName: '',
  customerPhone: '',
  hasCard: '확인 전',
  ownership: '단독명의',
  cmId: '',
  card: null,
  method: null,
  mixedInst: '할부',
  lumpAmount: 0,
  instAmount: 0,
  months: 36,
  vehiclePrice: 0,
  downPayment: 0,
  deadline: '',
  memo: '',
});

const hasLump = (m: V2PaymentMethodType | null) => m === '일시불' || m === '혼합';
const hasInst = (m: V2PaymentMethodType | null) => !!m && m !== '일시불';

/** 결제 행 (요율은 비워 두고 등록 화면에서 요율표로 고름) */
function buildSplits(c: WorkCase): PaymentSplitItem[] {
  if (!c.card || !c.method) return [];
  const card = c.card;
  const mk = (paymentMethod: SplitPaymentMethod, amount: number, months: number): PaymentSplitItem => ({
    id: `${c.id}-${paymentMethod}`,
    cardCompany: card,
    paymentMethod,
    amount,
    installmentMonths: months,
    cashbackRate: 0,
    interestRate: 0,
    agCommissionRate: 0,
    cmCommissionRate: 0,
  });
  const out: PaymentSplitItem[] = [];
  if (hasLump(c.method)) out.push(mk('일시불', c.lumpAmount, 1));
  if (hasInst(c.method)) {
    const m: SplitPaymentMethod = c.method === '다이렉트' ? '다이렉트할부' : c.method === '혼합' ? c.mixedInst : '할부';
    out.push(mk(m, c.instAmount, c.months));
  }
  return out;
}

/** 넘기기 전에 빠진 것 */
function missing(c: WorkCase): string[] {
  const out: string[] = [];
  if (!c.customerName.trim()) out.push('고객 성명');
  if (!c.cmId) out.push('담당 CM');
  if (!c.card) out.push('카드사');
  if (!c.method) out.push('결제방식');
  if (hasLump(c.method) && c.lumpAmount <= 0) out.push('일시불 결제금액');
  if (hasInst(c.method) && c.instAmount <= 0) out.push('할부원금');
  if (hasInst(c.method) && c.months <= 0) out.push('할부 개월수');
  return out;
}

const inputCls =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none';
const labelCls = 'mb-1 block text-xs font-bold text-slate-700';

const MoneyField: React.FC<{ id: string; label: string; value: number; onChange: (n: number) => void; hint?: string }> = ({
  id,
  label,
  value,
  onChange,
  hint,
}) => (
  <div>
    <label htmlFor={id} className={labelCls}>
      {label}
    </label>
    <input
      id={id}
      inputMode="numeric"
      className={`${inputCls} text-right tabular-nums`}
      value={value ? value.toLocaleString('ko-KR') : ''}
      placeholder="0"
      onChange={(e) => onChange(Number(e.target.value.replace(/[^\d]/g, '')) || 0)}
    />
    {hint && <p className="mt-1 text-[11px] text-slate-500">{hint}</p>}
  </div>
);

function Seg<T extends string>({ value, options, onChange, label }: { value: T | null; options: { v: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o.v}
          type="button"
          role="radio"
          aria-checked={value === o.v}
          onClick={() => onChange(o.v)}
          className={`rounded-lg border px-3 py-1.5 text-xs font-bold ${
            value === o.v ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="rounded-xl border border-slate-200 bg-white p-4">
    <h3 className="mb-3 text-sm font-extrabold text-slate-900">{title}</h3>
    {children}
  </section>
);

export const WorkCasePageV2: React.FC = () => {
  const { guideMode } = useGuideMode();
  return guideMode ? <WorkCaseBody /> : <Navigate to="/dashboard" replace />;
};

const WorkCaseBody: React.FC = () => {
  const { users, currentUser, saveDraftV2, setPendingDraftIdV2, pushToast } = useApp();
  const navigate = useNavigate();
  const cmUsers = useMemo(() => users.filter((u) => u.role === 'CM' && u.isActive), [users]);

  const [cases, setCases] = useState<WorkCase[]>(loadCases);
  const [selectedId, setSelectedId] = useState<string | null>(() => loadCases()[0]?.id ?? null);

  useEffect(() => {
    try {
      localStorage.setItem(CASES_KEY, JSON.stringify(cases));
    } catch {
      /* 저장 불가면 이번 화면에서만 유지 */
    }
  }, [cases]);

  const c = cases.find((x) => x.id === selectedId) || null;
  const update = (patch: Partial<WorkCase>) => c && setCases((prev) => prev.map((x) => (x.id === c.id ? { ...x, ...patch } : x)));
  const splits = useMemo(() => (c ? buildSplits(c) : []), [c]);
  const draftId = c ? `draft-${c.id}` : '';

  const addCase = () => {
    const n = newCase();
    setCases((prev) => [n, ...prev]);
    setSelectedId(n.id);
  };
  const removeCase = (id: string) => {
    if (!window.confirm('이 진행건을 삭제할까요? 체크리스트 진행 상태도 함께 사라집니다.')) return;
    setCases((prev) => prev.filter((x) => x.id !== id));
    try {
      localStorage.removeItem(`kanadara.guide.progress.draft-${id}`);
    } catch {
      /* 무시 */
    }
    if (selectedId === id) setSelectedId(cases.find((x) => x.id !== id)?.id ?? null);
  };

  const transfer = () => {
    if (!c) return;
    const miss = missing(c);
    if (miss.length) {
      pushToast({ type: 'error', title: '아직 넘길 수 없습니다', description: `${miss.join(', ')}을(를) 입력해 주세요.` });
      return;
    }
    // ponytail: 휴대전화번호는 시트로 가는 메모에 넣지 않음 (개인정보)
    const memo = [c.deadline && `결제기한 ${c.deadline.replace('T', ' ')}`, c.ownership === '공동명의' && '공동명의', c.memo.trim()]
      .filter(Boolean)
      .join(' / ');
    const today = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    saveDraftV2({
      id: draftId,
      title: `[업무진행] ${c.customerName} · ${c.card} ${c.method}`,
      activeStep: 2,
      cardCompany: c.card,
      paymentMethodType: c.method,
      requestDate: `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`,
      approvalDate: '',
      paymentSplits: splits,
      appliedPromotions: [],
      customerName: c.customerName.trim(),
      cmId: c.cmId,
      requestMemo: memo,
    });
    update({ status: '승인건 넘김' });
    setPendingDraftIdV2(draftId);
    navigate('/register');
  };

  const miss = c ? missing(c) : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900">업무 진행</h1>
          <p className="text-xs text-slate-500">
            승인건 등록 전 접수 정보를 적어 두고 오른쪽 체크리스트를 따라 진행합니다. 마지막에 승인건으로 넘기면 등록 화면에서 조건만 고르면 됩니다.
          </p>
        </div>
        <button type="button" onClick={addCase} className="flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white hover:bg-slate-800">
          <Plus className="h-3.5 w-3.5" />새 진행건
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)_360px]">
        {/* 진행건 목록 */}
        <nav aria-label="진행건 목록" className="space-y-1.5">
          {cases.length === 0 && <p className="rounded-xl border border-dashed border-slate-300 p-4 text-xs text-slate-500">진행건이 없습니다. [새 진행건]으로 시작하세요.</p>}
          {cases.map((x) => (
            <div
              key={x.id}
              className={`flex items-start gap-1 rounded-lg border px-3 py-2 ${x.id === selectedId ? 'border-slate-900 bg-white' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
            >
              <button type="button" onClick={() => setSelectedId(x.id)} className="min-w-0 flex-1 text-left" aria-current={x.id === selectedId}>
                <p className="truncate text-xs font-extrabold text-slate-900">{x.customerName || '(고객명 미입력)'}</p>
                <p className="truncate text-[11px] text-slate-500">
                  {x.card ? CARD_LABEL[x.card] : '카드 미정'} · {x.method || '방식 미정'}
                </p>
                <p className={`mt-0.5 text-[10px] font-bold ${x.status === '승인건 넘김' ? 'text-emerald-700' : 'text-slate-500'}`}>{x.status}</p>
              </button>
              <button type="button" aria-label="진행건 삭제" onClick={() => removeCase(x.id)} className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-rose-600">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </nav>

        {/* 접수 정보 */}
        {c ? (
          <div className="min-w-0 space-y-3">
            <Section title="① 고객 · CM">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="wc-name" className={labelCls}>
                    고객 성명
                  </label>
                  <input id="wc-name" className={inputCls} value={c.customerName} onChange={(e) => update({ customerName: e.target.value })} />
                </div>
                <div>
                  <label htmlFor="wc-phone" className={labelCls}>
                    고객 휴대전화
                  </label>
                  <input id="wc-phone" inputMode="tel" className={inputCls} value={c.customerPhone} onChange={(e) => update({ customerPhone: e.target.value })} />
                  <p className="mt-1 text-[11px] text-slate-500">이 브라우저에만 저장되고 승인건에는 넘어가지 않습니다.</p>
                </div>
                <div>
                  <label htmlFor="wc-cm" className={labelCls}>
                    담당 CM
                  </label>
                  <CmCombobox id="wc-cm" cms={cmUsers} value={c.cmId} onChange={(cmId) => update({ cmId })} />
                </div>
                <div>
                  <span className={labelCls}>명의</span>
                  <Seg label="명의" value={c.ownership} options={[{ v: '단독명의', label: '단독명의' }, { v: '공동명의', label: '공동명의' }]} onChange={(ownership) => update({ ownership })} />
                </div>
              </div>
            </Section>

            <Section title="② 카드사 · 결제조건">
              <div className="space-y-3">
                <div>
                  <span className={labelCls}>카드사</span>
                  <Seg label="카드사" value={c.card} options={SPLIT_CARD_COMPANIES.map((v) => ({ v, label: CARD_LABEL[v] }))} onChange={(card) => update({ card })} />
                </div>
                <div>
                  <span className={labelCls}>해당 카드 보유 여부</span>
                  <Seg
                    label="카드 보유 여부"
                    value={c.hasCard}
                    options={[{ v: '확인 전', label: '확인 전' }, { v: '보유', label: '보유' }, { v: '미보유', label: '미보유 (발급 필요)' }]}
                    onChange={(hasCard) => update({ hasCard })}
                  />
                </div>
                <div>
                  <span className={labelCls}>결제방식</span>
                  <Seg label="결제방식" value={c.method} options={V2_PAYMENT_METHODS.map((m) => ({ v: m.key, label: m.label }))} onChange={(method) => update({ method })} />
                </div>
                {c.method === '혼합' && (
                  <div>
                    <span className={labelCls}>혼합의 할부 쪽</span>
                    <Seg label="혼합 할부 종류" value={c.mixedInst} options={[{ v: '할부', label: '할부' }, { v: '다이렉트할부', label: '다이렉트' }]} onChange={(mixedInst) => update({ mixedInst })} />
                  </div>
                )}
                {c.method && (
                  <div className="grid gap-3 sm:grid-cols-3">
                    {hasLump(c.method) && <MoneyField id="wc-lump" label="일시불 실제 결제금액" value={c.lumpAmount} onChange={(lumpAmount) => update({ lumpAmount })} />}
                    {hasInst(c.method) && <MoneyField id="wc-inst" label="할부원금" value={c.instAmount} onChange={(instAmount) => update({ instAmount })} />}
                    {hasInst(c.method) && (
                      <div>
                        <label htmlFor="wc-months" className={labelCls}>
                          신청 개월수
                        </label>
                        <input
                          id="wc-months"
                          inputMode="numeric"
                          className={`${inputCls} text-right tabular-nums`}
                          value={c.months || ''}
                          onChange={(e) => update({ months: Number(e.target.value.replace(/[^\d]/g, '')) || 0 })}
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            </Section>

            <Section title="③ 견적서 · 일정">
              <div className="grid gap-3 sm:grid-cols-3">
                <MoneyField id="wc-price" label="순수 차량가격" value={c.vehiclePrice} onChange={(vehiclePrice) => update({ vehiclePrice })} hint="카드사 전산의 '차량가격' 입력값" />
                <MoneyField id="wc-down" label="인도금" value={c.downPayment} onChange={(downPayment) => update({ downPayment })} hint="일시불 판단 참고 (실제 결제금액과 대조)" />
                <div>
                  <label htmlFor="wc-deadline" className={labelCls}>
                    결제 마감 일시
                  </label>
                  <input id="wc-deadline" type="datetime-local" className={inputCls} value={c.deadline} onChange={(e) => update({ deadline: e.target.value })} />
                  <p className="mt-1 text-[11px] text-slate-500">제조사에 실제 결제돼야 하는 최종 시점</p>
                </div>
              </div>
              {hasLump(c.method) && c.downPayment > 0 && c.lumpAmount > 0 && c.downPayment !== c.lumpAmount && (
                <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[11px] font-bold text-amber-900">
                  인도금({formatKRW(c.downPayment)})과 일시불 결제금액({formatKRW(c.lumpAmount)})이 다릅니다. 실제 카드 결제금액을 CM에게 다시 확인하세요.
                </p>
              )}
              <div className="mt-3">
                <label htmlFor="wc-memo" className={labelCls}>
                  메모
                </label>
                <textarea id="wc-memo" rows={2} className={inputCls} value={c.memo} onChange={(e) => update({ memo: e.target.value })} />
                <p className="mt-1 text-[11px] text-slate-500">결제기한·공동명의와 함께 승인건 요청 메모로 넘어갑니다.</p>
              </div>
            </Section>

            {/* 마지막 단계 */}
            <section className="rounded-xl border-2 border-slate-900 bg-white p-4">
              <h3 className="text-sm font-extrabold text-slate-900">④ 승인건으로 넘기기</h3>
              <p className="mt-1 text-xs text-slate-600">
                결제 준비가 끝나면 넘기세요. 등록 화면이 이 내용으로 채워져 열리고, 요율표에서 조건(요율)만 골라 확인하면 등록됩니다. 체크리스트 진행 상태도 그대로 이어집니다.
              </p>
              {miss.length > 0 && <p className="mt-2 text-xs font-bold text-rose-700">아직 필요: {miss.join(', ')}</p>}
              {c.status === '승인건 넘김' && <p className="mt-2 text-xs font-bold text-emerald-700">이미 넘긴 건입니다. 다시 넘기면 임시저장 내용을 이 정보로 덮어씁니다.</p>}
              <button
                type="button"
                onClick={transfer}
                disabled={miss.length > 0}
                className="mt-3 flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-extrabold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600"
              >
                승인건 등록 화면으로 넘기기
                <ArrowRight className="h-4 w-4" />
              </button>
            </section>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">왼쪽에서 진행건을 고르거나 새로 만드세요.</div>
        )}

        {/* 체크리스트 */}
        {c && (
          <GuidePanel
            inline
            splits={splits}
            fallbackCard={c.card}
            customerName={c.customerName}
            cmName={cmUsers.find((u) => u.id === c.cmId)?.name || ''}
            agentName={currentUser?.name || ''}
            progressKey={draftId}
          />
        )}
      </div>
    </div>
  );
};
