import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import {
  APPROVAL_STATUS_META,
  SETTLEMENT_PROGRESS_STATUS_META,
  SettlementFlags,
  StatusPatch,
  Transaction,
  V2_PROGRESS_STATUS_LIST,
  applyStatusPatch,
  normalizeV2ProgressStatus,
  settlementFlagsOf,
} from '../../types';
import { Check, RotateCcw } from 'lucide-react';

type PendingChange = {
  ids: string[];
  patch: StatusPatch;
  lines: { label: string; count: number }[]; // '요청 대기 > 카드 승인' 같은 변경 내용과 건수
  needsReason: boolean;
};

const segBtn = (pressed: boolean) =>
  `inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-bold transition-colors disabled:cursor-not-allowed ${
    pressed
      ? 'bg-slate-900 text-white shadow-2xs disabled:bg-slate-500'
      : 'text-slate-700 enabled:hover:bg-white enabled:hover:text-slate-900 enabled:hover:shadow-2xs disabled:text-slate-400'
  }`;

/**
 * 진행상황·정산상황 변경 (대시보드·월별정산 공용).
 * 변경은 항상 확인 팝업을 거치고, 되돌리기가 섞이면 사유를 받음 (AG는 관리자 승인 요청).
 * 정산상황은 관리자만 변경 가능.
 */
