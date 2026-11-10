import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { Transaction } from '../types';
import { ApprovalStatusBadge, SlipAndSheetBadge } from '../components/StatusBadges';
import { downloadCsvFile, formatKRW, nowFormatted } from '../utils/format';
import {
  Download,
  AlertTriangle,
  CheckCircle2,
  Calendar,
  ShieldAlert,
  ExternalLink,
  FileSpreadsheet,
  Info,
  X,
} from 'lucide-react';

interface ClassifiedSettlementTx {
  tx: Transaction;
  category: 'INCLUDED' | 'MISSING_DATA' | 'EXCLUDED';
  commissionAmount: number;
  appliedCriteriaText: string;
  reasonText: string;
}

interface CmSettlementRow {
  cmId: string;
  cmName: string;
  cmAffiliation: string;
  agName: string;
  totalCount: number;
  includedCount: number;
  excludedOrMissingCount: number;
  includedAmount: number;
  commissionTotal: number;
}

export const SettlementPage: React.FC = () => {
  const {
    currentUser,
    accessibleTransactions,
    getUserById,
    fixTransactionCommissionRate,
    pushToast,
  } = useApp();

  const [targetMonth, setTargetMonth] = useState<'2026-10' | '2026-09'>('2026-10');
  const [cutoffDate, setCutoffDate] = useState<string>('2026-10-31');
  const [activeTab, setActiveTab] = useState<'CM_SUMMARY' | 'INCLUDED_DETAIL' | 'EXCLUDED_DETAIL'>(
    'CM_SUMMARY'
  );

  // n43 Error Guidance Modal when exporting with missing commission calculation data
  const [exportErrorModalOpen, setExportErrorModalOpen] = useState(false);
  const [inlineRates, setInlineRates] = useState<Record<string, string>>({});

  const handleMonthChange = (month: '2026-10' | '2026-09') => {
    setTargetMonth(month);
    setCutoffDate(month === '2026-10' ? '2026-10-31' : '2026-09-30');
  };

  // Deduplicated monthly transactions within user's RBAC scope (Spec 6.1: 동일 거래는 한 번만 반영)
  const classifiedList = useMemo<ClassifiedSettlementTx[]>(() => {
    const seenIds = new Set<string>();
    const monthTxs = accessibleTransactions.filter((tx) => {
      if (seenIds.has(tx.id)) return false;
      seenIds.add(tx.id);
      return tx.createdAt.startsWith(targetMonth);
    });

    return monthTxs.map((tx) => {
      if (tx.status === 'WAITING') {
        return {
          tx,
          category: 'EXCLUDED',
          commissionAmount: 0,
          appliedCriteriaText: '-',
          reasonText: '승인 요청대기 상태 (미검토·미완료 제외)',
        };
      }
      if (tx.status === 'REVIEWING') {
        return {
          tx,
          category: 'EXCLUDED',
          commissionAmount: 0,
          appliedCriteriaText: '-',
          reasonText: 'AG 검토중 / 카드사 심사 진행중 (미확정 제외)',
        };
      }
      if (tx.status === 'REJECTED') {
        return {
          tx,
          category: 'EXCLUDED',
          commissionAmount: 0,
          appliedCriteriaText: '-',
          reasonText: `반려 확정 거래 (${tx.rejectionReason?.slice(0, 32) ?? '사유 기록됨'}...)`,
        };
      }

      // tx.status === 'APPROVED'
      if (!tx.slip) {
        return {
          tx,
          category: 'EXCLUDED',
          commissionAmount: 0,
          appliedCriteriaText: tx.conditionSnapshot.title,
          reasonText: '승인 확정되었으나 매출전표 미제출 (전표 제출 후 정산 반영)',
        };
      }

      const slipDate = tx.slip.submittedAt.slice(0, 10);
      if (cutoffDate && slipDate > cutoffDate) {
        return {
          tx,
          category: 'EXCLUDED',
          commissionAmount: 0,
          appliedCriteriaText: tx.conditionSnapshot.title,
          reasonText: `선택한 집계 기준일(${cutoffDate}) 이후 전표 제출 (${slipDate}) — 익월 이월 대상`,
        };
      }

      // Approved & slip submitted on or before cutoffDate -> Check required commission calculation data!
      if (tx.conditionSnapshot.cmCommissionRate === null) {
        return {
          tx,
          category: 'MISSING_DATA',
          commissionAmount: 0,
          appliedCriteriaText: `${tx.conditionSnapshot.title} (수수료율 미확정)`,
          reasonText:
            '수수료 산정 기준 데이터 누락: 특약 조건의 CM 지급 수수료율(%)이 확정되지 않아 임의 산출이 차단됨 (수정 대상 거래)',
        };
      }

      const baseAmount = tx.slip.approvedAmount || tx.amount;
      const rate = tx.conditionSnapshot.cmCommissionRate;
      const commissionAmount = Math.round((baseAmount * rate) / 100);

      return {
        tx,
        category: 'INCLUDED',
        commissionAmount,
        appliedCriteriaText: `${tx.conditionSnapshot.title} [적용 수수료율 ${rate.toFixed(2)}%]`,
        reasonText:
          tx.sheetSync.status === 'FAILED'
            ? '정산 대상 포함 (※ 구글 시트 입력 실패 건 — 시트 재처리 권장)'
            : '승인·전표 제출 및 수수료 산정 기준 검증 완료 (1회 반영)',
      };
    });
  }, [accessibleTransactions, targetMonth, cutoffDate]);

  const includedItems = classifiedList.filter((i) => i.category === 'INCLUDED');
  const missingDataItems = classifiedList.filter((i) => i.category === 'MISSING_DATA');
  const excludedItems = classifiedList.filter((i) => i.category === 'EXCLUDED');
  const sheetFailedInIncluded = includedItems.filter(
    (i) => i.tx.sheetSync.status === 'FAILED'
  );

  const cmSummaryRows = useMemo<CmSettlementRow[]>(() => {
    const map = new Map<string, CmSettlementRow>();

    classifiedList.forEach((item) => {
      const cm = getUserById(item.tx.cmId);
      const ag = getUserById(item.tx.agId);
      const cmId = item.tx.cmId;
      const existing = map.get(cmId) ?? {
        cmId,
        cmName: cm?.name ?? cmId,
        cmAffiliation: cm?.affiliation ?? '-',
        agName: ag?.name ?? '-',
        totalCount: 0,
        includedCount: 0,
        excludedOrMissingCount: 0,
        includedAmount: 0,
        commissionTotal: 0,
      };

      existing.totalCount += 1;
      if (item.category === 'INCLUDED') {
        existing.includedCount += 1;
        existing.includedAmount += item.tx.slip?.approvedAmount ?? item.tx.amount;
        existing.commissionTotal += item.commissionAmount;
      } else {
        existing.excludedOrMissingCount += 1;
      }

      map.set(cmId, existing);
    });

    return Array.from(map.values()).sort((a, b) => b.commissionTotal - a.commissionTotal);
  }, [classifiedList, getUserById]);

  if (!currentUser) return null;

  if (currentUser.role === 'CM') {
    return (
      <div className="mx-auto max-w-xl rounded-2xl border border-rose-200 bg-white p-8 text-center shadow-sm">
        <ShieldAlert className="mx-auto h-10 w-10 text-rose-500" />
        <h2 className="mt-3 text-lg font-bold text-slate-900">
          AG 및 운영 관리자 전용 정산 메뉴입니다
        </h2>
        <p className="mt-1.5 text-xs text-slate-600">
          월별 CM별 거래내역 및 수수료 정산 집계·파일 추출은 권한이 부여된 담당 AG(담당 CM 범위)와 본사
          운영 관리자(전체 범위)만 접근할 수 있습니다.
        </p>
        <Link
          to="/transactions"
          className="mt-5 inline-flex rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white"
        >
          내 거래 목록으로 이동
        </Link>
      </div>
    );
  }

  const totalIncludedAmount = includedItems.reduce(
    (acc, cur) => acc + (cur.tx.slip?.approvedAmount ?? cur.tx.amount),
    0
  );
  const totalCommissionAmount = includedItems.reduce((acc, cur) => acc + cur.commissionAmount, 0);

  const executeCsvDownload = (allowExcludeMissing: boolean) => {
    const periodStart = `${targetMonth}-01`;
    const exportedAt = nowFormatted();
    const scopeLabel =
      currentUser.role === 'ADMIN' ? '본사 전체 CM' : `${currentUser.name} AG 담당 CM`;

    const rows: string[][] = [
      ['카나다라(KANADARA) 월별 CM 거래내역 및 수수료 정산 집계서'],
      ['기준 월', targetMonth, '집계 기준일(마감일)', cutoffDate],
      ['집계 대상 기간', `${periodStart} ~ ${cutoffDate}`, '추출 범위', scopeLabel],
      [
        '추출자',
        `${currentUser.name} (${currentUser.role})`,
        '추출 일시',
        exportedAt,
      ],
      [
        '중복 집계 검증',
        '거래 ID 기준 1회 반영 검증 완료',
        '정산 확정 상태',
        allowExcludeMissing && missingDataItems.length > 0
          ? `산정누락 ${missingDataItems.length}건 제외 검토본`
          : '최종 산정 검증 완료본',
      ],
      [],
      ['[1] CM별 월간 거래 및 수수료 집계 요약'],
      [
        '담당 CM',
        '소속 대리점/지점',
        '담당 AG',
        '당월 총 요청 건수',
        '정산 반영 건수',
        '집계 제외·보류 건수',
        '정산 반영 거래금액(원)',
        '산출 CM 수수료 총액(원)',
      ],
      ...cmSummaryRows.map((r) => [
        r.cmName,
        r.cmAffiliation,
        r.agName,
        String(r.totalCount),
        String(r.includedCount),
        String(r.excludedOrMissingCount),
        String(r.includedAmount),
        String(r.commissionTotal),
      ]),
      [
        '합계',
        '-',
        '-',
        String(classifiedList.length),
        String(includedItems.length),
        String(excludedItems.length + missingDataItems.length),
        String(totalIncludedAmount),
        String(totalCommissionAmount),
      ],
      [],
      ['[2] 정산 반영 거래별 적용 수수료 산정 기준 상세'],
      [
        '거래번호',
        '담당 CM',
        '담당 AG',
        '고객명',
        '마스킹 식별정보',
        '카드사',
        '거래 방법',
        '카드 승인번호',
        '전표 제출일시',
        '구글 시트 행 ID',
        '결제 금액(원)',
        '적용 수수료 산정 기준',
        '적용 수수료율(%)',
        '산출 수수료(원)',
      ],
      ...includedItems.map(({ tx, commissionAmount, appliedCriteriaText }) => [
        tx.id,
        getUserById(tx.cmId)?.name ?? '-',
        getUserById(tx.agId)?.name ?? '-',
        tx.customerName,
        tx.maskedIdentifier,
        tx.cardCompany,
        tx.paymentMethod,
        tx.slip?.approvalNumber ?? '-',
        tx.slip?.submittedAt ?? '-',
        tx.sheetSync.externalRowId ?? '시트재처리대기',
        String(tx.slip?.approvedAmount ?? tx.amount),
        appliedCriteriaText,
        String(tx.conditionSnapshot.cmCommissionRate ?? 0),
        String(commissionAmount),
      ]),
      [],
      ['[3] 집계 제외 및 산정 누락(보류) 거래 내역과 사유'],
      [
        '거래번호',
        '구분',
        '담당 CM',
        '고객명',
        '카드사',
        '신청 금액(원)',
        '현재 승인 상태',
        '집계 제외 / 누락 사유',
      ],
      ...[...missingDataItems, ...excludedItems].map(({ tx, category, reasonText }) => [
        tx.id,
        category === 'MISSING_DATA' ? '산정데이터 누락(수정대상)' : '집계 제외',
        getUserById(tx.cmId)?.name ?? '-',
        tx.customerName,
        tx.cardCompany,
        String(tx.amount),
        tx.status,
        reasonText,
      ]),
    ];

    const suffix =
      allowExcludeMissing && missingDataItems.length > 0 ? '_검토용(누락제외)' : '_확정본';
    const filename = `카나다라_월별수수료정산_${targetMonth}_기준일${cutoffDate}${suffix}.csv`;
    downloadCsvFile(filename, rows);
    setExportErrorModalOpen(false);
    pushToast({
      type: 'success',
      title: '월별 정산 파일 다운로드 완료',
      description: `${filename} 파일이 생성되어 내려받기가 시작되었습니다.`,
    });
  };

  // n41 -> n42 -> n43 validation before generating settlement file
  const handleDownloadClick = () => {
    if (missingDataItems.length > 0) {
      setExportErrorModalOpen(true);
      return;
    }
    executeCsvDownload(false);
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            월별 거래내역 및 CM 수수료 정산 추출
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            기준 월과 집계 기준일(마감일)을 바탕으로 승인·전표 완료 거래를 중복 없이 집계하고, 적용된
            산정 기준과 제외·누락 사유가 포함된 정산 파일을 추출합니다.
          </p>
        </div>

        <button
          type="button"
          onClick={handleDownloadClick}
          className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700"
        >
          <Download className="h-4 w-4" />
          월별 정산 파일 내려받기 (.CSV / Excel)
        </button>
      </div>

      {/* Criteria Selector Banner (n39) */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
          <div className="flex flex-wrap items-center gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-600">정산 기준 월</label>
              <div className="mt-1.5 flex rounded-xl border border-slate-200 bg-slate-50 p-1">
                {(['2026-10', '2026-09'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => handleMonthChange(m)}
                    className={`rounded-lg px-3.5 py-1.5 text-xs font-bold transition-colors ${
                      targetMonth === m
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {m.replace('-', '년 ')}월
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600">
                마감일 / 집계 기준일 (전표 제출일 기준)
              </label>
              <div className="relative mt-1.5">
                <Calendar className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="date"
                  value={cutoffDate}
                  onChange={(e) => setCutoffDate(e.target.value)}
                  className="rounded-xl border border-slate-300 bg-white py-2 pl-9 pr-3 text-xs font-semibold text-slate-800 focus:border-indigo-500 focus:outline-none"
                />
              </div>
            </div>
          </div>

          <div className="rounded-xl bg-slate-50 px-4 py-3 text-xs text-slate-600">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-slate-800">집계 대상 기간:</span>
              <span className="font-mono font-bold text-indigo-700">
                {targetMonth}-01 ~ {cutoffDate}
              </span>
              <span className="text-slate-300">|</span>
              <span className="inline-flex items-center gap-1 font-medium text-emerald-700">
                <CheckCircle2 className="h-3.5 w-3.5" />
                동일 거래 중복 집계 방지 (1회 반영)
              </span>
            </div>
            <p className="mt-1 text-[11px] text-slate-500">
              조회 범위:{' '}
              {currentUser.role === 'ADMIN'
                ? '본사 운영 관리자 (전체 CM 정산 내역)'
                : `${currentUser.name} AG (배정된 담당 CM 정산 내역만 표시)`}
            </p>
          </div>
        </div>
      </div>

      {/* Warning Banner if Missing Calculation Data or Unsynced Google Sheet Exists (Spec 6.1 & 6.2) */}
      {(missingDataItems.length > 0 || sheetFailedInIncluded.length > 0) && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-5 shadow-sm space-y-3">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <div className="flex-1">
              <h2 className="text-sm font-bold text-amber-950">
                정산 확정 전 확인·수정이 필요한 거래가 있습니다 (누락·오류 방지 안내)
              </h2>
              <p className="mt-0.5 text-xs text-amber-900">
                카나다라 정산 정책은 확정되지 않은 수수료율을 임의로 적용하지 않으며, 누락 원인과 수정 대상
                거래를 즉시 안내합니다.
              </p>
            </div>
          </div>

          <div className="space-y-2">
            {missingDataItems.map(({ tx }) => {
              const cm = getUserById(tx.cmId);
              const rateVal = inlineRates[tx.id] ?? '0.45';
              return (
                <div
                  key={tx.id}
                  className="flex flex-col justify-between gap-3 rounded-xl border border-amber-200 bg-white p-3.5 text-xs sm:flex-row sm:items-center"
                >
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded bg-rose-100 px-2 py-0.5 text-[11px] font-bold text-rose-800">
                        수수료 산정 기준 누락
                      </span>
                      <Link
                        to={`/transactions/${tx.id}`}
                        className="font-mono font-bold text-indigo-700 hover:underline"
                      >
                        {tx.id}
                      </Link>
                      <span className="font-semibold text-slate-800">
                        CM {cm?.name} · 고객 {tx.customerName} · {formatKRW(tx.amount)}
                      </span>
                    </div>
                    <p className="mt-1 text-slate-600">
                      적용 조건: <strong>{tx.conditionSnapshot.title}</strong> — 건별 CM 수수료율(%)이
                      미확정 상태입니다.
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <input
                      type="number"
                      step="0.05"
                      min="0"
                      max="5"
                      value={rateVal}
                      onChange={(e) =>
                        setInlineRates((prev) => ({ ...prev, [tx.id]: e.target.value }))
                      }
                      className="w-20 rounded-lg border border-slate-300 px-2.5 py-1.5 text-right font-bold"
                    />
                    <span className="font-bold text-slate-700">%</span>
                    <button
                      type="button"
                      onClick={() =>
                        fixTransactionCommissionRate(
                          tx.id,
                          Number(rateVal),
                          `${targetMonth} 월별 정산 검증 중 수수료율 확정`
                        )
                      }
                      className="rounded-lg bg-indigo-600 px-3 py-1.5 font-semibold text-white hover:bg-indigo-700"
                    >
                      산정 기준 확정
                    </button>
                  </div>
                </div>
              );
            })}

            {sheetFailedInIncluded.map(({ tx }) => (
              <div
                key={`sheet-${tx.id}`}
                className="flex flex-col justify-between gap-3 rounded-xl border border-amber-200 bg-white p-3.5 text-xs sm:flex-row sm:items-center"
              >
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-900">
                      구글 시트 미동기화 점검
                    </span>
                    <Link
                      to={`/transactions/${tx.id}`}
                      className="font-mono font-bold text-indigo-700 hover:underline"
                    >
                      {tx.id}
                    </Link>
                    <span className="text-slate-700">
                      전표는 제출 완료되어 정산에 반영되었으나, 외부 구글 시트 자동입력이 실패({tx.sheetSync.errorCode}) 상태입니다.
                    </span>
                  </div>
                </div>
                <Link
                  to="/sheets-sync"
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 font-semibold text-amber-900 hover:bg-amber-100"
                >
                  <FileSpreadsheet className="h-3.5 w-3.5" />
                  시트 재처리 화면 이동
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* KPI Aggregation Summary */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium text-slate-500">정산 반영 완료 거래</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900">
            {includedItems.length}건
          </p>
          <p className="mt-1 text-[11px] text-slate-400">
            당월 전체 {classifiedList.length}건 중
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium text-slate-500">정산 반영 거래 총액</p>
          <p className="mt-1 text-xl font-extrabold tabular-nums text-slate-900 sm:text-2xl">
            {formatKRW(totalIncludedAmount)}
          </p>
          <p className="mt-1 text-[11px] text-slate-400">승인 및 전표 제출 완료 기준</p>
        </div>

        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-4 shadow-sm">
          <p className="text-xs font-semibold text-emerald-800">산출 CM 지급 수수료 총액</p>
          <p className="mt-1 text-xl font-extrabold tabular-nums text-emerald-700 sm:text-2xl">
            {formatKRW(totalCommissionAmount)}
          </p>
          <p className="mt-1 text-xs text-emerald-700">대상 CM {cmSummaryRows.length}명 합계</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium text-slate-500">집계 제외 / 산정 누락</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-slate-700">
            {excludedItems.length}건{' '}
            {missingDataItems.length > 0 && (
              <span className="text-base font-bold text-rose-600">
                (+누락 {missingDataItems.length}건)
              </span>
            )}
          </p>
          <p className="mt-1 text-[11px] text-slate-400">모든 건별 제외 사유 추적 가능</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-3">
        <button
          type="button"
          onClick={() => setActiveTab('CM_SUMMARY')}
          className={`rounded-xl px-4 py-2 text-xs font-bold transition-colors ${
            activeTab === 'CM_SUMMARY'
              ? 'bg-indigo-600 text-white'
              : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50'
          }`}
        >
          1. CM별 거래 · 수수료 집계 ({cmSummaryRows.length}명)
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('INCLUDED_DETAIL')}
          className={`rounded-xl px-4 py-2 text-xs font-bold transition-colors ${
            activeTab === 'INCLUDED_DETAIL'
              ? 'bg-indigo-600 text-white'
              : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50'
          }`}
        >
          2. 정산 반영 거래 및 적용 산정 기준 ({includedItems.length}건)
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('EXCLUDED_DETAIL')}
          className={`rounded-xl px-4 py-2 text-xs font-bold transition-colors ${
            activeTab === 'EXCLUDED_DETAIL'
              ? 'bg-indigo-600 text-white'
              : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50'
          }`}
        >
          3. 집계 제외 · 누락 사유 확인 ({excludedItems.length + missingDataItems.length}건)
        </button>
      </div>

      {/* Tab Content 1: CM Summary */}
      {activeTab === 'CM_SUMMARY' && (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
              <thead className="bg-slate-50 text-xs font-semibold text-slate-600">
                <tr>
                  <th className="px-5 py-3.5">담당 CM (소속)</th>
                  <th className="px-4 py-3.5">담당 AG</th>
                  <th className="px-4 py-3.5 text-center">당월 총 요청</th>
                  <th className="px-4 py-3.5 text-center">정산 반영 완료</th>
                  <th className="px-4 py-3.5 text-center">제외 · 보류</th>
                  <th className="px-4 py-3.5 text-right">정산 대상 거래금액</th>
                  <th className="px-5 py-3.5 text-right">산출 CM 지급 수수료</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {cmSummaryRows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-12 text-center text-xs text-slate-500">
                      선택한 기준 월({targetMonth})에 해당하는 거래 데이터가 없습니다.
                    </td>
                  </tr>
                ) : (
                  cmSummaryRows.map((row) => (
                    <tr key={row.cmId} className="hover:bg-slate-50">
                      <td className="px-5 py-3.5">
                        <div className="font-bold text-slate-900">{row.cmName}</div>
                        <div className="text-xs text-slate-500">{row.cmAffiliation}</div>
                      </td>
                      <td className="px-4 py-3.5 text-xs font-medium text-slate-700">
                        {row.agName}
                      </td>
                      <td className="px-4 py-3.5 text-center tabular-nums text-xs text-slate-600">
                        {row.totalCount}건
                      </td>
                      <td className="px-4 py-3.5 text-center tabular-nums">
                        <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-bold text-emerald-700">
                          {row.includedCount}건
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-center tabular-nums text-xs text-slate-500">
                        {row.excludedOrMissingCount}건
                      </td>
                      <td className="px-4 py-3.5 text-right font-bold tabular-nums text-slate-900">
                        {formatKRW(row.includedAmount)}
                      </td>
                      <td className="px-5 py-3.5 text-right font-extrabold tabular-nums text-indigo-700">
                        {formatKRW(row.commissionTotal)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              {cmSummaryRows.length > 0 && (
                <tfoot className="bg-slate-50 font-bold text-slate-900">
                  <tr>
                    <td className="px-5 py-3.5 text-xs">전체 합계</td>
                    <td className="px-4 py-3.5">-</td>
                    <td className="px-4 py-3.5 text-center tabular-nums text-xs">
                      {classifiedList.length}건
                    </td>
                    <td className="px-4 py-3.5 text-center tabular-nums text-xs text-emerald-700">
                      {includedItems.length}건
                    </td>
                    <td className="px-4 py-3.5 text-center tabular-nums text-xs text-slate-600">
                      {excludedItems.length + missingDataItems.length}건
                    </td>
                    <td className="px-4 py-3.5 text-right tabular-nums">
                      {formatKRW(totalIncludedAmount)}
                    </td>
                    <td className="px-5 py-3.5 text-right tabular-nums text-indigo-700">
                      {formatKRW(totalCommissionAmount)}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}

      {/* Tab Content 2: Included Transactions & Applied Commission Rules */}
      {activeTab === 'INCLUDED_DETAIL' && (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
              <thead className="bg-slate-50 font-semibold text-slate-600">
                <tr>
                  <th className="px-4 py-3.5">거래번호 / 전표일시</th>
                  <th className="px-4 py-3.5">담당 CM / 고객</th>
                  <th className="px-4 py-3.5">카드사 · 적용 수수료 산정 기준</th>
                  <th className="px-4 py-3.5">구글 시트 연동</th>
                  <th className="px-4 py-3.5 text-right">전표 결제 금액</th>
                  <th className="px-4 py-3.5 text-right">산출 CM 수수료</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {includedItems.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-slate-500">
                      정산 반영 조건을 충족한 완료 거래가 없습니다.
                    </td>
                  </tr>
                ) : (
                  includedItems.map(({ tx, commissionAmount, appliedCriteriaText }) => (
                    <tr key={tx.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3.5">
                        <Link
                          to={`/transactions/${tx.id}`}
                          className="font-mono font-bold text-indigo-700 hover:underline"
                        >
                          {tx.id}
                        </Link>
                        <div className="mt-0.5 text-slate-500">
                          전표제출: {tx.slip?.submittedAt}
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="font-bold text-slate-900">
                          CM {getUserById(tx.cmId)?.name}
                        </div>
                        <div className="text-slate-500">
                          고객 {tx.customerName} ({tx.maskedIdentifier})
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="font-semibold text-slate-900">
                          {tx.cardCompany} · {tx.paymentMethod}
                        </div>
                        <div className="mt-0.5 text-indigo-700 font-medium">
                          {appliedCriteriaText}
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        <SlipAndSheetBadge tx={tx} />
                      </td>
                      <td className="px-4 py-3.5 text-right font-bold tabular-nums text-slate-900">
                        {formatKRW(tx.slip?.approvedAmount ?? tx.amount)}
                      </td>
                      <td className="px-4 py-3.5 text-right font-extrabold tabular-nums text-indigo-700">
                        {formatKRW(commissionAmount)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab Content 3: Excluded & Missing Data Transactions + Reasons */}
      {activeTab === 'EXCLUDED_DETAIL' && (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
              <thead className="bg-slate-50 font-semibold text-slate-600">
                <tr>
                  <th className="px-4 py-3.5">구분</th>
                  <th className="px-4 py-3.5">거래번호 / 현재 상태</th>
                  <th className="px-4 py-3.5">담당 CM / 고객</th>
                  <th className="px-4 py-3.5 text-right">신청 금액</th>
                  <th className="px-4 py-3.5">집계 제외 및 산정 누락 상세 사유</th>
                  <th className="px-4 py-3.5 text-right">거래 확인</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {[...missingDataItems, ...excludedItems].length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-slate-500">
                      해당 월에 제외되거나 산정 누락된 거래가 없습니다.
                    </td>
                  </tr>
                ) : (
                  [...missingDataItems, ...excludedItems].map(({ tx, category, reasonText }) => (
                    <tr
                      key={tx.id}
                      className={category === 'MISSING_DATA' ? 'bg-rose-50/40' : 'hover:bg-slate-50'}
                    >
                      <td className="px-4 py-3.5">
                        {category === 'MISSING_DATA' ? (
                          <span className="rounded bg-rose-100 px-2 py-0.5 text-[11px] font-bold text-rose-800">
                            산정데이터 누락
                          </span>
                        ) : (
                          <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                            집계 제외
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="font-mono font-bold text-slate-900">{tx.id}</div>
                        <div className="mt-1">
                          <ApprovalStatusBadge status={tx.status} />
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="font-semibold text-slate-900">
                          CM {getUserById(tx.cmId)?.name}
                        </div>
                        <div className="text-slate-500">{tx.customerName}</div>
                      </td>
                      <td className="px-4 py-3.5 text-right font-bold tabular-nums text-slate-800">
                        {formatKRW(tx.amount)}
                      </td>
                      <td className="px-4 py-3.5 max-w-md leading-relaxed text-slate-700">
                        {reasonText}
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        <Link
                          to={`/transactions/${tx.id}`}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-semibold text-indigo-600 hover:bg-indigo-50"
                        >
                          상세 열기
                          <ExternalLink className="h-3 w-3" />
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* User Flow Node n43: 정산 파일 오류 안내 Modal */}
      {exportErrorModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-rose-100 text-rose-600">
                  <AlertTriangle className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    정산 파일 생성 사전 검증 오류 안내
                  </h3>
                  <p className="text-xs text-slate-500">
                    수수료 산정에 필요한 필수 데이터가 누락된 완료 거래가 {missingDataItems.length}건
                    존재합니다.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setExportErrorModalOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-4 space-y-2.5 rounded-xl border border-rose-200 bg-rose-50/60 p-4 text-xs">
              {missingDataItems.map(({ tx }) => (
                <div key={tx.id} className="space-y-2">
                  <p className="font-bold text-rose-900">
                    수정 대상 거래: <span className="font-mono">{tx.id}</span> (담당 CM:{' '}
                    {getUserById(tx.cmId)?.name} · {formatKRW(tx.amount)})
                  </p>
                  <p className="text-rose-800">
                    오류 원인: [{tx.conditionSnapshot.title}] 조건의 CM 지급 수수료율이 미확정(null)
                    상태입니다. 수수료율을 확정하면 최종 정산 파일을 즉시 생성할 수 있습니다.
                  </p>
                  <div className="flex items-center gap-2 pt-1">
                    <input
                      type="number"
                      step="0.05"
                      min="0"
                      max="5"
                      value={inlineRates[tx.id] ?? '0.45'}
                      onChange={(e) =>
                        setInlineRates((prev) => ({ ...prev, [tx.id]: e.target.value }))
                      }
                      className="w-24 rounded-lg border border-rose-300 bg-white px-2.5 py-1.5 text-right font-bold"
                    />
                    <span className="font-bold text-rose-900">% 로</span>
                    <button
                      type="button"
                      onClick={() => {
                        fixTransactionCommissionRate(
                          tx.id,
                          Number(inlineRates[tx.id] ?? '0.45'),
                          '정산 파일 추출 전 수수료율 확정'
                        );
                      }}
                      className="rounded-lg bg-indigo-600 px-3 py-1.5 font-semibold text-white hover:bg-indigo-700"
                    >
                      지금 확정하기
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 flex items-start gap-2 rounded-xl bg-slate-50 p-3 text-[11px] text-slate-600">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
              <span>
                위에서 수수료율을 확정하면 누락 건수가 0건이 되어 확정본을 내려받을 수 있으며, 누락 건을
                보류(제외 사유 명시)한 검토용 파일도 먼저 내려받을 수 있습니다.
              </span>
            </div>

            <div className="mt-5 flex flex-wrap justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setExportErrorModalOpen(false)}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                닫기
              </button>
              <button
                type="button"
                onClick={() => executeCsvDownload(true)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800"
              >
                <Download className="h-3.5 w-3.5" />
                누락 건 제외 사유 명시하여 검토본 내려받기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
