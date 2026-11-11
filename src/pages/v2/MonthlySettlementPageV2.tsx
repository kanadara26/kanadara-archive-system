import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import {
  APPROVAL_STATUS_META,
  CARD_COMPANY_COLORS,
  SETTLEMENT_PROGRESS_STATUS_META,
  SPLIT_CARD_COMPANIES,
  SplitCardCompany,
  Transaction,
  V2_CARD_DISPLAY_NAMES,
  V2_CARD_LOGO_URLS,
  V2PaymentMethodType,
  normalizeV2ProgressStatus,
} from '../../types';
import { calcSplitTotals, formatKRW } from '../../utils/format';
import {
  AlertTriangle,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Download,
  Edit3,
  RotateCcw,
  Search,
  Trash2,
  X,
} from 'lucide-react';

function getMonthDateRange(year: number, month: number): { start: string; end: string } {
  const mm = String(month).padStart(2, '0');
  const lastDay = new Date(year, month, 0).getDate();
  const dd = String(lastDay).padStart(2, '0');
  return {
    start: `${year}-${mm}-01`,
    end: `${year}-${mm}-${dd}`,
  };
}

function getTxMethodTypeV2(tx: Transaction): V2PaymentMethodType {
  if (tx.paymentSplits.length > 1) return '혼합';
  const first = tx.paymentSplits[0];
  if (!first) return '일시불';
  if (first.paymentMethod === '다이렉트할부') return '다이렉트';
  if (first.paymentMethod === '할부') return '할부';
  return '일시불';
}

function getTxPaymentDetailSummary(tx: Transaction): string {
  const methodType = getTxMethodTypeV2(tx);
  const first = tx.paymentSplits[0];
  if (!first) return methodType;

  const firstCat =
    first.rateCategory && first.rateCategory !== '일반'
      ? ` [${first.rateCategory}]`
      : '';

  if (methodType === '혼합') {
    return `혼합 (${tx.paymentSplits
      .map(
        (s) =>
          `${s.paymentMethod === '다이렉트할부' ? '다이렉트' : s.paymentMethod}${
            s.rateCategory && s.rateCategory !== '일반' ? `[${s.rateCategory}]` : ''
          } ${Math.round(s.amount / 10000).toLocaleString()}만`
      )
      .join(' + ')})`;
  }
  if (methodType === '일시불') {
    return `일시불${firstCat} · 캐시백 ${first.cashbackRate}%`;
  }
  return `${methodType}${firstCat} ${first.installmentMonths}개월 · 금리 ${first.interestRate}%`;
}

