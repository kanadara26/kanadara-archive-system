import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import {
  downloadCsvFile,
  formatKRW,
  formatSignedKRW,
  formatSignedRate,
} from '../utils/format';
import {
  CARD_COMPANY_COLORS,
  SplitCardCompany,
} from '../types';
import {
  GOOGLE_MASTER_SPREADSHEET_BASE_URL,
  GOOGLE_MASTER_SPREADSHEET_ID,
  GOOGLE_MASTER_SPREADSHEET_TITLE,
  GOOGLE_SHEET_TABS,
  serializePromotionsTo2D,
  serializePromotionsToTsv,
  serializeRateTableTo2D,
  serializeRateTableToTsv,
  serializeSplitsTo2D,
  serializeTransactionsTo2D,
  serializeTransactionsToTsv,
} from '../constants/googleSheetConfig';
import {
  FileSpreadsheet,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  ShieldAlert,
  ExternalLink,
  KeyRound,
  Table2,
  ListChecks,
  Copy,
  Download,
  Upload,
  Lock,
} from 'lucide-react';

export const SheetsSyncPage: React.FC = () => {
  const {
    currentUser,
    users,
    accessibleTransactions,
    rateTableRows,
    cardPromotions,
    getUserById,
    retrySheetSync,
    lastMasterSheetSyncedAt,
    isSyncingMasterSheet,
    pushAllMasterTabsToGoogleSheet,
    pullRateAndPromotionsFromGoogleSheet,
    pushToast,
  } = useApp();

  const [activeTab, setActiveTab] = useState<'MASTER_VIEW' | 'FAILED' | 'ALL_LOGS'>('MASTER_VIEW');
  const [selectedMasterTab, setSelectedMasterTab] = useState<
    '05_RATE' | '06_PROMO' | '07_TX' | '08_SPLIT'
  >('05_RATE');
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [isBatchRetrying, setIsBatchRetrying] = useState(false);

  const isAdmin = currentUser?.role === 'ADMIN';

  const slipTransactions = useMemo(
    () => accessibleTransactions.filter((t) => Boolean(t.slip)),
    [accessibleTransactions]
  );

  const failedTransactions = useMemo(
    () => slipTransactions.filter((t) => t.sheetSync.status === 'FAILED'),
    [slipTransactions]
  );

  const syncedTransactions = useMemo(
    () => slipTransactions.filter((t) => t.sheetSync.status === 'SYNCED'),
    [slipTransactions]
  );

  const successRate =
    slipTransactions.length > 0
      ? Math.round((syncedTransactions.length / slipTransactions.length) * 1000) / 10
      : 100;

  const txMaster2D = useMemo(
    () => serializeTransactionsTo2D(accessibleTransactions, users, false),
    [accessibleTransactions, users]
  );

  const splitMaster2D = useMemo(
    () => serializeSplitsTo2D(accessibleTransactions, false),
    [accessibleTransactions]
  );

  if (!currentUser) return null;

  if (currentUser.role === 'CM') {
    return (
      <div className="mx-auto max-w-xl rounded-2xl border border-rose-200 bg-white p-8 text-center shadow-sm">
        <ShieldAlert className="mx-auto h-10 w-10 text-rose-500" />
        <h2 className="mt-3 text-lg font-bold text-slate-900">
          AG 및 운영 관리자 전용 메뉴입니다
        </h2>
        <p className="mt-1.5 text-xs text-slate-600">
          CM은 내 거래 목록 화면에서 요율표·프로모션 조회 및 본인 거래 내역 TSV 복사를 이용할 수 있습니다.
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

  const handleSingleRetry = (txId: string) => {
    setRetryingId(txId);
    setTimeout(() => {
      retrySheetSync(txId);
      setRetryingId(null);
    }, 320);
  };

  const handleBatchRetry = () => {
    if (failedTransactions.length === 0) return;
    setIsBatchRetrying(true);
    setTimeout(() => {
      failedTransactions.forEach((tx) => {
        retrySheetSync(tx.id);
      });
      setIsBatchRetrying(false);
    }, 450);
  };

  const displayedList = activeTab === 'FAILED' ? failedTransactions : slipTransactions;

  const activeTabMeta =
    selectedMasterTab === '05_RATE'
      ? GOOGLE_SHEET_TABS.RATE_TABLE_MASTER
      : selectedMasterTab === '06_PROMO'
      ? GOOGLE_SHEET_TABS.PROMOTION_MASTER
      : selectedMasterTab === '07_TX'
      ? GOOGLE_SHEET_TABS.TRANSACTION_MASTER
      : GOOGLE_SHEET_TABS.SPLIT_PAYMENT_DB;

  return (
    <div className="space-y-6">
      {/* 상단 실제 연동 구글 스프레드시트 마스터 배너 */}
      <div className="rounded-2xl bg-gradient-to-r from-emerald-950 via-teal-950 to-slate-900 p-6 text-white shadow-md border border-emerald-800/60">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/20 px-3 py-1 text-xs font-extrabold text-emerald-300 border border-emerald-400/30">
                <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                실제 Google Sheets 통합 마스터 파일 실시간 연동됨
              </span>
              <span className="font-mono text-xs text-slate-300">
                ID: {GOOGLE_MASTER_SPREADSHEET_ID}
              </span>
              <span className="font-mono text-xs text-emerald-300">
                · 최근 동기화: {lastMasterSheetSyncedAt}
              </span>
            </div>
            <h1 className="text-2xl font-black tracking-tight text-white flex flex-wrap items-center gap-2.5">
              <FileSpreadsheet className="h-7 w-7 text-emerald-400 shrink-0" />
              {GOOGLE_MASTER_SPREADSHEET_TITLE}
            </h1>
            <p className="text-xs text-slate-300">
              현재 웹앱 구조(카드사별 메인 컬러 · ADMIN 전용 요율표 · ±% 마이너스 요율 반영 프로모션 · AG 6단계 상태/CM 6항목 자동연동/동일 카드사 고정 분할결제)가 실제 구글 스프레드시트 마스터 탭(05~08번)과 실시간 연동되어 있습니다.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <a
              href={GOOGLE_SHEET_TABS.REGISTRATION_CONSOLE.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 px-4 py-2.5 text-xs font-black text-slate-950 shadow-sm transition-colors"
            >
              <ExternalLink className="h-4 w-4" />
              00_조건·요율·프로모션_등록 시트(GAS 콘솔) 열기
            </a>

            <a
              href={GOOGLE_MASTER_SPREADSHEET_BASE_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 px-4 py-2.5 text-xs font-extrabold text-white shadow-sm transition-colors"
            >
              <ExternalLink className="h-4 w-4" />
              실제 구글 시트 통합마스터 열기
            </a>

            <button
              type="button"
              disabled={isSyncingMasterSheet}
              onClick={() => pushAllMasterTabsToGoogleSheet('05~08 통합 마스터 전체 탭')}
              className="inline-flex items-center gap-1.5 rounded-xl bg-amber-400 hover:bg-amber-300 disabled:opacity-50 px-4 py-2.5 text-xs font-black text-slate-950 shadow-sm cursor-pointer"
            >
              <Upload className={`h-4 w-4 ${isSyncingMasterSheet ? 'animate-pulse' : ''}`} />
              웹앱 → 구글 시트 전체 즉시 반영 (Push)
            </button>

            {isAdmin && (
              <button
                type="button"
                disabled={isSyncingMasterSheet}
                onClick={() => pullRateAndPromotionsFromGoogleSheet()}
                className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 px-4 py-2.5 text-xs font-extrabold text-white shadow-sm cursor-pointer"
              >
                <RefreshCw className={`h-4 w-4 ${isSyncingMasterSheet ? 'animate-spin' : ''}`} />
                구글 시트 → 웹앱 요율·프로모션 불러오기 (Pull)
              </button>
            )}
          </div>
        </div>

        {/* 1-Click Direct Tab Links */}
        <div className="mt-4 pt-4 border-t border-white/10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
          {[
            {
              tab: GOOGLE_SHEET_TABS.RATE_TABLE_MASTER,
              countLabel: `${rateTableRows.length}행`,
              key: '05_RATE' as const,
            },
            {
              tab: GOOGLE_SHEET_TABS.PROMOTION_MASTER,
              countLabel: `${cardPromotions.length}건 (±%반영)`,
              key: '06_PROMO' as const,
            },
            {
              tab: GOOGLE_SHEET_TABS.TRANSACTION_MASTER,
              countLabel: `${accessibleTransactions.length}건`,
              key: '07_TX' as const,
            },
            {
              tab: GOOGLE_SHEET_TABS.SPLIT_PAYMENT_DB,
              countLabel: `${splitMaster2D.length - 1}행`,
              key: '08_SPLIT' as const,
            },
          ].map(({ tab, countLabel, key }) => (
            <div
              key={tab.id}
              onClick={() => {
                setActiveTab('MASTER_VIEW');
                setSelectedMasterTab(key);
              }}
              className={`rounded-xl p-3 border transition-all cursor-pointer flex flex-col justify-between gap-2 ${
                activeTab === 'MASTER_VIEW' && selectedMasterTab === key
                  ? 'bg-emerald-800/70 border-emerald-400 shadow-sm'
                  : 'bg-white/5 border-white/15 hover:bg-white/10'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-black text-white">{tab.title}</span>
                <span className="rounded-full bg-emerald-400/20 px-2 py-0.5 font-mono text-[11px] font-bold text-emerald-300">
                  {countLabel}
                </span>
              </div>
              <p className="text-[11px] text-slate-300 line-clamp-1">{tab.desc}</p>
              <div className="flex items-center justify-between pt-1">
                <span className="font-mono text-[10px] text-emerald-300/80">#gid={tab.id}</span>
                <a
                  href={tab.url}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center gap-1 text-[11px] font-extrabold text-amber-300 hover:underline"
                >
                  구글 시트 탭 직접 열기
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* KPI Summary Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-2xl border border-indigo-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-bold text-indigo-800">05_요율표 · 06_프로모션 마스터</p>
          <p className="mt-1 text-2xl font-black tabular-nums text-slate-900">
            {rateTableRows.length}행 / {cardPromotions.length}건
          </p>
          <p className="mt-1 text-[11px] text-slate-500">
            카드사 7종 메인컬러 · ADMIN 전용 편집
          </p>
        </div>

        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-4 shadow-sm">
          <p className="text-xs font-bold text-emerald-800">07_거래내역 · 08_분할결제 DB</p>
          <p className="mt-1 text-2xl font-black tabular-nums text-emerald-700">
            {accessibleTransactions.length}건 / {splitMaster2D.length - 1}분할행
          </p>
          <p className="mt-1 text-[11px] text-emerald-700">
            6단계 상태 · CM 6항목 · 카드사고정 분할
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium text-slate-500">전표 제출 자동입력 성공률</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900">
            {syncedTransactions.length}건 ({successRate}%)
          </p>
          <p className="mt-1 text-[11px] text-slate-400">중복방지 멱등키(거래ID:전표ID) 보호</p>
        </div>

        <div
          className={`rounded-2xl border p-4 shadow-sm ${
            failedTransactions.length > 0
              ? 'border-rose-300 bg-rose-50/70'
              : 'border-slate-200 bg-white'
          }`}
        >
          <p className="text-xs font-medium text-rose-800">전표 시트 입력 실패 (재처리 대기)</p>
          <div className="mt-1 flex items-center justify-between">
            <p className="text-2xl font-bold tabular-nums text-rose-700">
              {failedTransactions.length}건
            </p>
            {failedTransactions.length > 0 && (
              <button
                type="button"
                disabled={isBatchRetrying}
                onClick={handleBatchRetry}
                className="rounded-lg bg-rose-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-rose-700"
              >
                일괄 재처리
              </button>
            )}
          </div>
          <p className="mt-1 text-[11px] text-rose-600">
            {failedTransactions.length > 0 ? 'OAuth 토큰·Quota 오류 확인됨' : '모든 전표 정상 동기화됨'}
          </p>
        </div>
      </div>

      {/* View Mode Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-3">
        <button
          type="button"
          onClick={() => setActiveTab('MASTER_VIEW')}
          className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-extrabold transition-colors ${
            activeTab === 'MASTER_VIEW'
              ? 'bg-emerald-700 text-white shadow-sm'
              : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50'
          }`}
        >
          <Table2 className="h-3.5 w-3.5" />
          통합 마스터시트 실시간 뷰어 & 양방향 동기화 (05~08탭)
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('FAILED')}
          className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition-colors ${
            activeTab === 'FAILED'
              ? 'bg-rose-600 text-white shadow-sm'
              : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50'
          }`}
        >
          <AlertTriangle className="h-3.5 w-3.5" />
          전표 입력 실패 내역 및 재처리 ({failedTransactions.length})
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('ALL_LOGS')}
          className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition-colors ${
            activeTab === 'ALL_LOGS'
              ? 'bg-indigo-600 text-white shadow-sm'
              : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50'
          }`}
        >
          <ListChecks className="h-3.5 w-3.5" />
          전체 전표 연동 로그 ({slipTransactions.length})
        </button>
      </div>

      {/* Tab 1: Master Sheet Live Viewer (05_요율표, 06_프로모션, 07_거래내역, 08_분할결제) */}
      {activeTab === 'MASTER_VIEW' && (
        <div className="overflow-hidden rounded-2xl border-2 border-emerald-200 bg-white shadow-sm">
          {/* Google Sheets-like Toolbar */}
          <div className="flex flex-col justify-between gap-3 border-b border-emerald-200 bg-emerald-50/80 px-5 py-3.5 lg:flex-row lg:items-center">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setSelectedMasterTab('05_RATE')}
                className={`rounded-xl px-3 py-1.5 text-xs font-extrabold transition-all ${
                  selectedMasterTab === '05_RATE'
                    ? 'bg-emerald-700 text-white shadow-xs'
                    : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50'
                }`}
              >
                05_요율표_마스터 ({rateTableRows.length}행)
              </button>
              <button
                type="button"
                onClick={() => setSelectedMasterTab('06_PROMO')}
                className={`rounded-xl px-3 py-1.5 text-xs font-extrabold transition-all ${
                  selectedMasterTab === '06_PROMO'
                    ? 'bg-emerald-700 text-white shadow-xs'
                    : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50'
                }`}
              >
                06_카드사별_프로모션_마스터 ({cardPromotions.length}건)
              </button>
              <button
                type="button"
                onClick={() => setSelectedMasterTab('07_TX')}
                className={`rounded-xl px-3 py-1.5 text-xs font-extrabold transition-all ${
                  selectedMasterTab === '07_TX'
                    ? 'bg-emerald-700 text-white shadow-xs'
                    : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50'
                }`}
              >
                07_거래내역_통합마스터 ({accessibleTransactions.length}건)
              </button>
              <button
                type="button"
                onClick={() => setSelectedMasterTab('08_SPLIT')}
                className={`rounded-xl px-3 py-1.5 text-xs font-extrabold transition-all ${
                  selectedMasterTab === '08_SPLIT'
                    ? 'bg-emerald-700 text-white shadow-xs'
                    : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50'
                }`}
              >
                08_분할결제_상세행_DB ({splitMaster2D.length - 1}행)
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {(selectedMasterTab === '05_RATE' || selectedMasterTab === '06_PROMO') && !isAdmin && (
                <span className="inline-flex items-center gap-1 rounded-lg bg-slate-200 px-2.5 py-1 text-[11px] font-bold text-slate-700">
                  <Lock className="h-3 w-3" />
                  요율·프로모션 수정 권한: ADMIN 전용
                </span>
              )}

              <button
                type="button"
                onClick={() => {
                  const tsv =
                    selectedMasterTab === '05_RATE'
                      ? serializeRateTableToTsv(rateTableRows, true)
                      : selectedMasterTab === '06_PROMO'
                      ? serializePromotionsToTsv(cardPromotions, true)
                      : selectedMasterTab === '07_TX'
                      ? serializeTransactionsToTsv(accessibleTransactions, users, false)
                      : splitMaster2D
                          .map((r) => r.map((c) => String(c ?? '')).join('\t'))
                          .join('\n');
                  navigator.clipboard.writeText(tsv);
                  pushToast({
                    type: 'success',
                    title: `${activeTabMeta.title} TSV 복사 완료`,
                    description: '구글 시트 A1 셀에 Ctrl+V로 즉시 붙여넣을 수 있습니다.',
                  });
                }}
                className="inline-flex items-center gap-1.5 rounded-xl bg-white px-3 py-1.5 text-xs font-bold text-slate-800 ring-1 ring-slate-300 hover:bg-slate-50 cursor-pointer"
              >
                <Copy className="h-3.5 w-3.5 text-emerald-700" />
                시트 탭 TSV 복사
              </button>

              <button
                type="button"
                onClick={() => {
                  const matrix =
                    selectedMasterTab === '05_RATE'
                      ? serializeRateTableTo2D(rateTableRows)
                      : selectedMasterTab === '06_PROMO'
                      ? serializePromotionsTo2D(cardPromotions)
                      : selectedMasterTab === '07_TX'
                      ? txMaster2D
                      : splitMaster2D;
                  downloadCsvFile(
                    `${activeTabMeta.title}_20261104.csv`,
                    matrix.map((r) => r.map((c) => String(c ?? '')))
                  );
                }}
                className="inline-flex items-center gap-1.5 rounded-xl bg-white px-3 py-1.5 text-xs font-bold text-slate-800 ring-1 ring-slate-300 hover:bg-slate-50 cursor-pointer"
              >
                <Download className="h-3.5 w-3.5 text-indigo-600" />
                CSV 다운로드
              </button>

              <a
                href={activeTabMeta.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-700 px-3 py-1.5 text-xs font-extrabold text-white hover:bg-emerald-800"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                구글 시트에서 {activeTabMeta.title} 열기
              </a>
            </div>
          </div>

          {/* 05_요율표_마스터 그리드 */}
          {selectedMasterTab === '05_RATE' && (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
                <thead className="bg-slate-900 font-mono text-[11px] font-bold text-white">
                  <tr>
                    <th className="border-r border-slate-700 px-3 py-2.5 text-center">행</th>
                    <th className="border-r border-slate-700 px-3 py-2.5">A: 요율행ID</th>
                    <th className="border-r border-slate-700 px-3 py-2.5">B: 카드사</th>
                    <th className="border-r border-slate-700 px-3 py-2.5">C: 메인컬러코드</th>
                    <th className="border-r border-slate-700 px-3 py-2.5">D: 결제방법</th>
                    <th className="border-r border-slate-700 px-3 py-2.5">E: 적용금액구간</th>
                    <th className="border-r border-slate-700 px-3 py-2.5">F: 할부개월</th>
                    <th className="border-r border-slate-700 px-3 py-2.5 text-right">G: 캐시백율(%)</th>
                    <th className="border-r border-slate-700 px-3 py-2.5 text-right">H: 할부금리(%)</th>
                    <th className="border-r border-slate-700 px-3 py-2.5 text-right">I: AG수수료율(%)</th>
                    <th className="border-r border-slate-700 px-3 py-2.5 text-right">J: CM수수료율(%)</th>
                    <th className="border-r border-slate-700 px-3 py-2.5">K: 실행일자</th>
                    <th className="px-3 py-2.5">L: 비고 및 세부조건</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                  {rateTableRows.map((row, idx) => {
                    const cMeta =
                      CARD_COMPANY_COLORS[row.cardCompany] ||
                      CARD_COMPANY_COLORS['제휴카드사(삼성)'];
                    return (
                      <tr key={row.id} style={{ backgroundColor: `${cMeta.softBgHex}66` }}>
                        <td className="border-r border-slate-200 bg-slate-50 px-3 py-2 text-center font-mono text-slate-400">
                          {idx + 2}
                        </td>
                        <td className="border-r border-slate-200 px-3 py-2 font-mono font-bold text-slate-700">
                          {row.id}
                        </td>
                        <td
                          className="border-r border-slate-200 px-3 py-2 font-extrabold"
                          style={{
                            backgroundColor: cMeta.mainHex,
                            color: cMeta.badgeTextHex,
                          }}
                        >
                          {row.cardCompany}
                        </td>
                        <td
                          className="border-r border-slate-200 px-3 py-2 font-mono font-bold"
                          style={{
                            backgroundColor: cMeta.mainHex,
                            color: cMeta.badgeTextHex,
                          }}
                        >
                          {cMeta.mainHex}
                        </td>
                        <td className="border-r border-slate-200 px-3 py-2 font-bold text-slate-800">
                          {row.paymentMethod}
                        </td>
                        <td className="border-r border-slate-200 px-3 py-2 text-slate-700">
                          {row.amountTier}
                        </td>
                        <td className="border-r border-slate-200 px-3 py-2 font-mono text-slate-700">
                          {row.installmentMonths}
                        </td>
                        <td className="border-r border-slate-200 px-3 py-2 text-right font-mono font-extrabold text-emerald-700">
                          {row.cashbackRate}%
                        </td>
                        <td className="border-r border-slate-200 px-3 py-2 text-right font-mono font-bold text-amber-700">
                          {row.interestRate}%
                        </td>
                        <td className="border-r border-slate-200 px-3 py-2 text-right font-mono font-extrabold text-purple-700">
                          {row.agCommissionRate}%
                        </td>
                        <td className="border-r border-slate-200 px-3 py-2 text-right font-mono font-extrabold text-indigo-700">
                          {row.cmCommissionRate}%
                        </td>
                        <td className="border-r border-slate-200 px-3 py-2 font-mono text-slate-700">
                          {row.effectiveDate}
                        </td>
                        <td className="px-3 py-2 text-slate-600">{row.remark}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* 06_카드사별_프로모션_마스터 그리드 (±% 마이너스 요율 반영 포함) */}
          {selectedMasterTab === '06_PROMO' && (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
                <thead className="bg-slate-900 font-mono text-[11px] font-bold text-white">
                  <tr>
                    <th className="border-r border-slate-700 px-2.5 py-2.5 text-center">행</th>
                    <th className="border-r border-slate-700 px-2.5 py-2.5">A: 프로모션ID</th>
                    <th className="border-r border-slate-700 px-2.5 py-2.5">B: 카드사</th>
                    <th className="border-r border-slate-700 px-2.5 py-2.5">C: 컬러코드</th>
                    <th className="border-r border-slate-700 px-2.5 py-2.5">D: 프로모션명</th>
                    <th className="border-r border-slate-700 px-2.5 py-2.5">E~F: 기간</th>
                    <th className="border-r border-slate-700 px-2.5 py-2.5">G: 결제방법</th>
                    <th className="border-r border-slate-700 px-2.5 py-2.5">J: 금액조건</th>
                    <th className="border-r border-slate-700 px-2.5 py-2.5 text-right">K: 캐시백(±%)</th>
                    <th className="border-r border-slate-700 px-2.5 py-2.5 text-right">L: 금리(±%)</th>
                    <th className="border-r border-slate-700 px-2.5 py-2.5 text-right">M: AG요율(±%)</th>
                    <th className="border-r border-slate-700 px-2.5 py-2.5 text-right">N: CM요율(±%)</th>
                    <th className="border-r border-slate-700 px-2.5 py-2.5 text-right">O~P: 추가정액</th>
                    <th className="px-2.5 py-2.5">Q: 프로모션 조건 (불릿포인트)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                  {cardPromotions.map((p, idx) => {
                    const cMeta =
                      CARD_COMPANY_COLORS[p.cardCompany] ||
                      CARD_COMPANY_COLORS['제휴카드사(삼성)'];
                    const cbDelta = p.cashbackRateDelta ?? 0;
                    const intDelta = p.interestRateDelta ?? 0;
                    return (
                      <tr key={p.id} style={{ backgroundColor: `${cMeta.softBgHex}66` }}>
                        <td className="border-r border-slate-200 bg-slate-50 px-2.5 py-2 text-center font-mono text-slate-400">
                          {idx + 2}
                        </td>
                        <td className="border-r border-slate-200 px-2.5 py-2 font-mono font-bold text-slate-700">
                          {p.id}
                        </td>
                        <td
                          className="border-r border-slate-200 px-2.5 py-2 font-extrabold"
                          style={{
                            backgroundColor: cMeta.mainHex,
                            color: cMeta.badgeTextHex,
                          }}
                        >
                          {p.cardCompany}
                        </td>
                        <td
                          className="border-r border-slate-200 px-2.5 py-2 font-mono font-bold"
                          style={{
                            backgroundColor: cMeta.mainHex,
                            color: cMeta.badgeTextHex,
                          }}
                        >
                          {cMeta.mainHex}
                        </td>
                        <td className="border-r border-slate-200 px-2.5 py-2 font-bold text-slate-900">
                          {p.title}
                        </td>
                        <td className="border-r border-slate-200 px-2.5 py-2 font-mono text-[11px] text-slate-600">
                          {p.startDate} ~ {p.endDate || '계속 진행'}
                        </td>
                        <td className="border-r border-slate-200 px-2.5 py-2 font-bold text-slate-800">
                          {p.paymentMethod}
                        </td>
                        <td className="border-r border-slate-200 px-2.5 py-2 text-slate-700">
                          {p.amountConditionLabel}
                        </td>
                        <td
                          className={`border-r border-slate-200 px-2.5 py-2 text-right font-mono font-extrabold ${
                            cbDelta < 0
                              ? 'text-rose-600'
                              : cbDelta > 0
                              ? 'text-emerald-700'
                              : 'text-slate-400'
                          }`}
                        >
                          {formatSignedRate(cbDelta)}
                        </td>
                        <td
                          className={`border-r border-slate-200 px-2.5 py-2 text-right font-mono font-extrabold ${
                            intDelta < 0
                              ? 'text-emerald-700'
                              : intDelta > 0
                              ? 'text-rose-600'
                              : 'text-slate-400'
                          }`}
                        >
                          {formatSignedRate(intDelta)}
                        </td>
                        <td
                          className={`border-r border-slate-200 px-2.5 py-2 text-right font-mono font-extrabold ${
                            p.agIncentiveRate < 0 ? 'text-rose-600' : 'text-purple-700'
                          }`}
                        >
                          {formatSignedRate(p.agIncentiveRate)}
                        </td>
                        <td
                          className={`border-r border-slate-200 px-2.5 py-2 text-right font-mono font-extrabold ${
                            p.cmIncentiveRate < 0 ? 'text-rose-600' : 'text-indigo-700'
                          }`}
                        >
                          {formatSignedRate(p.cmIncentiveRate)}
                        </td>
                        <td className="border-r border-slate-200 px-2.5 py-2 text-right font-mono text-[11px] text-slate-700">
                          AG {formatSignedKRW(p.agIncentiveAmount)} / CM{' '}
                          {formatSignedKRW(p.cmIncentiveAmount)}
                        </td>
                        <td className="px-2.5 py-2 text-[11px] text-slate-600 max-w-xs truncate">
                          {p.promotionConditionText}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* 07_거래내역_통합마스터 그리드 */}
          {selectedMasterTab === '07_TX' && (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
                <thead className="bg-slate-900 font-mono text-[11px] font-bold text-white">
                  <tr>
                    <th className="border-r border-slate-700 px-2.5 py-2.5 text-center">행</th>
                    <th className="border-r border-slate-700 px-2.5 py-2.5">A: 거래ID</th>
                    <th className="border-r border-slate-700 px-2.5 py-2.5">B: 고객이름</th>
                    <th className="border-r border-slate-700 px-2.5 py-2.5">C~E: 요청일/상태(6단계)/승인일</th>
                    <th className="border-r border-slate-700 px-2.5 py-2.5">
                      F~K: CM 등록정보 6항목 자동연동
                    </th>
                    <th className="border-r border-slate-700 px-2.5 py-2.5">L~M: 기준고정카드사</th>
                    <th className="border-r border-slate-700 px-2.5 py-2.5 text-right">
                      P: 총결제금액
                    </th>
                    <th className="border-r border-slate-700 px-2.5 py-2.5">
                      Q~R: 분할결제 상세 & 적용프로모션
                    </th>
                    <th className="border-r border-slate-700 px-2.5 py-2.5 text-right">
                      U~V: AG 요율/수수료
                    </th>
                    <th className="px-2.5 py-2.5 text-right">W~X: CM 요율/수수료</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                  {txMaster2D.slice(1).map((row, idx) => {
                    const cardName = String(row[11]) as SplitCardCompany;
                    const cMeta =
                      CARD_COMPANY_COLORS[cardName] ||
                      CARD_COMPANY_COLORS['제휴카드사(삼성)'];
                    return (
                      <tr key={String(row[0])} style={{ backgroundColor: `${cMeta.softBgHex}55` }}>
                        <td className="border-r border-slate-200 bg-slate-50 px-2.5 py-2 text-center font-mono text-slate-400">
                          {idx + 2}
                        </td>
                        <td className="border-r border-slate-200 px-2.5 py-2 font-mono font-bold text-indigo-700">
                          <Link to={`/transactions/${row[0]}`} className="hover:underline">
                            {row[0]}
                          </Link>
                        </td>
                        <td className="border-r border-slate-200 px-2.5 py-2 font-extrabold text-slate-900">
                          {row[1]}
                        </td>
                        <td className="border-r border-slate-200 px-2.5 py-2 font-mono text-[11px] text-slate-700">
                          <div>요청: {row[2]}</div>
                          <div className="font-sans font-extrabold text-indigo-900">
                            상태: {row[3]} (변경일 {row[4]})
                          </div>
                        </td>
                        <td className="border-r border-slate-200 px-2.5 py-2 text-[11px] text-slate-700">
                          <div className="font-bold text-slate-900">
                            {row[5]} ({row[9]} · 사번 {row[10]})
                          </div>
                          <div className="font-mono text-slate-500">
                            주민:{row[6]} / 사업자:{row[7]} / {row[8]}
                          </div>
                        </td>
                        <td
                          className="border-r border-slate-200 px-2.5 py-2 font-extrabold"
                          style={{
                            backgroundColor: cMeta.mainHex,
                            color: cMeta.badgeTextHex,
                          }}
                        >
                          <div>{row[11]}</div>
                          <div className="font-mono text-[10px] opacity-90">
                            {row[12]} · {row[13]}({row[14]})
                          </div>
                        </td>
                        <td className="border-r border-slate-200 px-2.5 py-2 text-right font-mono font-black text-slate-900 tabular-nums">
                          {formatKRW(Number(row[15]) || 0)}
                        </td>
                        <td className="border-r border-slate-200 px-2.5 py-2 text-[11px] text-slate-700 max-w-sm">
                          <div className="line-clamp-2">{row[16]}</div>
                          {row[17] !== '미적용' && (
                            <div className="mt-0.5 font-bold text-amber-800">
                              ★ 프로모션: {row[17]}
                            </div>
                          )}
                        </td>
                        <td className="border-r border-slate-200 px-2.5 py-2 text-right font-mono font-bold text-purple-700 tabular-nums">
                          <div>{row[20]}%</div>
                          <div className="font-extrabold">{formatKRW(Number(row[21]) || 0)}</div>
                        </td>
                        <td className="px-2.5 py-2 text-right font-mono font-bold text-indigo-700 tabular-nums">
                          <div>{row[22]}%</div>
                          <div className="font-extrabold">{formatKRW(Number(row[23]) || 0)}</div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* 08_분할결제_상세행_DB 그리드 */}
          {selectedMasterTab === '08_SPLIT' && (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
                <thead className="bg-slate-900 font-mono text-[11px] font-bold text-white">
                  <tr>
                    <th className="border-r border-slate-700 px-2.5 py-2.5 text-center">행</th>
                    <th className="border-r border-slate-700 px-2.5 py-2.5">A~C: 분할행ID / 거래ID / 순번</th>
                    <th className="border-r border-slate-700 px-2.5 py-2.5">D~E: 고객명 / 상태</th>
                    <th className="border-r border-slate-700 px-2.5 py-2.5">H~I: CM이름 / 사번</th>
                    <th className="border-r border-slate-700 px-2.5 py-2.5">J~K: 고정카드사 / 컬러</th>
                    <th className="border-r border-slate-700 px-2.5 py-2.5">L: 결제방법</th>
                    <th className="border-r border-slate-700 px-2.5 py-2.5 text-right">
                      M: 분할결제금액
                    </th>
                    <th className="border-r border-slate-700 px-2.5 py-2.5 text-center">
                      N: 할부개월
                    </th>
                    <th className="border-r border-slate-700 px-2.5 py-2.5 text-right">
                      O~Q: 캐시백 / 할부금리
                    </th>
                    <th className="border-r border-slate-700 px-2.5 py-2.5 text-right">
                      R~S: AG 요율/수수료
                    </th>
                    <th className="px-2.5 py-2.5 text-right">T~U: CM 요율/수수료</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                  {splitMaster2D.slice(1).map((row, idx) => {
                    const cardName = String(row[9]) as SplitCardCompany;
                    const cMeta =
                      CARD_COMPANY_COLORS[cardName] ||
                      CARD_COMPANY_COLORS['제휴카드사(삼성)'];
                    return (
                      <tr key={String(row[0])} style={{ backgroundColor: `${cMeta.softBgHex}55` }}>
                        <td className="border-r border-slate-200 bg-slate-50 px-2.5 py-2 text-center font-mono text-slate-400">
                          {idx + 2}
                        </td>
                        <td className="border-r border-slate-200 px-2.5 py-2 font-mono text-[11px]">
                          <div className="font-bold text-indigo-700">
                            {row[1]} ({row[2]})
                          </div>
                          <div className="text-slate-400">{row[0]}</div>
                        </td>
                        <td className="border-r border-slate-200 px-2.5 py-2">
                          <span className="font-bold text-slate-900">{row[3]}</span> ·{' '}
                          <span className="text-indigo-700 font-semibold">{row[4]}</span>
                        </td>
                        <td className="border-r border-slate-200 px-2.5 py-2 text-slate-700">
                          {row[7]} (<span className="font-mono">{row[8]}</span>)
                        </td>
                        <td
                          className="border-r border-slate-200 px-2.5 py-2 font-extrabold"
                          style={{
                            backgroundColor: cMeta.mainHex,
                            color: cMeta.badgeTextHex,
                          }}
                        >
                          {row[9]} ({row[10]})
                        </td>
                        <td className="border-r border-slate-200 px-2.5 py-2 font-bold text-slate-800">
                          {row[11]}
                        </td>
                        <td className="border-r border-slate-200 px-2.5 py-2 text-right font-mono font-extrabold text-slate-900">
                          {formatKRW(Number(row[12]) || 0)}
                        </td>
                        <td className="border-r border-slate-200 px-2.5 py-2 text-center font-mono text-slate-700">
                          {row[13]}개월
                        </td>
                        <td className="border-r border-slate-200 px-2.5 py-2 text-right font-mono text-[11px]">
                          {String(row[11]) === '일시불' ? (
                            <span className="font-bold text-emerald-700">
                              캐시백 {row[14]}% ({formatKRW(Number(row[15]) || 0)})
                            </span>
                          ) : (
                            <span className="font-bold text-amber-700">금리 {row[16]}%</span>
                          )}
                        </td>
                        <td className="border-r border-slate-200 px-2.5 py-2 text-right font-mono font-bold text-purple-700">
                          {row[17]}% ({formatKRW(Number(row[18]) || 0)})
                        </td>
                        <td className="px-2.5 py-2 text-right font-mono font-bold text-indigo-700">
                          {row[19]}% ({formatKRW(Number(row[20]) || 0)})
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab 2 & 3: Failed Items / All Sync Logs */}
      {(activeTab === 'FAILED' || activeTab === 'ALL_LOGS') && (
        <div className="space-y-4">
          {displayedList.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center shadow-sm">
              <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-500" />
              <h3 className="mt-3 text-sm font-bold text-slate-900">
                현재 재처리가 필요한 구글 시트 입력 실패 내역이 없습니다
              </h3>
              <p className="mt-1 text-xs text-slate-500">
                제출된 모든 전표와 거래내역이 구글 시트 마스터 탭 구조에 중복 없이 동기화되었습니다.
              </p>
              <button
                type="button"
                onClick={() => setActiveTab('MASTER_VIEW')}
                className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-emerald-700 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-800"
              >
                <Table2 className="h-3.5 w-3.5" />
                통합 마스터시트 실시간 뷰어 열기
              </button>
            </div>
          ) : (
            displayedList.map((tx) => {
              const cmUser = getUserById(tx.cmId);
              const isFailed = tx.sheetSync.status === 'FAILED';
              return (
                <div
                  key={tx.id}
                  className={`rounded-2xl border bg-white p-5 shadow-sm ${
                    isFailed ? 'border-rose-200' : 'border-slate-200'
                  }`}
                >
                  <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm font-bold text-slate-900">{tx.id}</span>
                        <span className="font-mono text-xs text-slate-500">
                          ({tx.slip?.id} · 승인번호 #{tx.slip?.approvalNumber})
                        </span>
                        {isFailed ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-0.5 text-xs font-bold text-rose-700 ring-1 ring-inset ring-rose-600/20">
                            <AlertTriangle className="h-3 w-3" />
                            입력 실패 ({tx.sheetSync.errorCode})
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-teal-50 px-2.5 py-0.5 text-xs font-bold text-teal-700 ring-1 ring-inset ring-teal-600/20">
                            <CheckCircle2 className="h-3 w-3" />
                            입력 성공 ({tx.sheetSync.externalRowId})
                          </span>
                        )}
                      </div>

                      <p className="text-xs text-slate-700">
                        담당 CM: <strong>{cmUser?.name}</strong> ({cmUser?.affiliation}) · 고객:{' '}
                        <strong>{tx.customerName}</strong> ({tx.maskedIdentifier}) ·{' '}
                        <strong>
                          {tx.cardCompany} {tx.paymentMethod}
                        </strong>{' '}
                        · 결제금액:{' '}
                        <strong className="tabular-nums">
                          {formatKRW(tx.slip?.approvedAmount ?? tx.amount)}
                        </strong>
                      </p>

                      <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
                        <span className="inline-flex items-center gap-1">
                          <KeyRound className="h-3 w-3 text-indigo-500" />
                          중복방지 키: <code className="font-mono">{tx.sheetSync.idempotencyKey}</code>
                        </span>
                        <span>시도 횟수: {tx.sheetSync.attemptCount}회</span>
                        <span>최근 시도: {tx.sheetSync.lastAttemptAt}</span>
                      </div>

                      {isFailed && tx.sheetSync.errorReason && (
                        <div className="mt-2 rounded-xl bg-rose-50 px-3.5 py-2.5 text-xs text-rose-800">
                          <strong>실패 원인:</strong> {tx.sheetSync.errorReason}
                        </div>
                      )}
                    </div>

                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      <Link
                        to={`/transactions/${tx.id}`}
                        className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        거래 상세
                        <ExternalLink className="h-3.5 w-3.5" />
                      </Link>
                      {isFailed && (
                        <button
                          type="button"
                          disabled={retryingId === tx.id}
                          onClick={() => handleSingleRetry(tx.id)}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-rose-700 disabled:opacity-60"
                        >
                          <RefreshCw
                            className={`h-3.5 w-3.5 ${
                              retryingId === tx.id ? 'animate-spin' : ''
                            }`}
                          />
                          {retryingId === tx.id ? '대조 후 재처리 중...' : '재처리 실행'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};