export function useStatusChange() {
  const { currentUser, transactions, bulkUpdateTransactionsV2 } = useApp();
  const isAdmin = currentUser?.role === 'ADMIN';
  const [pending, setPending] = useState<PendingChange | null>(null);
  const [reasonText, setReasonText] = useState('');

  const requestChange = (ids: string[], patch: StatusPatch) => {
    const counts = new Map<string, number>();
    let needsReason = false;
    transactions
      .filter((t) => ids.includes(t.id))
      .forEach((t) => {
        const r = applyStatusPatch(t, patch);
        if (!r.changed) return;
        if (r.isRollback) needsReason = true;
        const parts: string[] = [];
        const prevP = APPROVAL_STATUS_META[normalizeV2ProgressStatus(t.status)].label;
        const nextP = APPROVAL_STATUS_META[normalizeV2ProgressStatus(r.status)].label;
        if (prevP !== nextP) parts.push(`${prevP} > ${nextP}`);
        const prevS = t.settlementStatus || '정산 대기';
        if (prevS !== r.settlementStatus) parts.push(`${prevS} > ${r.settlementStatus}`);
        const label = parts.join(' · ');
        counts.set(label, (counts.get(label) || 0) + 1);
      });
    if (counts.size === 0) {
      bulkUpdateTransactionsV2(ids, patch); // '이미 같은 상태' 안내
      return;
    }
    setReasonText('');
    setPending({ ids, patch, lines: [...counts].map(([label, count]) => ({ label, count })), needsReason });
  };

  const confirmChange = () => {
    if (!pending || (pending.needsReason && !reasonText.trim())) return;
    const res = bulkUpdateTransactionsV2(pending.ids, pending.patch, reasonText);
    if (res.ok) setPending(null);
  };

  // 진행상황 버튼 3개 + 정산 버튼 3개 (정산 완료·지급 완료는 각각 켜고 끄는 토글)
  const statusControls = (ids: string[], txs: Transaction[]) => {
    const progressOf = (st: string) => txs.length > 0 && txs.every((t) => normalizeV2ProgressStatus(t.status) === st);
    const has = (flag: keyof SettlementFlags) =>
      txs.length > 0 && txs.every((t) => settlementFlagsOf(t.settlementStatus)[flag]);
    const allPending =
      txs.length > 0 &&
      txs.every((t) => {
        const f = settlementFlagsOf(t.settlementStatus);
        return !f.settled && !f.paid;
      });
    return (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex flex-col items-start gap-1 sm:flex-row sm:items-center sm:gap-2">
          <span className="whitespace-nowrap text-[11px] font-extrabold text-slate-500">진행상황</span>
          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-0.5">
            {V2_PROGRESS_STATUS_LIST.map((st) => (
              <button
                key={st}
                type="button"
                aria-pressed={progressOf(st)}
                onClick={() => requestChange(ids, { status: st })}
                className={segBtn(progressOf(st))}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${APPROVAL_STATUS_META[st].dotClass}`} />
                {APPROVAL_STATUS_META[st].label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-col items-start gap-1 sm:flex-row sm:items-center sm:gap-2">
          <span className="whitespace-nowrap text-[11px] font-extrabold text-slate-500">정산상황</span>
          <div
            className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-0.5"
            title={isAdmin ? undefined : '정산상황은 관리자만 변경할 수 있습니다'}
          >
            <button
              type="button"
              disabled={!isAdmin}
              aria-pressed={allPending}
              onClick={() => requestChange(ids, { settlement: { settled: false, paid: false } })}
              className={segBtn(allPending)}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${SETTLEMENT_PROGRESS_STATUS_META['정산 대기'].dotClass}`} />
              정산 대기
            </button>
            {(['settled', 'paid'] as const).map((flag) => (
              <button
                key={flag}
                type="button"
                disabled={!isAdmin}
                aria-pressed={has(flag)}
                title={isAdmin ? '정산 완료와 지급 완료는 함께 선택할 수 있습니다' : undefined}
                onClick={() => requestChange(ids, { settlement: { [flag]: !has(flag) } })}
                className={segBtn(has(flag))}
              >
                {has(flag) ? (
                  <Check className="h-3 w-3 stroke-[3]" />
                ) : (
                  <span className={`h-1.5 w-1.5 rounded-full ${flag === 'settled' ? 'bg-sky-500' : 'bg-emerald-500'}`} />
                )}
                {flag === 'settled' ? '정산 완료' : '지급 완료(CM)'}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  };

  // 상태 변경 확인 팝업 (되돌리기면 사유 입력 포함)
  const statusDialog = pending && (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-4" onClick={() => setPending(null)}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="상태 변경 확인"
        className="w-full max-w-md space-y-4 rounded-2xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2">
          {pending.needsReason && <RotateCcw className="h-4 w-4 text-amber-600" />}
          <h3 className="text-sm font-extrabold text-slate-900">
            {pending.needsReason ? '이전 단계로 되돌리기' : '상태 변경 확인'}
          </h3>
        </div>
        {pending.lines.length === 1 && pending.ids.length === 1 ? (
          <p className="text-sm text-slate-800">
            <strong className="font-extrabold text-slate-900">{pending.lines[0].label}</strong>(으)로 변경하시겠습니까?
          </p>
        ) : (
          <>
            <ul className="space-y-1.5">
              {pending.lines.map((l) => (
                <li key={l.label} className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2 text-sm">
                  <strong className="font-extrabold text-slate-900">{l.label}</strong>
                  <span className="shrink-0 text-xs font-bold tabular-nums text-slate-500">{l.count}건</span>
                </li>
              ))}
            </ul>
            <p className="text-sm text-slate-800">{pending.lines.reduce((n, l) => n + l.count, 0)}건을 위와 같이 변경하시겠습니까?</p>
          </>
        )}
        {pending.needsReason && (
          <div className="space-y-1.5">
            <label htmlFor="rollback-reason" className="block text-xs text-slate-600">
              {isAdmin
                ? '되돌리는 사유를 적어 주세요. 거래 이력에 남습니다.'
                : '되돌리기는 관리자 승인 후 반영됩니다. 승인 요청과 함께 보낼 사유를 적어 주세요.'}
            </label>
            <textarea
              id="rollback-reason"
              autoFocus
              lang="ko"
              value={reasonText}
              onChange={(e) => setReasonText(e.target.value)}
              rows={3}
              placeholder="예: 카드사 승인 취소 통보"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:border-slate-900 focus:outline-none"
            />
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setPending(null)}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100"
          >
            취소
          </button>
          <button
            type="button"
            autoFocus={!pending.needsReason}
            disabled={pending.needsReason && !reasonText.trim()}
            onClick={confirmChange}
            className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800 disabled:opacity-40"
          >
            {pending.needsReason && !isAdmin ? '승인 요청 보내기' : '변경'}
          </button>
        </div>
      </div>
    </div>
  );

  return { requestChange, statusControls, statusDialog };
}
