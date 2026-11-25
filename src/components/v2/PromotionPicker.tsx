import React from 'react';
import { AppliedPromotionSnapshot, CardPromotionItem, PaymentSplitItem } from '../../types';
import { formatKRW } from '../../utils/format';
import { Check, Gift } from 'lucide-react';

/** 프로모션 → 거래에 저장할 스냅샷 (프로모션이 나중에 바뀌어도 등록 당시 조건 유지) */
export function toPromotionSnapshot(p: CardPromotionItem): AppliedPromotionSnapshot {
  return {
    promotionId: p.id,
    cardCompany: p.cardCompany,
    title: p.title,
    startDate: p.startDate,
    endDate: p.endDate,
    paymentMethod: p.paymentMethod,
    minAmount: p.minAmount,
    maxAmount: p.maxAmount,
    amountConditionLabel: p.amountConditionLabel,
    cashbackRateDelta: p.cashbackRateDelta,
    interestRateDelta: p.interestRateDelta,
    agIncentiveRate: p.agIncentiveRate,
    cmIncentiveRate: p.cmIncentiveRate,
    agIncentiveAmount: p.agIncentiveAmount,
    cmIncentiveAmount: p.cmIncentiveAmount,
    promotionConditionText: p.promotionConditionText,
  };
}

const isDirect = (m: string) => m === '다이렉트할부' || m === '다이렉트';

/** 조건이 안 맞으면 이유, 맞으면 null. 금액은 정산 계산(calcPromotionIncentives)과 같은 기준: 같은 결제방법 행 합계, '통합'은 전체 */
export function promotionMismatch(
  p: Pick<CardPromotionItem, 'startDate' | 'endDate' | 'paymentMethod' | 'minAmount' | 'maxAmount' | 'amountConditionLabel'>,
  splits: PaymentSplitItem[],
  refDate: string
): string | null {
  if (p.startDate && refDate < p.startDate) return `${p.startDate} 시작`;
  if (p.endDate && refDate > p.endDate) return '기간 종료';
  const rows =
    p.paymentMethod === '통합'
      ? splits
      : splits.filter((s) => s.paymentMethod === p.paymentMethod || (isDirect(s.paymentMethod) && isDirect(p.paymentMethod)));
  if (rows.length === 0) return `${p.paymentMethod} 결제 없음`;
  const amt = rows.reduce((n, s) => n + (Number(s.amount) || 0), 0);
  if (amt <= 0) return '금액 미입력';
  if (amt < p.minAmount) return '금액 부족';
  if (p.maxAmount != null && (amt > p.maxAmount || (amt === p.maxAmount && p.amountConditionLabel.includes('미만')))) return '금액 초과';
  return null;
}

const signed = (n: number, unit: string) => `${n > 0 ? '+' : ''}${n}${unit}`;

function effectText(p: CardPromotionItem | AppliedPromotionSnapshot): string[] {
  const out: string[] = [];
  if (p.cashbackRateDelta) out.push(`캐시백 ${signed(p.cashbackRateDelta, '%p')}`);
  if (p.interestRateDelta) out.push(`금리 ${signed(p.interestRateDelta, '%p')}`);
  if (p.cmIncentiveRate) out.push(`CM ${signed(p.cmIncentiveRate, '%')}`);
  if (p.agIncentiveRate) out.push(`AG ${signed(p.agIncentiveRate, '%')}`);
  if (p.cmIncentiveAmount) out.push(`CM ${p.cmIncentiveAmount > 0 ? '+' : ''}${formatKRW(p.cmIncentiveAmount)}`);
  if (p.agIncentiveAmount) out.push(`AG ${p.agIncentiveAmount > 0 ? '+' : ''}${formatKRW(p.agIncentiveAmount)}`);
  return out;
}