// 엑셀에서 =, +, -, @로 시작하는 글자를 수식으로 실행하지 않도록 앞에 ' 를 붙임
function csvCell(v: string | number): string {
  if (typeof v === 'number') return String(v);
  const text = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// ponytail: 엑셀 전용 라이브러리 없이 CSV(UTF-8 BOM) — 엑셀에서 한글 그대로 열림. 서식·여러 시트가 필요해지면 xlsx 도입
function downloadCsv(fileName: string, rows: (string | number)[][]) {
  const body = '\uFEFF' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([body], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000); // 일부 브라우저는 클릭 직후 해제하면 다운로드 실패
}

export const MonthlySettlementPageV2: React.FC = () => {
  const {
    transactions,
    users,
    setEditingTxIdV2,
    deleteTransaction,
  } = useApp();
  const navigate = useNavigate();

  // 반려 건을 제외한 승인/진행 거래 목록 (최신순)
  const validTransactions = useMemo(
    () => transactions.filter((t) => t.status !== 'REJECTED'),
    [transactions]
  );

  // 초기 기본 연/월: 가장 최근 거래가 있는 연/월 (기본 2026년 10월)
  const initialYearMonth = useMemo(() => {
    if (validTransactions.length > 0) {
      const sorted = [...validTransactions].sort((a, b) =>
        (b.approvalDate || b.requestDate).localeCompare(a.approvalDate || a.requestDate)
      );
      const latestDate = sorted[0].approvalDate || sorted[0].requestDate;
      const [y, m] = latestDate.split('-').map(Number);
      if (y && m) return { year: y, month: m };
    }
    return { year: 2026, month: 10 };
  }, [validTransactions]);

  const [selectedYear, setSelectedYear] = useState<number>(initialYearMonth.year);
  const [selectedMonth, setSelectedMonth] = useState<number>(initialYearMonth.month);
  const [isCustomRange, setIsCustomRange] = useState<boolean>(false);

  const initialRange = useMemo(
    () => getMonthDateRange(initialYearMonth.year, initialYearMonth.month),
    [initialYearMonth]
  );
  const [startDate, setStartDate] = useState<string>(initialRange.start);
  const [endDate, setEndDate] = useState<string>(initialRange.end);
  const [dateBasis, setDateBasis] = useState<'APPROVAL' | 'REQUEST'>('APPROVAL');

  // 필터 상태 (카드사, 담당CM, 거래정보[결제방법], 키워드 검색)
  const [cardFilter, setCardFilter] = useState<SplitCardCompany | 'ALL'>('ALL');
  const [cmFilter, setCmFilter] = useState<string>('ALL');
  const [methodFilter, setMethodFilter] = useState<V2PaymentMethodType | 'ALL'>('ALL');
  const [searchKeyword, setSearchKeyword] = useState<string>('');

  // 상세 보기 모달용 선택 거래
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const cmUsers = useMemo(
    () => users.filter((u) => u.role === 'CM'),
    [users]
  );

  // 정산(원천징수)에 필요한 CM 주민번호·사업자번호: 현재 계정 정보 우선, 없으면 거래 당시 저장값
  const getCmIds = (tx: Transaction) => {
    const cm = users.find((u) => u.id === tx.cmId);
    return {
      rrn: cm?.rrn || tx.cmProfile.rrn || '',
      businessNumber: cm?.businessNumber || tx.cmProfile.businessNumber || '',
      phone: cm?.phone || tx.cmProfile.phone || '',
    };
  };
  const isCmInfoMissing = (tx: Transaction) => {
    const ids = getCmIds(tx);
    return !ids.rrn && !ids.businessNumber;
  };

  // 월별 거래 건수 요약 (빠른 월 이동용)
  const availableMonths = useMemo(() => {
    const map = new Map<string, number>();
    validTransactions.forEach((tx) => {
      const targetDate =
        dateBasis === 'APPROVAL'
          ? tx.approvalDate || tx.requestDate
          : tx.requestDate;
      const ym = (targetDate || '').slice(0, 7);
      if (ym) {
        map.set(ym, (map.get(ym) || 0) + 1);
      }
    });
    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([ym, count]) => {
        const [y, m] = ym.split('-').map(Number);
        return { ym, year: y, month: m, count };
      });
  }, [validTransactions, dateBasis]);

  // 좌우 화살표로 월 이동
  const handleStepMonth = (delta: number) => {
    let nextMonth = selectedMonth + delta;
    let nextYear = selectedYear;
    if (nextMonth < 1) {
      nextMonth = 12;
      nextYear -= 1;
    } else if (nextMonth > 12) {
      nextMonth = 1;
      nextYear += 1;
    }
    setSelectedYear(nextYear);
    setSelectedMonth(nextMonth);
    setIsCustomRange(false);
    const range = getMonthDateRange(nextYear, nextMonth);
    setStartDate(range.start);
    setEndDate(range.end);
  };

  const handleSelectYearMonth = (year: number, month: number) => {
    setSelectedYear(year);
    setSelectedMonth(month);
    setIsCustomRange(false);
    const range = getMonthDateRange(year, month);
    setStartDate(range.start);
    setEndDate(range.end);
  };

  // 조건에 따른 거래 필터링
  const filteredTransactions = useMemo(() => {
    const kw = searchKeyword.trim().toLowerCase();

    return validTransactions
      .filter((tx) => {
        const refDate =
          dateBasis === 'APPROVAL'
            ? tx.approvalDate || tx.requestDate
            : tx.requestDate;
        if (startDate && refDate < startDate) return false;
        if (endDate && refDate > endDate) return false;

        const txCard = tx.paymentSplits[0]?.cardCompany || '제휴카드사(삼성)';
        if (cardFilter !== 'ALL' && txCard !== cardFilter) return false;

        if (cmFilter !== 'ALL' && tx.cmId !== cmFilter) return false;

        const txMethodType = getTxMethodTypeV2(tx);
        if (methodFilter !== 'ALL' && txMethodType !== methodFilter) return false;

        if (kw) {
          const cardDisplayName = V2_CARD_DISPLAY_NAMES[txCard];
          const detailSummary = getTxPaymentDetailSummary(tx);
          const haystack = [
            tx.id,
            tx.customerName,
            tx.cmProfile.name,
            tx.cmProfile.affiliation,
            cardDisplayName,
            detailSummary,
            tx.requestMemo || '',
            tx.settlementStatus || '정산 대기',
          ]
            .join(' ')
            .toLowerCase();
          if (!haystack.includes(kw)) return false;
        }

        return true;
      })
      .sort((a, b) => {
        const dateA =
          dateBasis === 'APPROVAL'
            ? a.approvalDate || a.requestDate
            : a.requestDate;
        const dateB =
          dateBasis === 'APPROVAL'
            ? b.approvalDate || b.requestDate
            : b.requestDate;
        return dateB.localeCompare(dateA) || b.id.localeCompare(a.id);
      });
  }, [
    validTransactions,
    dateBasis,
    startDate,
    endDate,
    cardFilter,
    cmFilter,
    methodFilter,
    searchKeyword,
  ]);

  // 정산 요약 집계 (거래선 수, 거래 총액, CM 수수료 총액, AG 수수료 총액)
  const summary = useMemo(() => {
    const uniqueCmIds = new Set<string>();
    let totalAmount = 0;
    let totalCmCommission = 0;
    let totalAgCommission = 0;

    filteredTransactions.forEach((tx) => {
      uniqueCmIds.add(tx.cmId);
      const calc = calcSplitTotals(tx.paymentSplits, tx.appliedPromotions);
      totalAmount += calc.totalAmount;
      totalCmCommission += calc.totalCmCommission;
      totalAgCommission += calc.totalAgCommission;
    });

    return {
      txCount: filteredTransactions.length,
      partnerCount: uniqueCmIds.size,
      totalAmount,
      totalCmCommission,
      totalAgCommission,
    };
  }, [filteredTransactions]);

  const missingCmTxCount = filteredTransactions.filter(isCmInfoMissing).length;

  const handleDownloadCsv = () => {
    const header = [
      '거래번호', '승인일', '작성일', '고객명', '진행상황', '정산상태', '담당CM', 'CM소속',
      'CM주민번호', 'CM사업자번호', 'CM연락처', '카드사', '결제정보', '거래금액',
      'CM수수료', 'CM요율(%)', 'AG수수료', 'AG요율(%)', '비고',
    ];
    const rows = filteredTransactions.map((tx) => {
      const calc = calcSplitTotals(tx.paymentSplits, tx.appliedPromotions);
      const ids = getCmIds(tx);
      const card = tx.paymentSplits[0]?.cardCompany || '제휴카드사(삼성)';
      return [
        tx.id, tx.approvalDate || '', tx.requestDate, tx.customerName,
        APPROVAL_STATUS_META[normalizeV2ProgressStatus(tx.status)]?.label || tx.status,
        tx.settlementStatus || '정산 대기', tx.cmProfile.name, tx.cmProfile.affiliation,
        ids.rrn, ids.businessNumber, ids.phone, V2_CARD_DISPLAY_NAMES[card],
        getTxPaymentDetailSummary(tx), calc.totalAmount, calc.totalCmCommission,
        calc.effectiveCmRate, calc.totalAgCommission, calc.effectiveAgRate, tx.requestMemo || '',
      ];
    });
    rows.push([
      '합계', '', '', `${summary.txCount}건`, '', '', `거래선 ${summary.partnerCount}곳`, '', '', '', '', '', '',
      summary.totalAmount, summary.totalCmCommission, '', summary.totalAgCommission, '', '',
    ]);
    const label = isCustomRange ? `${startDate}~${endDate}` : `${selectedYear}-${String(selectedMonth).padStart(2, '0')}`;
    downloadCsv(`카나다라_정산_${label}.csv`, [header, ...rows]);
  };

  const handleResetFilters = () => {
    setCardFilter('ALL');
    setCmFilter('ALL');
    setMethodFilter('ALL');
    setSearchKeyword('');
  };

  const hasActiveFilters =
    cardFilter !== 'ALL' ||
    cmFilter !== 'ALL' ||
    methodFilter !== 'ALL' ||
    searchKeyword.trim() !== '';

  return (
    <div className="space-y-4">
      {/* 1. 상단 월 단위 정산 네비게이터 & 기간/기준일 설정 */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 shadow-2xs space-y-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          {/* 좌우 화살표 월 선택 뷰 ( <  10월  > ) */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex items-center rounded-xl border border-slate-200 bg-slate-50 p-1">
              <button
                type="button"
                onClick={() => handleStepMonth(-1)}
                aria-label="이전 달"
                className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 hover:bg-white hover:text-slate-900 hover:shadow-2xs transition-all"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <div className="min-w-[120px] px-4 text-center">
                <span className="block text-[10px] font-bold text-slate-400 tabular-nums">
                  {selectedYear}년
                </span>
                <span className="text-lg font-black tracking-tight text-slate-900 tabular-nums">
                  {selectedMonth}월
                </span>
              </div>
              <button
                type="button"
                onClick={() => handleStepMonth(1)}
                aria-label="다음 달"
                className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 hover:bg-white hover:text-slate-900 hover:shadow-2xs transition-all"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>

            {/* 데이터가 있는 월 빠른 이동 칩 */}
            {availableMonths.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                {availableMonths.map((item) => {
                  const isActive =
                    !isCustomRange &&
                    selectedYear === item.year &&
                    selectedMonth === item.month;
                  return (
                    <button
                      key={item.ym}
                      type="button"
                      onClick={() => handleSelectYearMonth(item.year, item.month)}
                      className={`rounded-lg px-2.5 py-1.5 text-xs font-bold border transition-colors tabular-nums ${
                        isActive
                          ? 'border-slate-900 bg-slate-900 text-white'
                          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {item.month}월 ({item.count})
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* 우측: 조회 기준일 선택 & 별도 시작일~마감일 지정 */}
          <div className="flex flex-wrap items-center gap-2">
            {/* 조회 기준일 설정 */}
            <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-0.5 text-xs font-bold">
              <button
                type="button"
                onClick={() => setDateBasis('APPROVAL')}
                className={`rounded-md px-2.5 py-1.5 transition-colors ${
                  dateBasis === 'APPROVAL'
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                승인일 기준
              </button>
              <button
                type="button"
                onClick={() => setDateBasis('REQUEST')}
                className={`rounded-md px-2.5 py-1.5 transition-colors ${
                  dateBasis === 'REQUEST'
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                작성일 기준
              </button>
            </div>

            {/* 시작일 ~ 마감일 직접 선택 */}
            <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs">
              <Calendar className="h-3.5 w-3.5 text-slate-500 shrink-0" />
              <input
                type="date"
                aria-label="조회 시작일"
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  setIsCustomRange(true);
                }}
                className="bg-transparent font-bold text-slate-800 focus:outline-none"
              />
              <span className="text-slate-400">~</span>
              <input
                type="date"
                aria-label="조회 마감일"
                value={endDate}
                onChange={(e) => {
                  setEndDate(e.target.value);
                  setIsCustomRange(true);
                }}
                className="bg-transparent font-bold text-slate-800 focus:outline-none"
              />
            </div>
          </div>
        </div>

        {/* 2. 핵심 정산 지표 4개 (거래선, 거래 총액, CM 수수료 총액, AG 수수료 총액) */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 pt-2 border-t border-slate-100">
          <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3.5">
            <span className="text-xs font-semibold text-slate-500 block">
              거래선 · 거래 건수
            </span>
            <p className="mt-1 text-lg sm:text-xl font-black text-slate-900 tabular-nums">
              {summary.partnerCount}곳{' '}
              <span className="text-sm font-bold text-slate-500">
                / 총 {summary.txCount}건
              </span>
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3.5">
            <span className="text-xs font-semibold text-slate-500 block">거래 총액</span>
            <p className="mt-1 text-lg sm:text-xl font-black text-slate-900 tabular-nums">
              {formatKRW(summary.totalAmount)}
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3.5">
            <span className="text-xs font-semibold text-slate-500 block">
              CM 수수료 총액
            </span>
            <p className="mt-1 text-lg sm:text-xl font-black text-slate-900 tabular-nums">
              {formatKRW(summary.totalCmCommission)}
            </p>
          </div>

          <div className="rounded-xl border border-slate-900 bg-slate-900 text-white p-3.5">
            <span className="text-xs font-semibold text-slate-300 block">
              AG 수수료 총액
            </span>
            <p className="mt-1 text-lg sm:text-xl font-black text-white tabular-nums">
              {formatKRW(summary.totalAgCommission)}
            </p>
          </div>
        </div>
      </div>

      {/* 3. 필터링 (카드사, 담당CM, 거래정보) & 키워드 검색 바 */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-2.5">
          {/* 키워드 검색 */}
          <div className="lg:col-span-4 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={searchKeyword}
              onChange={(e) => setSearchKeyword(e.target.value)}
              placeholder="고객명, 거래번호, 담당CM, 비고 검색..."
              className="w-full rounded-lg border border-slate-300 bg-white pl-9 pr-8 py-2 text-xs font-semibold text-slate-900 focus:border-slate-900 focus:outline-none"
            />
            {searchKeyword && (
              <button
                type="button"
                onClick={() => setSearchKeyword('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* 카드사별 필터 */}
          <div className="lg:col-span-3">
            <select
              aria-label="카드사 필터"
              value={cardFilter}
              onChange={(e) =>
                setCardFilter(e.target.value as SplitCardCompany | 'ALL')
              }
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-800 focus:border-slate-900 focus:outline-none"
            >
              <option value="ALL">카드사: 전체</option>
              {SPLIT_CARD_COMPANIES.map((card) => (
                <option key={card} value={card}>
                  카드사: {V2_CARD_DISPLAY_NAMES[card]}
                </option>
              ))}
            </select>
          </div>

          {/* 담당 CM별 필터 */}
          <div className="lg:col-span-3">
            <select
              aria-label="담당 CM 필터"
              value={cmFilter}
              onChange={(e) => setCmFilter(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-800 focus:border-slate-900 focus:outline-none"
            >
              <option value="ALL">담당 CM: 전체</option>
              {cmUsers.map((cm) => (
                <option key={cm.id} value={cm.id}>
                  담당 CM: {cm.name} ({cm.affiliation})
                </option>
              ))}
            </select>
          </div>

          {/* 거래정보(결제방법)별 필터 */}
          <div className="lg:col-span-2 flex gap-1.5">
            <select
              aria-label="거래정보 결제방법 필터"
              value={methodFilter}
              onChange={(e) =>
                setMethodFilter(e.target.value as V2PaymentMethodType | 'ALL')
              }
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-800 focus:border-slate-900 focus:outline-none"
            >
              <option value="ALL">결제방법: 전체</option>
              <option value="일시불">일시불</option>
              <option value="혼합">혼합</option>
              <option value="다이렉트">다이렉트</option>
              <option value="할부">할부</option>
            </select>

            {hasActiveFilters && (
              <button
                type="button"
                onClick={handleResetFilters}
                title="필터 초기화"
                className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-slate-100 px-2.5 text-slate-600 hover:bg-slate-200 shrink-0"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 4. 거래 내역 표 (PC 테이블 & 모바일 카드형 반응형) */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-2xs">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
          {missingCmTxCount > 0 ? (
            <p className="inline-flex items-center gap-1.5 text-xs font-bold text-rose-700">
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
              CM 주민번호·사업자번호가 없는 거래 {missingCmTxCount}건 — 설정에서 CM 정보를 입력해 주세요.
            </p>
          ) : (
            <span className="text-xs font-semibold text-slate-500">조회된 거래 {summary.txCount}건</span>
          )}
          <button
            type="button"
            onClick={handleDownloadCsv}
            disabled={filteredTransactions.length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-800 hover:bg-slate-50 disabled:opacity-40"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            엑셀 다운로드
          </button>
        </div>
        {filteredTransactions.length === 0 ? (
          <div className="py-16 text-center space-y-2">
            <p className="text-sm font-bold text-slate-600">
              해당 기간 및 필터 조건에 일치하는 거래 내역이 없습니다.
            </p>
            <p className="text-xs text-slate-400">
              상단 화살표(&lt; 월 &gt;)로 조회 월을 변경하거나 검색 조건을 초기화해 보세요.
            </p>
          </div>
        ) : (
          <>
            {/* PC 테이블 뷰 */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 font-bold">
                    <th className="py-3 px-4">거래번호</th>
                    <th className="py-3 px-4">고객명</th>
                    <th className="py-3 px-4">담당CM</th>
                    <th className="py-3 px-4">거래정보 (카드사 · 결제정보)</th>
                    <th className="py-3 px-4 text-right">거래 금액</th>
                    <th className="py-3 px-4 text-right">CM 수수료</th>
                    <th className="py-3 px-4 text-right">AG 수수료</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredTransactions.map((tx) => {
                    const calc = calcSplitTotals(tx.paymentSplits, tx.appliedPromotions);
                    const cardKey = tx.paymentSplits[0]?.cardCompany || '제휴카드사(삼성)';
                    const cardColor = CARD_COMPANY_COLORS[cardKey];
                    const cardDisplayName = V2_CARD_DISPLAY_NAMES[cardKey];
                    const cardLogoUrl = V2_CARD_LOGO_URLS[cardKey];
                    const paymentSummary = getTxPaymentDetailSummary(tx);
                    const displayDate =
                      dateBasis === 'APPROVAL'
                        ? tx.approvalDate || '승인 대기'
                        : tx.requestDate;
                    const settlementSt = tx.settlementStatus || '정산 대기';
                    const settlementMeta = SETTLEMENT_PROGRESS_STATUS_META[settlementSt];

                    return (
                      <tr
                        key={tx.id}
                        onClick={() => setSelectedTx(tx)}
                        className="cursor-pointer hover:bg-slate-50/90 transition-colors"
                      >
                        <td className="py-3.5 px-4 font-mono">
                          <span className="font-bold text-slate-900 block">{tx.id}</span>
                          <span className="text-[11px] text-slate-400">{displayDate}</span>
                        </td>
                        <td className="py-3.5 px-4">
                          <span className="font-extrabold text-slate-900 text-sm block">
                            {tx.customerName}
                          </span>
                          <span
                            className={`mt-1 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold ${settlementMeta.badgeClass}`}
                          >
                            {settlementMeta.label}
                          </span>
                        </td>
                        <td className="py-3.5 px-4">
                          <span className="font-bold text-slate-800 block">
                            {tx.cmProfile.name}
                            {isCmInfoMissing(tx) && <CmMissingBadge />}
                          </span>
                          <span className="text-[11px] text-slate-400">
                            {tx.cmProfile.affiliation}
                          </span>
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="flex items-center gap-2">
                            <span className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-0.5 text-xs font-extrabold text-slate-800">
                              {cardLogoUrl ? (
                                <img
                                  src={cardLogoUrl}
                                  alt={cardDisplayName}
                                  className="h-3.5 w-3.5 object-contain"
                                />
                              ) : (
                                <span
                                  className="h-2 w-2 rounded-full"
                                  style={{ backgroundColor: cardColor.mainHex }}
                                />
                              )}
                              {cardDisplayName}
                            </span>
                            <span className="font-medium text-slate-600">
                              {paymentSummary}
                            </span>
                          </div>
                        </td>
                        <td className="py-3.5 px-4 text-right font-extrabold text-slate-900 tabular-nums text-sm">
                          {formatKRW(calc.totalAmount)}
                        </td>
                        <td className="py-3.5 px-4 text-right tabular-nums">
                          <span className="font-extrabold text-slate-800 block">
                            {formatKRW(calc.totalCmCommission)}
                          </span>
                          <span className="text-[11px] text-slate-400">
                            {calc.effectiveCmRate}%
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-right tabular-nums">
                          <span className="font-black text-slate-900 block text-sm">
                            {formatKRW(calc.totalAgCommission)}
                          </span>
                          <span className="text-[11px] text-slate-500">
                            {calc.effectiveAgRate}%
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-200 bg-slate-50 font-extrabold text-slate-900">
                    <td colSpan={4} className="py-3.5 px-4">
                      합계 (총 {summary.txCount}건 · 거래선 {summary.partnerCount}곳)
                    </td>
                    <td className="py-3.5 px-4 text-right tabular-nums text-sm">
                      {formatKRW(summary.totalAmount)}
                    </td>
                    <td className="py-3.5 px-4 text-right tabular-nums text-sm">
                      {formatKRW(summary.totalCmCommission)}
                    </td>
                    <td className="py-3.5 px-4 text-right tabular-nums text-sm">
                      {formatKRW(summary.totalAgCommission)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* 모바일 리스트 뷰 */}
            <div className="divide-y divide-slate-100 md:hidden">
              {filteredTransactions.map((tx) => {
                const calc = calcSplitTotals(tx.paymentSplits, tx.appliedPromotions);
                const cardKey = tx.paymentSplits[0]?.cardCompany || '제휴카드사(삼성)';
                const cardColor = CARD_COMPANY_COLORS[cardKey];
                const cardDisplayName = V2_CARD_DISPLAY_NAMES[cardKey];
                const cardLogoUrl = V2_CARD_LOGO_URLS[cardKey];
                const paymentSummary = getTxPaymentDetailSummary(tx);
                const displayDate =
                  dateBasis === 'APPROVAL'
                    ? tx.approvalDate || '승인 대기'
                    : tx.requestDate;
                const settlementSt = tx.settlementStatus || '정산 대기';
                const settlementMeta = SETTLEMENT_PROGRESS_STATUS_META[settlementSt];

                return (
                  <button
                    key={tx.id}
                    type="button"
                    onClick={() => setSelectedTx(tx)}
                    className="w-full p-4 text-left hover:bg-slate-50 transition-colors space-y-2.5"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-extrabold text-slate-900">
                          {cardLogoUrl ? (
                            <img
                              src={cardLogoUrl}
                              alt={cardDisplayName}
                              className="h-3.5 w-3.5 object-contain"
                            />
                          ) : (
                            <span
                              className="h-2 w-2 rounded-full"
                              style={{ backgroundColor: cardColor.mainHex }}
                            />
                          )}
                          {cardDisplayName}
                        </span>
                        <span className="text-sm font-black text-slate-900">
                          {tx.customerName}
                        </span>
                        <span className="text-xs font-semibold text-slate-500">
                          (CM: {tx.cmProfile.name})
                        </span>
                        {isCmInfoMissing(tx) && <CmMissingBadge />}
                        <span
                          className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold ${settlementMeta.badgeClass}`}
                        >
                          {settlementMeta.label}
                        </span>
                      </div>
                      <span className="text-[11px] font-mono text-slate-400">
                        {displayDate}
                      </span>
                    </div>

                    <p className="text-xs text-slate-600">{paymentSummary}</p>

                    <div className="grid grid-cols-3 gap-2 rounded-lg bg-slate-50 p-2.5 text-xs tabular-nums">
                      <div>
                        <span className="text-[10px] text-slate-400 block">거래 금액</span>
                        <span className="font-extrabold text-slate-900">
                          {formatKRW(calc.totalAmount)}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-400 block">
                          CM 수수료 ({calc.effectiveCmRate}%)
                        </span>
                        <span className="font-extrabold text-slate-800">
                          {formatKRW(calc.totalCmCommission)}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-400 block">
                          AG 수수료 ({calc.effectiveAgRate}%)
                        </span>
                        <span className="font-black text-slate-900">
                          {formatKRW(calc.totalAgCommission)}
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* 5. 거래 선택 시 상세 정보 모달 */}
      {selectedTx && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs"
          onClick={() => {
            setSelectedTx(null);
            setConfirmDeleteId(null);
          }}
        >
          <div
            className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white shadow-xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 모달 헤더 */}
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 bg-slate-900 text-white">
              <div>
                <span className="text-[11px] font-mono text-slate-400 block">
                  {selectedTx.id}
                </span>
                <h2 className="text-base font-extrabold">
                  {selectedTx.customerName} 고객 거래 상세 정보
                </h2>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedTx(null);
                  setConfirmDeleteId(null);
                }}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* 모달 본문 */}
            <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto text-xs">
              {/* 기본 정보 */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 rounded-xl bg-slate-50 p-3.5 border border-slate-200/80">
                <div>
                  <span className="text-slate-400 block">고객명</span>
                  <span className="font-extrabold text-slate-900 text-sm">
                    {selectedTx.customerName}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block">진행 / 정산상황</span>
                  <span className="font-extrabold text-slate-900">
                    {APPROVAL_STATUS_META[normalizeV2ProgressStatus(selectedTx.status)].label} ·{' '}
                    {selectedTx.settlementStatus || '정산 대기'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block">작성일자</span>
                  <span className="font-bold text-slate-800 font-mono">
                    {selectedTx.requestDate}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block">승인일자</span>
                  <span className="font-bold text-slate-900 font-mono">
                    {selectedTx.approvalDate || '승인 대기'}
                  </span>
                </div>
              </div>

              {/* 담당 CM 상세 */}
              <div className="rounded-xl border border-slate-200 p-3.5 space-y-2">
                <h3 className="font-extrabold text-slate-900">담당 CM 정보</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                  <div>
                    <span className="text-slate-400 block">이름</span>
                    <span className="font-bold text-slate-900">
                      {selectedTx.cmProfile.name}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block">소속</span>
                    <span className="font-bold text-slate-800">
                      {selectedTx.cmProfile.affiliation}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block">연락처</span>
                    <span className="font-mono font-bold text-slate-800">
                      {selectedTx.cmProfile.phone}
                    </span>
                  </div>
                </div>
              </div>

              {/* 결제 및 수수료 상세 */}
              <div className="rounded-xl border border-slate-200 p-3.5 space-y-2.5">
                <h3 className="font-extrabold text-slate-900">결제 및 수수료 내역</h3>
                <div className="space-y-2">
                  {selectedTx.paymentSplits.map((split, i) => {
                    const agAmt = Math.round(
                      (split.amount * split.agCommissionRate) / 100
                    );
                    const cmAmt = Math.round(
                      (split.amount * split.cmCommissionRate) / 100
                    );
                    const isLump = split.paymentMethod === '일시불';

                    return (
                      <div
                        key={split.id || i}
                        className="rounded-lg bg-slate-50 p-3 border border-slate-200/70 space-y-1.5"
                      >
                        <div className="flex items-center justify-between font-extrabold text-slate-900">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span>
                              {V2_CARD_DISPLAY_NAMES[split.cardCompany]} ·{' '}
                              {split.paymentMethod === '다이렉트할부'
                                ? '다이렉트'
                                : split.paymentMethod}{' '}
                              ({isLump ? '1개월' : `${split.installmentMonths}개월`})
                            </span>
                            <span className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-700">
                              {split.rateCategory || '일반'}
                            </span>
                          </div>
                          <span className="tabular-nums text-sm">
                            {formatKRW(split.amount)}
                          </span>
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-[11px] text-slate-600 pt-1 border-t border-slate-200/60 tabular-nums">
                          <div>
                            {isLump
                              ? `캐시백: ${split.cashbackRate}%`
                              : `할부금리: ${split.interestRate}%`}
                          </div>
                          <div>
                            CM 수수료: <strong>{formatKRW(cmAmt)}</strong> (
                            {split.cmCommissionRate}%)
                          </div>
                          <div>
                            AG 수수료: <strong className="text-slate-900">{formatKRW(agAmt)}</strong>{' '}
                            ({split.agCommissionRate}%)
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* 총계 요약 */}
                {(() => {
                  const totalCalc = calcSplitTotals(
                    selectedTx.paymentSplits,
                    selectedTx.appliedPromotions
                  );
                  return (
                    <div className="rounded-lg bg-slate-900 p-3 text-white grid grid-cols-3 gap-2 tabular-nums">
                      <div>
                        <span className="text-[10px] text-slate-400 block">거래 총액</span>
                        <span className="font-extrabold text-sm">
                          {formatKRW(totalCalc.totalAmount)}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-400 block">
                          CM 수수료 합계 ({totalCalc.effectiveCmRate}%)
                        </span>
                        <span className="font-extrabold text-sm">
                          {formatKRW(totalCalc.totalCmCommission)}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-400 block">
                          AG 수수료 합계 ({totalCalc.effectiveAgRate}%)
                        </span>
                        <span className="font-black text-sm">
                          {formatKRW(totalCalc.totalAgCommission)}
                        </span>
                      </div>
                    </div>
                  );
                })()}
              </div>

              {selectedTx.requestMemo && (
                <div className="rounded-xl bg-slate-50 p-3 border border-slate-200">
                  <span className="text-slate-400 block mb-0.5">비고</span>
                  <p className="font-medium text-slate-800">{selectedTx.requestMemo}</p>
                </div>
              )}
            </div>

            {/* 모달 하단 액션 */}
            <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-5 py-3.5">
              {confirmDeleteId === selectedTx.id ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-rose-600">
                    이 거래를 삭제할까요?
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      deleteTransaction(selectedTx.id);
                      setSelectedTx(null);
                      setConfirmDeleteId(null);
                    }}
                    className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-rose-700"
                  >
                    삭제 확인
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteId(null)}
                    className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600"
                  >
                    취소
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDeleteId(selectedTx.id)}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-rose-600 hover:bg-rose-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  거래 삭제
                </button>
              )}

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setEditingTxIdV2(selectedTx.id);
                    setSelectedTx(null);
                    navigate('/v2/register');
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800"
                >
                  <Edit3 className="h-3.5 w-3.5" />
                  이 거래 수정하기
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedTx(null);
                    setConfirmDeleteId(null);
                  }}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100"
                >
                  닫기
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const CmMissingBadge: React.FC = () => (
  <span
    title="주민번호·사업자번호가 없어 정산(원천징수) 처리가 어렵습니다. 설정 > CM 관리에서 입력해 주세요."
    className="ml-1.5 inline-flex items-center rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-bold text-rose-700 ring-1 ring-rose-200"
  >
    정보 누락
  </span>
);
