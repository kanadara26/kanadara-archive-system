import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { ApprovalStatusBadge, RoleBadge } from '../components/StatusBadges';
import { RateTablePanel } from '../components/RateTablePanel';
import {
  calcExpectedAgCommission,
  calcExpectedCashback,
  calcExpectedCommission,
  formatKRW,
} from '../utils/format';
import {
  Users,
  Link2,
  Sliders,
  FileSpreadsheet,
  Calculator,
  FileText,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  ShieldAlert,
  ChevronRight,
  Coins,
  Layers,
} from 'lucide-react';

export const AdminOverviewPage: React.FC = () => {
  const { currentUser, users, conditions, transactions } = useApp();
  const [showRateManager, setShowRateManager] = useState(false);

  const metrics = useMemo(() => {
    const activeTxs = transactions.filter((t) => t.status !== 'REJECTED');
    const confirmedTxs = transactions.filter(
      (t) =>
        t.status === 'APPROVED' ||
        t.status === 'SLIP_REQUIRED' ||
        t.status === 'COMPLETED'
    );
    const pendingTxs = transactions.filter(
      (t) => t.status === 'WAITING' || t.status === 'REVIEWING'
    );

    const activeCms = users.filter((u) => u.role === 'CM' && u.isActive).length;
    const activeAgs = users.filter((u) => u.role === 'AG' && u.isActive).length;

    const slipTxs = transactions.filter((t) => Boolean(t.slip));
    const syncedSlips = slipTxs.filter((t) => t.sheetSync.status === 'SYNCED');
    const failedSlips = slipTxs.filter((t) => t.sheetSync.status === 'FAILED');
    const sheetSuccessRate =
      slipTxs.length > 0
        ? Math.round((syncedSlips.length / slipTxs.length) * 1000) / 10
        : 100;

    // CM 수수료 금액 및 AG 수수료 금액 동시 집계
    const totalVolume = activeTxs.reduce((sum, t) => sum + t.amount, 0);
    const totalCmCommission = activeTxs.reduce(
      (sum, t) => sum + calcExpectedCommission(t),
      0
    );
    const totalAgCommission = activeTxs.reduce(
      (sum, t) => sum + calcExpectedAgCommission(t),
      0
    );
    const totalCashback = activeTxs.reduce(
      (sum, t) => sum + calcExpectedCashback(t),
      0
    );

    const confirmedVolume = confirmedTxs.reduce((sum, t) => sum + t.amount, 0);
    const confirmedCmCommission = confirmedTxs.reduce(
      (sum, t) => sum + calcExpectedCommission(t),
      0
    );
    const confirmedAgCommission = confirmedTxs.reduce(
      (sum, t) => sum + calcExpectedAgCommission(t),
      0
    );

    const pendingCmCommission = pendingTxs.reduce(
      (sum, t) => sum + calcExpectedCommission(t),
      0
    );
    const pendingAgCommission = pendingTxs.reduce(
      (sum, t) => sum + calcExpectedAgCommission(t),
      0
    );

    const missingCommissionCount = confirmedTxs.filter(
      (t) => t.conditionSnapshot.cmCommissionRate === null
    ).length;

    return {
      totalCount: transactions.length,
      activeCount: activeTxs.length,
      confirmedCount: confirmedTxs.length,
      pendingCount: pendingTxs.length,
      activeCms,
      activeAgs,
      sheetSuccessRate,
      failedSlipsCount: failedSlips.length,
      missingCommissionCount,
      totalVolume,
      totalCmCommission,
      totalAgCommission,
      totalCashback,
      confirmedVolume,
      confirmedCmCommission,
      confirmedAgCommission,
      pendingCmCommission,
      pendingAgCommission,
    };
  }, [transactions, users]);

  // AG별 수수료(AG 수수료 + 산하 CM 수수료) 비교 집계
  const agBreakdown = useMemo(() => {
    const agUsers = users.filter((u) => u.role === 'AG');
    return agUsers.map((ag) => {
      const agTxs = transactions.filter(
        (tx) => tx.agId === ag.id && tx.status !== 'REJECTED'
      );
      const volume = agTxs.reduce((s, t) => s + t.amount, 0);
      const agCommission = agTxs.reduce((s, t) => s + calcExpectedAgCommission(t), 0);
      const cmCommission = agTxs.reduce((s, t) => s + calcExpectedCommission(t), 0);
      return {
        ag,
        txCount: agTxs.length,
        volume,
        agCommission,
        cmCommission,
        combinedCommission: agCommission + cmCommission,
      };
    });
  }, [transactions, users]);

  // CM별 수수료(CM 수수료 + 해당 거래 발생 AG 수수료) 비교 집계
  const cmBreakdown = useMemo(() => {
    const cmUsers = users.filter((u) => u.role === 'CM');
    return cmUsers.map((cm) => {
      const cmTxs = transactions.filter(
        (tx) => tx.cmId === cm.id && tx.status !== 'REJECTED'
      );
      const volume = cmTxs.reduce((s, t) => s + t.amount, 0);
      const agCommission = cmTxs.reduce((s, t) => s + calcExpectedAgCommission(t), 0);
      const cmCommission = cmTxs.reduce((s, t) => s + calcExpectedCommission(t), 0);
      return {
        cm,
        txCount: cmTxs.length,
        volume,
        agCommission,
        cmCommission,
      };
    });
  }, [transactions, users]);

  const recentFeed = useMemo(() => {
    const allLogs = transactions.flatMap((tx) =>
      tx.history.map((h) => ({
        ...h,
        txId: tx.id,
        txStatus: tx.status,
        customerName: tx.customerName,
        cardCompany: tx.cardCompany,
        amount: tx.amount,
      }))
    );
    return allLogs.sort((a, b) => b.changedAt.localeCompare(a.changedAt)).slice(0, 8);
  }, [transactions]);

  if (!currentUser) return null;

  if (currentUser.role !== 'ADMIN') {
    return (
      <div className="mx-auto max-w-xl rounded-2xl border border-rose-200 bg-white p-8 text-center shadow-sm">
        <ShieldAlert className="mx-auto h-10 w-10 text-rose-500" />
        <h2 className="mt-3 text-lg font-bold text-slate-900">본사 운영 관리자 전용 화면입니다</h2>
        <p className="mt-1.5 text-xs text-slate-600">
          전체 운영 KPI 및 통합 모니터링은 운영 관리자 계정에서만 접근할 수 있습니다.
        </p>
        <Link
          to="/transactions"
          className="mt-5 inline-flex rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white"
        >
          내 업무 홈으로 이동
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-slate-900">
            카나다라 본사 운영 총괄 관리자 홈
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            전사 거래의 <strong>AG 수수료 금액</strong>과 <strong>CM 수수료 금액</strong>을 동시에 조회하고, 요율표(이미지·데이터 표) 및 시트 연동을 총괄 관리합니다.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setShowRateManager((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-extrabold text-white shadow-sm hover:bg-emerald-700"
          >
            <FileSpreadsheet className="h-4 w-4" />
            {showRateManager ? '요율표 관리 패널 접기' : '요율표 (이미지·데이터) 추가/관리'}
          </button>
          <Link
            to="/settlements"
            className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-extrabold text-white shadow-sm hover:bg-indigo-700"
          >
            <Calculator className="h-4 w-4" />
            월별 수수료 정산·추출
          </Link>
          <Link
            to="/transactions"
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
          >
            <FileText className="h-4 w-4" />
            거래 승인요청 · 전체 목록
          </Link>
        </div>
      </div>

      {/* Admin 요율표 이미지/데이터 추가 패널 */}
      {showRateManager && (
        <RateTablePanel onCloseSplit={() => setShowRateManager(false)} />
      )}

      {/* =====================================================================
          핵심 요구사항 #5: 관리자홈에서 CM 수수료 금액과 함께 AG 수수료 금액 동시 조회 배너
         ===================================================================== */}
      <div className="rounded-2xl bg-slate-900 border border-slate-800 p-6 text-white shadow-lg">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-4 border-b border-white/10">
          <div className="flex items-center gap-2">
            <Coins className="h-5 w-5 text-amber-300" />
            <h2 className="text-base font-extrabold">
              전사 AG 수수료 금액 &amp; CM 수수료 금액 통합 현황 (반려 제외 총 {metrics.activeCount}건)
            </h2>
          </div>
          <span className="text-xs text-slate-300">
            총 결제 취급액: <strong className="text-white">{formatKRW(metrics.totalVolume)}</strong> · 고객 일시불 캐시백 합계: <strong className="text-sky-300">{formatKRW(metrics.totalCashback)}</strong>
          </span>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
          {/* 1. AG 수수료 금액 */}
          <div className="rounded-xl bg-slate-800/90 border border-slate-700 p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-200">
                총 AG 수수료 금액 (AG 몫 합계)
              </span>
              <span className="rounded bg-sky-500/20 px-2 py-0.5 text-xs font-bold text-sky-200">
                AG COMMISSION
              </span>
            </div>
            <p className="mt-2 text-2xl font-black text-sky-300 tabular-nums">
              {formatKRW(metrics.totalAgCommission)}
            </p>
            <div className="mt-2.5 flex items-center justify-between text-xs text-slate-300 pt-2 border-t border-white/10">
              <span>승인·완료 확정분: <strong className="text-white">{formatKRW(metrics.confirmedAgCommission)}</strong></span>
              <span>대기·심사중: <strong className="text-amber-200">{formatKRW(metrics.pendingAgCommission)}</strong></span>
            </div>
          </div>

          {/* 2. CM 수수료 금액 */}
          <div className="rounded-xl bg-emerald-500/15 border border-emerald-400/30 p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-emerald-200">
                총 CM 수수료 금액 (CM 지급 합계)
              </span>
              <span className="rounded bg-emerald-500/30 px-2 py-0.5 text-[10px] font-extrabold text-emerald-200">
                CM COMMISSION
              </span>
            </div>
            <p className="mt-2 text-2xl font-black text-emerald-300 tabular-nums">
              {formatKRW(metrics.totalCmCommission)}
            </p>
            <div className="mt-2.5 flex items-center justify-between text-xs text-slate-300 pt-2 border-t border-white/10">
              <span>승인·완료 확정분: <strong className="text-white">{formatKRW(metrics.confirmedCmCommission)}</strong></span>
              <span>대기·심사중: <strong className="text-amber-200">{formatKRW(metrics.pendingCmCommission)}</strong></span>
            </div>
          </div>

          {/* 3. AG + CM 총 수수료 합산 */}
          <div className="rounded-xl bg-white/10 border border-white/15 p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-amber-200">
                AG + CM 수수료 총 합산액
              </span>
              <span className="rounded bg-amber-500/30 px-2 py-0.5 text-[10px] font-extrabold text-amber-200">
                TOTAL (AG + CM)
              </span>
            </div>
            <p className="mt-2 text-2xl font-black text-amber-300 tabular-nums">
              {formatKRW(metrics.totalAgCommission + metrics.totalCmCommission)}
            </p>
            <div className="mt-2.5 flex items-center justify-between text-xs text-slate-300 pt-2 border-t border-white/10">
              <span>
                확정 합산:{' '}
                <strong className="text-white">
                  {formatKRW(metrics.confirmedAgCommission + metrics.confirmedCmCommission)}
                </strong>
              </span>
              <span>
                AG-CM 차익:{' '}
                <strong className="text-sky-300">
                  {formatKRW(metrics.totalAgCommission - metrics.totalCmCommission)}
                </strong>
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* AG별 / CM별 수수료 금액 동시 비교 표 */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* AG별 AG수수료 & CM수수료 집계 */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div>
              <h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-1.5">
                <Layers className="h-4 w-4 text-indigo-600" />
                담당 AG별 수수료 집계 (AG 수수료 + CM 수수료)
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                각 AG가 취급한 거래의 AG 수수료 금액과 산하 CM 수수료 금액입니다.
              </p>
            </div>
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold text-slate-600">
                  <th className="py-2.5 px-3">담당 AG</th>
                  <th className="py-2.5 px-2 text-right">건수</th>
                  <th className="py-2.5 px-2.5 text-right">취급 결제금액</th>
                  <th className="py-2.5 px-2.5 text-right text-indigo-700 bg-indigo-50/50">
                    AG 수수료 금액
                  </th>
                  <th className="py-2.5 px-2.5 text-right text-emerald-700 bg-emerald-50/50">
                    CM 수수료 금액
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {agBreakdown.map((row) => (
                  <tr key={row.ag.id} className="hover:bg-slate-50">
                    <td className="py-2.5 px-3">
                      <div className="font-bold text-slate-900">{row.ag.name}</div>
                      <div className="text-[11px] text-slate-500">{row.ag.affiliation}</div>
                    </td>
                    <td className="py-2.5 px-2 text-right font-bold tabular-nums">
                      {row.txCount}건
                    </td>
                    <td className="py-2.5 px-2.5 text-right font-semibold tabular-nums">
                      {formatKRW(row.volume)}
                    </td>
                    <td className="py-2.5 px-2.5 text-right font-extrabold text-indigo-700 bg-indigo-50/30 tabular-nums">
                      {formatKRW(row.agCommission)}
                    </td>
                    <td className="py-2.5 px-2.5 text-right font-extrabold text-emerald-700 bg-emerald-50/30 tabular-nums">
                      {formatKRW(row.cmCommission)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* CM별 CM수수료 & AG수수료 비교 집계 */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div>
              <h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-1.5">
                <Users className="h-4 w-4 text-emerald-600" />
                CM별 수수료 집계 (CM 수수료 + 발생 AG 수수료)
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                각 CM 거래에서 발생한 CM 지급 수수료와 본사/AG 측 수수료 금액 비교입니다.
              </p>
            </div>
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold text-slate-600">
                  <th className="py-2.5 px-3">CM (소속 · 사번)</th>
                  <th className="py-2.5 px-2 text-right">건수</th>
                  <th className="py-2.5 px-2.5 text-right">취급 결제금액</th>
                  <th className="py-2.5 px-2.5 text-right text-indigo-700 bg-indigo-50/50">
                    AG 수수료 금액
                  </th>
                  <th className="py-2.5 px-2.5 text-right text-emerald-700 bg-emerald-50/50">
                    CM 수수료 금액
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {cmBreakdown.map((row) => (
                  <tr key={row.cm.id} className="hover:bg-slate-50">
                    <td className="py-2.5 px-3">
                      <div className="font-bold text-slate-900">
                        {row.cm.name}{' '}
                        <span className="font-mono text-[10px] text-indigo-600">
                          ({row.cm.employeeId})
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500">{row.cm.affiliation}</div>
                    </td>
                    <td className="py-2.5 px-2 text-right font-bold tabular-nums">
                      {row.txCount}건
                    </td>
                    <td className="py-2.5 px-2.5 text-right font-semibold tabular-nums">
                      {formatKRW(row.volume)}
                    </td>
                    <td className="py-2.5 px-2.5 text-right font-extrabold text-indigo-700 bg-indigo-50/30 tabular-nums">
                      {formatKRW(row.agCommission)}
                    </td>
                    <td className="py-2.5 px-2.5 text-right font-extrabold text-emerald-700 bg-emerald-50/30 tabular-nums">
                      {formatKRW(row.cmCommission)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Core Operational KPI Cards */}
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">승인·완료 거래 총액</span>
            <TrendingUp className="h-4 w-4 text-indigo-600" />
          </div>
          <p className="mt-2 text-2xl font-extrabold tabular-nums text-slate-900">
            {formatKRW(metrics.confirmedVolume)}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            확정 {metrics.confirmedCount}건 / 대기·심사중 {metrics.pendingCount}건
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">
              구글 시트 자동입력 성공률
            </span>
            <FileSpreadsheet className="h-4 w-4 text-teal-600" />
          </div>
          <p className="mt-2 text-2xl font-extrabold tabular-nums text-teal-700">
            {metrics.sheetSuccessRate}%
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {metrics.failedSlipsCount > 0 ? (
              <Link to="/sheets-sync" className="font-semibold text-rose-600 hover:underline">
                재처리 필요 {metrics.failedSlipsCount}건 확인 →
              </Link>
            ) : (
              <span className="text-emerald-600 font-medium">수기 재입력 0건 · 전체 정상</span>
            )}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">월간 활성 CM · AG / 정산점검</span>
            {metrics.missingCommissionCount > 0 ? (
              <AlertTriangle className="h-4 w-4 text-amber-500" />
            ) : (
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            )}
          </div>
          <p className="mt-2 text-2xl font-extrabold tabular-nums text-slate-900">
            CM {metrics.activeCms}명 · AG {metrics.activeAgs}명
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {metrics.missingCommissionCount > 0 ? (
              <Link to="/settlements" className="font-semibold text-amber-700 hover:underline">
                정산 산정기준 확정 필요 {metrics.missingCommissionCount}건 →
              </Link>
            ) : (
              <span>정산 오류·누락 0건</span>
            )}
          </p>
        </div>
      </div>

      {/* Operations Quick Cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Link
          to="/admin/users"
          className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm hover:border-indigo-400 transition-all"
        >
          <div className="flex items-center justify-between">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
              <Users className="h-5 w-5" />
            </div>
            <ChevronRight className="h-4 w-4 text-slate-400 group-hover:text-indigo-600" />
          </div>
          <h3 className="mt-3 text-base font-bold text-slate-900">
            사용자 · CM 등록정보 관리
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            CM 등록 시 저장되는 이름, 주민등록번호, 사업자등록번호, 전화번호, 소속, 사번 데이터를 관리합니다.
          </p>
        </Link>

        <Link
          to="/admin/assignments"
          className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm hover:border-indigo-400 transition-all"
        >
          <div className="flex items-center justify-between">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-50 text-purple-600">
              <Link2 className="h-5 w-5" />
            </div>
            <ChevronRight className="h-4 w-4 text-slate-400 group-hover:text-indigo-600" />
          </div>
          <h3 className="mt-3 text-base font-bold text-slate-900">AG별 담당 CM 배정 관리</h3>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            AG와 CM 사이의 담당 관계를 설정합니다. 변경 시 AG 거래승인 요청 폼의 CM 목록에 즉시 반영됩니다.
          </p>
        </Link>

        <Link
          to="/admin/conditions"
          className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm hover:border-indigo-400 transition-all"
        >
          <div className="flex items-center justify-between">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
              <Sliders className="h-5 w-5" />
            </div>
            <ChevronRight className="h-4 w-4 text-slate-400 group-hover:text-indigo-600" />
          </div>
          <h3 className="mt-3 text-base font-bold text-slate-900">
            카드사 · 거래 방법별 조건 관리
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            현재 활성 조건 {conditions.filter((c) => c.isActive).length}개 운영 중. 구글 시트 마스터와 연동하여 실행일자를 관리합니다.
          </p>
        </Link>
      </div>

      {/* Live Audit Feed */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 pb-4">
          <div>
            <h2 className="text-base font-bold text-slate-900">실시간 전사 거래 · 승인 이력 로그</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              AG 거래 승인 요청 등록, 6단계 상태 변경, 전표 제출 및 구글 시트 자동입력 최신 활동입니다.
            </p>
          </div>
          <Link
            to="/transactions"
            className="text-xs font-semibold text-indigo-600 hover:text-indigo-800"
          >
            전체 거래 목록 보기 →
          </Link>
        </div>

        <div className="mt-4 divide-y divide-slate-100">
          {recentFeed.map((log) => (
            <div
              key={`${log.txId}-${log.id}`}
              className="flex flex-col justify-between gap-2 py-3 text-xs sm:flex-row sm:items-center"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-slate-400">{log.changedAt}</span>
                <RoleBadge role={log.actorRole} short />
                <span className="font-bold text-slate-800">{log.actorName}</span>
                <span className="text-slate-600">{log.actionLabel}</span>
                <Link
                  to={`/transactions/${log.txId}`}
                  className="font-mono font-bold text-indigo-600 hover:underline"
                >
                  [{log.txId}]
                </Link>
                <span className="text-slate-500">
                  {log.cardCompany} · {formatKRW(log.amount)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <ApprovalStatusBadge status={log.txStatus} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