/** 등록 화면 프로모션 칸: 조건 맞는 것 강조, 누르면 적용/해제 */
export const PromotionPicker: React.FC<{
  promotions: CardPromotionItem[]; // 선택 카드사의 활성 프로모션
  splits: PaymentSplitItem[];
  refDate: string;
  applied: AppliedPromotionSnapshot[];
  onToggle: (p: CardPromotionItem) => void;
  onRemove: (promotionId: string) => void;
}> = ({ promotions, splits, refDate, applied, onToggle, onRemove }) => {
  const appliedIds = new Set(applied.map((a) => a.promotionId));
  const rows = promotions
    .map((p) => ({ p, why: promotionMismatch(p, splits, refDate) }))
    .sort((a, b) => Number(!!a.why) - Number(!!b.why));
  // 적용했지만 목록에 없는 것 (수정 중인 거래에 저장된 예전 프로모션)
  const orphan = applied.filter((a) => !promotions.some((p) => p.id === a.promotionId));
  const matchCount = rows.filter((r) => !r.why).length;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-xs font-extrabold text-slate-900">
          <Gift className="h-3.5 w-3.5" />
          프로모션
        </h3>
        <span className="text-[11px] font-bold text-slate-500">
          {promotions.length === 0 ? '등록된 프로모션 없음' : `적용 가능 ${matchCount}건 · 적용 ${applied.length}건`}
        </span>
      </div>
      {promotions.length > 0 && <p className="mb-2 text-[11px] text-slate-500">조건이 맞는 프로모션이 강조됩니다. 눌러서 적용하면 수수료와 정산 내역에 반영됩니다.</p>}
      <div className="space-y-1.5">
        {orphan.map((a) => (
          <div key={a.promotionId} className="flex items-start justify-between gap-2 rounded-lg border border-slate-900 bg-slate-50 px-3 py-2">
            <div className="min-w-0">
              <p className="text-xs font-extrabold text-slate-900">{a.title}</p>
              <p className="text-[11px] text-slate-600">등록 당시 적용된 프로모션 · {effectText(a).join(' · ')}</p>
            </div>
            <button type="button" onClick={() => onRemove(a.promotionId)} className="shrink-0 rounded-md px-2 py-1 text-[11px] font-bold text-slate-700 hover:bg-slate-200">
              해제
            </button>
          </div>
        ))}
        {rows.map(({ p, why }) => {
          const on = appliedIds.has(p.id);
          const disabled = !!why && !on;
          return (
            <button
              key={p.id}
              type="button"
              aria-pressed={on}
              disabled={disabled}
              onClick={() => onToggle(p)}
              className={`flex w-full items-start gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors disabled:cursor-not-allowed ${
                on
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : why
                  ? 'border-slate-200 bg-slate-50 opacity-60'
                  : 'border-emerald-500 bg-emerald-50 ring-1 ring-emerald-500 hover:bg-emerald-100'
              }`}
            >
              <span
                className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                  on ? 'border-white bg-white text-slate-900' : 'border-slate-300 bg-white'
                }`}
              >
                {on && <Check className="h-3 w-3 stroke-[3]" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="text-xs font-extrabold">{p.title}</span>
                  {on && why && <span className="rounded bg-amber-400 px-1.5 py-px text-[10px] font-bold text-amber-950">조건 불일치: {why}</span>}
                  {!on && why && <span className="text-[10px] font-bold text-slate-600">{why}</span>}
                  {!on && !why && <span className="rounded bg-emerald-600 px-1.5 py-px text-[10px] font-bold text-white">적용 가능</span>}
                </span>
                <span className={`mt-0.5 block text-[11px] ${on ? 'text-slate-200' : 'text-slate-600'}`}>
                  {p.paymentMethod} · {p.amountConditionLabel} · {p.startDate}~{p.endDate || '계속'}
                </span>
                {effectText(p).length > 0 && (
                  <span className={`mt-0.5 block text-[11px] font-bold ${on ? 'text-white' : 'text-slate-800'}`}>{effectText(p).join(' · ')}</span>
                )}
                {p.promotionConditionText && (
                  <span className={`mt-1 block whitespace-pre-wrap text-[11px] leading-relaxed ${on ? 'text-slate-200' : 'text-slate-500'}`}>
                    {p.promotionConditionText}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
};
