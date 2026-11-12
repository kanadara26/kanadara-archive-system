import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import {
  APPROVAL_STATUS_META,
  CARD_COMPANY_COLORS,
  SETTLEMENT_PROGRESS_STATUS_META,
  SettlementFlags,
  StatusPatch,
  Transaction,
  V2_CARD_DISPLAY_NAMES,
  V2_CARD_LOGO_URLS,
  V2_PROGRESS_STATUS_LIST,
  applyStatusPatch,
  normalizeV2ProgressStatus,
  settlementFlagsOf,
} from '../../types';
import { calcSplitTotals, formatKRW } from '../../utils/format';
import {
  ArrowRight,
  Check,
  CheckSquare,
  Edit3,
  FilePlus2,
  FolderOpen,
  MessageSquareText,
  RotateCcw,
  Search,
  Square,
  Trash2,
  X,
} from 'lucide-react';

type ProgressFilter = 'ALL' | 'WAITING' | 'APPROVED' | 'REJECTED';
// 정산 필터는 플래그 기준 (정산 완료+지급 완료 거래는 두 필터 모두에 나옴)
type SettlementFilter = 'ALL' | 'PENDING' | keyof SettlementFlags;

const SETTLEMENT_FILTERS: { key: Exclude<SettlementFilter, 'ALL'>; label: string; dot: string }[] = [
  { key: 'PENDING', label: '정산 대기', dot: SETTLEMENT_PROGRESS_STATUS_META['정산 대기'].dotClass },
  { key: 'settled', label: '정산 완료', dot: SETTLEMENT_PROGRESS_STATUS_META['정산 완료'].dotClass },
  { key: 'paid', label: '지급 완료(CM)', dot: SETTLEMENT_PROGRESS_STATUS_META['지급 완료(CM)'].dotClass },
];

const matchesSettlement = (tx: Transaction, f: SettlementFilter) => {
  if (f === 'ALL') return true;
  const flags = settlementFlagsOf(tx.settlementStatus);
  return f === 'PENDING' ? !flags.settled && !flags.paid : flags[f];
};

const pct = (n: number) => `${Number(n.toFixed(2))}%`;

const methodSummaryOf = (tx: Transaction) =>
  tx.paymentSplits.length > 1
    ? `혼합 (${tx.paymentSplits.length}건)`
    : tx.paymentSplits[0]?.paymentMethod === '다이렉트할부'
    ? '다이렉트'
    : tx.paymentSplits[0]?.paymentMethod || '일시불';

export const DashboardPageV2: React.FC = () => {
  const {
    currentUser,
    users,
    transactions,
    draftsV2,
    deleteDraftV2,
    setPendingDraftIdV2,
    setEditingTxIdV2,
    quickChangeTransactionStatus,
    bulkUpdateTransactionsV2,
    resolveRollbackRequest,
    isWideMode,
  } = useApp();
  const navigate = useNavigate();

  const [isDraftListOpen, setIsDraftListOpen] = useState<boolean>(false);
  const [statusFilter, setStatusFilter] = useState<ProgressFilter>('ALL');
  const [settlementFilter, setSettlementFilter] = useState<SettlementFilter>('ALL');
  const [agFilter, setAgFilter] = useState<string>('ALL');
  const [searchKeyword, setSearchKeyword] = useState<string>('');
  const [selectedTxId, setSelectedTxId] = useState<string | null>(null);
  const [selectedTxIds, setSelectedTxIds] = useState<string[]>([]);
  const [isRollbackListOpen, setIsRollbackListOpen] = useState<boolean>(false);
  // 되돌리기 사유 입력 대기 중인 변경
  const [pendingChange, setPendingChange] = useState<{ ids: string[]; patch: StatusPatch } | null>(null);
  const [reasonText, setReasonText] = useState<string>('');

  const anchorIdRef = useRef<string | null>(null); // Shift 범위 선택 기준
  const dragModeRef = useRef<'add' | 'remove' | null>(null); // 체크박스 드래그 선택

  const suppressRowClickRef = useRef(false); // 체크박스에서 시작한 드래그가 행 클릭(상세 열기)으로 이어지지 않게

  useEffect(() => {
    const stopDrag = () => {
      dragModeRef.current = null;
      setTimeout(() => (suppressRowClickRef.current = false), 0);
    };
    window.addEventListener('mouseup', stopDrag);
    return () => window.removeEventListener('mouseup', stopDrag);
  }, []);

  const isAdmin = currentUser?.role === 'ADMIN';
  const isAg = currentUser?.role === 'AG';
  const agUsers = useMemo(() => users.filter((u) => u.role === 'AG' || u.role === 'ADMIN'), [users]);

  // AG는 본인 등록건, 어드민은 전체 또는 특정 AG
  const myTransactions = useMemo(() => {
    if (!currentUser) return [];
    const base = !isAdmin
      ? transactions.filter((tx) => tx.agId === currentUser.id)
      : agFilter !== 'ALL'
      ? transactions.filter((tx) => tx.agId === agFilter)
      : transactions;
    return [...base].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [transactions, currentUser, isAdmin, agFilter]);

  const rollbackRequests = useMemo(() => myTransactions.filter((tx) => tx.rollbackRequest), [myTransactions]);

  const statusCounts = useMemo(() => {
    const counts: Record<ProgressFilter, number> = { ALL: myTransactions.length, WAITING: 0, APPROVED: 0, REJECTED: 0 };
    myTransactions.forEach((tx) => counts[normalizeV2ProgressStatus(tx.status)]++);
    return counts;
  }, [myTransactions]);

  const settlementCounts = useMemo(() => {
    const counts = { ALL: myTransactions.length } as Record<SettlementFilter, number>;
    SETTLEMENT_FILTERS.forEach((f) => (counts[f.key] = myTransactions.filter((tx) => matchesSettlement(tx, f.key)).length));
    return counts;
  }, [myTransactions]);

  const filteredList = useMemo(() => {
    const kw = searchKeyword.trim().toLowerCase();
    return myTransactions.filter((tx) => {
      if (statusFilter !== 'ALL' && normalizeV2ProgressStatus(tx.status) !== statusFilter) return false;
      if (!matchesSettlement(tx, settlementFilter)) return false;
      if (kw) {
        const cardName = V2_CARD_DISPLAY_NAMES[tx.paymentSplits[0]?.cardCompany || '제휴카드사(삼성)'];
        const haystack = [tx.id, tx.customerName, tx.cmProfile.name, tx.cmProfile.affiliation, cardName, tx.requestMemo || '']
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(kw)) return false;
      }
      return true;
    });
  }, [myTransactions, statusFilter, settlementFilter, searchKeyword]);

  // 필터를 바꾸면 선택은 초기화
  const withClear = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setSelectedTxIds([]);
    anchorIdRef.current = null;
  };
  const changeStatusFilter = withClear(setStatusFilter);
  const changeSettlementFilter = withClear(setSettlementFilter);
  const changeAgFilter = withClear(setAgFilter);
  const changeSearch = withClear(setSearchKeyword);

  // 전체 선택 = 현재 필터에 보이는 거래만
  const isAllFilteredSelected =
    filteredList.length > 0 && filteredList.every((tx) => selectedTxIds.includes(tx.id));
  const handleToggleSelectAll = () =>
    setSelectedTxIds(isAllFilteredSelected ? [] : filteredList.map((t) => t.id));

  const setChecked = (txId: string, on: boolean) =>
    setSelectedTxIds((prev) => (on ? (prev.includes(txId) ? prev : [...prev, txId]) : prev.filter((id) => id !== txId)));

  // Shift+클릭: 기준 거래부터 현재 거래까지 모두 선택
  const selectRangeTo = (txId: string) => {
    const ids = filteredList.map((t) => t.id);
    const from = anchorIdRef.current ? ids.indexOf(anchorIdRef.current) : -1;
    const to = ids.indexOf(txId);
    if (from === -1 || to === -1) {
      setChecked(txId, true);
    } else {
      const range = ids.slice(Math.min(from, to), Math.max(from, to) + 1);
      setSelectedTxIds((prev) => Array.from(new Set([...prev, ...range])));
    }
    anchorIdRef.current = txId;
  };

  const checkboxHandlers = (txId: string, isChecked: boolean) => ({
    onMouseDown: (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      e.preventDefault(); // 드래그 중 글자 선택 방지
      e.stopPropagation();
      suppressRowClickRef.current = true;
      if (e.shiftKey) return selectRangeTo(txId);
      dragModeRef.current = isChecked ? 'remove' : 'add';
      setChecked(txId, !isChecked);
      anchorIdRef.current = txId;
    },
    onClick: (e: React.MouseEvent) => {
      e.stopPropagation();
      // 마우스는 mousedown에서 처리, 키보드(Enter/Space)만 여기서 처리
      if (e.detail === 0) {
        setChecked(txId, !isChecked);
        anchorIdRef.current = txId;
      }
    },
  });

  const rowHandlers = (txId: string) => ({
    onMouseEnter: () => {
      if (dragModeRef.current) setChecked(txId, dragModeRef.current === 'add');
    },
    onClick: (e: React.MouseEvent) => {
      if (suppressRowClickRef.current) return;
      if (e.shiftKey) {
        e.preventDefault();
        selectRangeTo(txId);
        return;
      }
      setSelectedTxId(txId);
    },
  });

  const hasSelection = selectedTxIds.length > 0;
  const selectedTxs = useMemo(
    () => transactions.filter((t) => selectedTxIds.includes(t.id)),
    [transactions, selectedTxIds]
  );
  const allSelectedHave = (flag: keyof SettlementFlags) =>
    selectedTxs.length > 0 && selectedTxs.every((t) => settlementFlagsOf(t.settlementStatus)[flag]);

  // 상태 변경: 되돌리기가 섞여 있으면 사유부터 받음
  const requestChange = (ids: string[], patch: StatusPatch) => {
    const isRollback = transactions.some(
      (t) => ids.includes(t.id) && (() => {
        const r = applyStatusPatch(t, patch);
        return r.changed && r.isRollback;
      })()
    );
    if (isRollback) {
      setReasonText('');
      setPendingChange({ ids, patch });
      return;
    }
    bulkUpdateTransactionsV2(ids, patch);
  };

  const confirmRollback = () => {
    if (!pendingChange || !reasonText.trim()) return;
    const res = bulkUpdateTransactionsV2(pendingChange.ids, pendingChange.patch, reasonText);
    if (res.ok) setPendingChange(null);
  };

  const handleStartNewRegister = () => {
    setEditingTxIdV2(null);
    setPendingDraftIdV2(null);
    navigate('/v2/register');
  };

  const handleLoadDraftToRegister = (draftId: string) => {
    setEditingTxIdV2(null);
    setPendingDraftIdV2(draftId);
    navigate('/v2/register');
  };

  const currentModalTx = selectedTxId ? transactions.find((t) => t.id === selectedTxId) || null : null;

  const commissionText = (calc: ReturnType<typeof calcSplitTotals>) =>
    isAg
      ? `CM ${pct(calc.effectiveCmRate)} · AG ${pct(calc.effectiveAgRate)}`
      : `CM ${formatKRW(calc.totalCmCommission)} · AG ${formatKRW(calc.totalAgCommission)}`;

  const statusBadges = (tx: Transaction) => {
    const statusMeta = APPROVAL_STATUS_META[normalizeV2ProgressStatus(tx.status)];
    const settlementMeta = SETTLEMENT_PROGRESS_STATUS_META[tx.settlementStatus || '정산 대기'];
    return (
      <>
        <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-extrabold ${statusMeta.badgeClass}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${statusMeta.dotClass}`} />
          {statusMeta.label}
        </span>
        <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-extrabold ${settlementMeta.badgeClass}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${settlementMeta.dotClass}`} />
          {settlementMeta.label}
        </span>
        {tx.rollbackRequest && (
          <span
            title={`${tx.rollbackRequest.summary} · 사유: ${tx.rollbackRequest.reason}`}
            className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-amber-50 px-2.5 py-1 text-xs font-extrabold text-amber-800 ring-1 ring-inset ring-amber-600/30"
          >
            <RotateCcw className="h-3 w-3" />
            되돌리기 승인 대기
          </span>
        )}
      </>
    );
  };

  const cardChip = (tx: Transaction) => {
    const cardKey = tx.paymentSplits[0]?.cardCompany || '제휴카드사(삼성)';
    const logo = V2_CARD_LOGO_URLS[cardKey];
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-extrabold text-slate-900">
        {logo ? (
          <img src={logo} alt="" className="h-4 w-4 object-contain" />
        ) : (
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: CARD_COMPANY_COLORS[cardKey].mainHex }} />
        )}
        {V2_CARD_DISPLAY_NAMES[cardKey]}
      </span>
    );
  };

  const checkbox = (tx: Transaction, isChecked: boolean) => (
    <button
      type="button"
      aria-label={`${tx.customerName} 거래 선택`}
      aria-pressed={isChecked}
      title="클릭해 선택 · 누른 채 끌어 여러 건 선택 · Shift+클릭으로 범위 선택"
      {...checkboxHandlers(tx.id, isChecked)}
      className={`flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md border transition-colors ${
        isChecked ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-transparent hover:border-slate-500'
      }`}
    >
      <Check className="h-3.5 w-3.5 stroke-[3]" />
    </button>
  );

  const filterBtn = (active: boolean) =>
    `inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold border transition-colors tabular-nums ${
      active ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
    }`;

  const segBtn = (pressed: boolean) =>
    `inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-bold transition-colors ${
      pressed ? 'bg-slate-900 text-white shadow-2xs' : 'text-slate-700 hover:bg-white hover:text-slate-900 hover:shadow-2xs'
    }`;

  // 진행상황 버튼 3개 + 정산 버튼 3개 (정산 완료·지급 완료는 각각 켜고 끄는 토글)
  const statusControls = (ids: string[], txs: Transaction[]) => {
    const progressOf = (st: string) => txs.length > 0 && txs.every((t) => normalizeV2ProgressStatus(t.status) === st);
    const has = (flag: keyof SettlementFlags) =>
      txs.length > 0 && txs.every((t) => settlementFlagsOf(t.settlementStatus)[flag]);
    const allPending = txs.length > 0 && txs.every((t) => matchesSettlement(t, 'PENDING'));
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
          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-0.5">
            <button
              type="button"
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
                aria-pressed={has(flag)}
                title="정산 완료와 지급 완료는 함께 선택할 수 있습니다"
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

  return (
    <div className="space-y-6">
      {/* 1. 상단 메인 액션: 거래 승인건 등록 / 불러오기 */}
      <section className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <button
            type="button"
            onClick={handleStartNewRegister}
            className="group flex items-center justify-between rounded-2xl bg-slate-900 p-5 sm:p-6 text-left text-white shadow-sm hover:bg-slate-800 transition-all"
          >
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/10 text-white">
                <FilePlus2 className="h-6 w-6" />
              </div>
              <div>
                <span className="text-base sm:text-lg font-extrabold tracking-tight block">거래 승인건 등록</span>
                <span className="text-xs text-slate-300 mt-0.5 block">카드사·결제방법 선택 후 결제 및 고객/CM 정보 입력</span>
              </div>
            </div>
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 group-hover:translate-x-0.5 transition-transform">
              <ArrowRight className="h-4 w-4" />
            </div>
          </button>

          <button
            type="button"
            onClick={() => setIsDraftListOpen((prev) => !prev)}
            className={`group flex items-center justify-between rounded-2xl border p-5 sm:p-6 text-left transition-all ${
              isDraftListOpen
                ? 'border-slate-900 bg-slate-100 text-slate-900'
                : 'border-slate-200 bg-white text-slate-900 hover:border-slate-400 shadow-2xs'
            }`}
          >
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 text-slate-800 border border-slate-200">
                <FolderOpen className="h-6 w-6" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-base sm:text-lg font-extrabold tracking-tight">불러오기</span>
                  <span className="rounded-full bg-slate-900 px-2.5 py-0.5 text-xs font-extrabold text-white tabular-nums">
                    {draftsV2.length}건
                  </span>
                </div>
                <span className="text-xs text-slate-500 mt-0.5 block">임시 저장해 둔 작성 중인 거래 승인건을 이어서 작성합니다</span>
              </div>
            </div>
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-700">
              <ArrowRight className="h-4 w-4" />
            </div>
          </button>
        </div>

        {isDraftListOpen && (
          <div className="rounded-2xl border border-slate-300 bg-white p-5 shadow-sm space-y-3">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h2 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
                <FolderOpen className="h-4 w-4 text-slate-700" />
                임시 저장된 거래 불러오기 ({draftsV2.length}건)
              </h2>
              <button
                type="button"
                aria-label="닫기"
                onClick={() => setIsDraftListOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {draftsV2.length === 0 ? (
              <div className="py-8 text-center space-y-2">
                <p className="text-xs font-bold text-slate-500">현재 임시 저장된 거래 내역이 없습니다.</p>
                <p className="text-xs text-slate-400">
                  [거래 승인건 등록] 중 상단의 [임시 저장] 버튼을 누르면 이곳에서 언제든 다시 불러올 수 있습니다.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100 max-h-64 overflow-y-auto">
                {draftsV2.map((draft) => (
                  <div key={draft.id} className="flex items-center justify-between gap-3 py-3 px-2 hover:bg-slate-50 rounded-xl transition-colors">
                    <button type="button" onClick={() => handleLoadDraftToRegister(draft.id)} className="flex-1 text-left">
                      <p className="text-xs sm:text-sm font-extrabold text-slate-900">{draft.title}</p>
                      <p className="text-[11px] text-slate-400 mt-0.5 font-mono">
                        저장 시각: {draft.savedAt} · 작성 단계: {draft.activeStep}단계
                      </p>
                    </button>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleLoadDraftToRegister(draft.id)}
                        className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-800"
                      >
                        불러오기
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteDraftV2(draft.id)}
                        className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                        title="임시저장 삭제"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {/* 2. 등록한 거래 승인건 */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-100 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-extrabold text-slate-900">등록한 거래 승인건 및 진행 · 정산상황</h2>
              <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-700 tabular-nums">
                총 {myTransactions.length}건
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              체크박스를 누르거나 끌어서, 또는 Shift+클릭으로 여러 건을 선택하면 상태 변경 바가 나타납니다.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {isAdmin && (
              <select
                aria-label="등록 AG 계정 필터"
                value={agFilter}
                onChange={(e) => changeAgFilter(e.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-800 focus:border-slate-900 focus:outline-none"
              >
                <option value="ALL">등록 계정: 전체 AG 보기</option>
                {agUsers.map((ag) => (
                  <option key={ag.id} value={ag.id}>
                    담당: {ag.name} ({ag.role})
                  </option>
                ))}
              </select>
            )}

            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                lang="ko"
                value={searchKeyword}
                onChange={(e) => changeSearch(e.target.value)}
                placeholder="고객명, 거래번호, CM, 비고 검색..."
                className="w-52 sm:w-64 rounded-lg border border-slate-300 bg-white pl-8 pr-7 py-2 text-xs font-semibold text-slate-900 focus:border-slate-900 focus:outline-none"
              />
              {searchKeyword && (
                <button
                  type="button"
                  aria-label="검색어 지우기"
                  onClick={() => changeSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ADMIN: AG가 요청한 되돌리기 승인 */}
        {isAdmin && rollbackRequests.length > 0 && (
          <div className="rounded-xl border border-amber-300 bg-amber-50/70">
            <button
              type="button"
              onClick={() => setIsRollbackListOpen((v) => !v)}
              className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
            >
              <span className="flex items-center gap-2 text-sm font-extrabold text-amber-900">
                <RotateCcw className="h-4 w-4" />
                되돌리기 승인 요청 {rollbackRequests.length}건
              </span>
              <span className="text-xs font-bold text-amber-800 underline">{isRollbackListOpen ? '접기' : '확인하기'}</span>
            </button>
            {isRollbackListOpen && (
              <div className="divide-y divide-amber-200 border-t border-amber-200">
                {rollbackRequests.map((tx) => (
                  <div key={tx.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0 text-xs">
                      <p className="font-extrabold text-slate-900">
                        {tx.customerName} 고객 · <span className="font-mono text-slate-500">{tx.id}</span>
                      </p>
                      <p className="text-slate-700">{tx.rollbackRequest!.summary}</p>
                      <p className="text-slate-500">
                        {tx.rollbackRequest!.requestedByName} · {tx.rollbackRequest!.requestedAt} · 사유: {tx.rollbackRequest!.reason}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-1.5">
                      <button
                        type="button"
                        onClick={() => resolveRollbackRequest(tx.id, true)}
                        className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-800"
                      >
                        승인
                      </button>
                      <button
                        type="button"
                        onClick={() => resolveRollbackRequest(tx.id, false)}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100"
                      >
                        거절
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 필터: 진행상황 + 정산상황 (바꾸면 선택 초기화) */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-extrabold text-slate-500 mr-1">진행상황</span>
            <button type="button" onClick={() => changeStatusFilter('ALL')} className={filterBtn(statusFilter === 'ALL')}>
              전체 ({statusCounts.ALL})
            </button>
            {V2_PROGRESS_STATUS_LIST.map((st) => (
              <button key={st} type="button" onClick={() => changeStatusFilter(st)} className={filterBtn(statusFilter === st)}>
                <span className={`h-1.5 w-1.5 rounded-full ${APPROVAL_STATUS_META[st].dotClass}`} />
                <span>{APPROVAL_STATUS_META[st].label}</span>
                <span>({statusCounts[st]})</span>
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-extrabold text-slate-500 mr-1">정산상황</span>
            <button type="button" onClick={() => changeSettlementFilter('ALL')} className={filterBtn(settlementFilter === 'ALL')}>
              전체 ({settlementCounts.ALL})
            </button>
            {SETTLEMENT_FILTERS.map((f) => (
              <button key={f.key} type="button" onClick={() => changeSettlementFilter(f.key)} className={filterBtn(settlementFilter === f.key)}>
                <span className={`h-1.5 w-1.5 rounded-full ${f.dot}`} />
                <span>{f.label}</span>
                <span>({settlementCounts[f.key]})</span>
              </button>
            ))}
          </div>
        </div>

        {/* 선택 줄: 전체 선택 + (선택했을 때만) 상단 고정 상태 변경 바 */}
        <div
          // 같은 여백을 항상 유지해 선택하는 순간 목록이 밀리지 않게 함 (드래그 선택 중 위치 고정)
          className={`-mx-5 border-y px-5 py-3 ${
            hasSelection
              ? 'sticky top-[65px] z-20 border-slate-200 bg-white/95 backdrop-blur-xs'
              : 'border-transparent'
          }`}
        >
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleToggleSelectAll}
                disabled={filteredList.length === 0}
                className="inline-flex items-center gap-2 whitespace-nowrap rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-extrabold text-slate-800 hover:bg-slate-100 disabled:opacity-40"
              >
                {isAllFilteredSelected ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                <span>
                  {isAllFilteredSelected ? '선택 해제' : `전체 선택${statusFilter !== 'ALL' || settlementFilter !== 'ALL' || searchKeyword ? ` (필터 ${filteredList.length}건)` : ''}`}
                </span>
              </button>
              {hasSelection && (
                <>
                  <span className="whitespace-nowrap text-xs font-bold tabular-nums text-slate-900">{selectedTxIds.length}건 선택됨</span>
                  {!isAllFilteredSelected && (
                    <button
                      type="button"
                      onClick={() => setSelectedTxIds([])}
                      className="whitespace-nowrap text-[11px] font-semibold text-slate-500 underline hover:text-slate-800"
                    >
                      해제
                    </button>
                  )}
                </>
              )}
            </div>
            {hasSelection && (
              <div className="lg:ml-auto">
                {statusControls(selectedTxIds, selectedTxs)}
              </div>
            )}
          </div>
          {hasSelection && isAg && (allSelectedHave('settled') || allSelectedHave('paid') || selectedTxs.some((t) => normalizeV2ProgressStatus(t.status) !== 'WAITING')) && (
            <p className="mt-2 text-[11px] text-slate-500">이전 단계로 되돌리는 변경은 사유를 적어 관리자 승인을 요청합니다.</p>
          )}
        </div>

        {/* 거래 목록 */}
        {filteredList.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 py-14 text-center space-y-2">
            <p className="text-sm font-bold text-slate-600">조회된 거래 승인건이 없습니다.</p>
            <p className="text-xs text-slate-400">상단의 [거래 승인건 등록] 버튼을 눌러 새 거래를 등록해 보세요.</p>
          </div>
        ) : isWideMode ? (
          // 넓게보기: 엑셀처럼 한 줄에 한 건
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full border-collapse select-none text-left text-xs">
              <thead>
                <tr className="border-y border-slate-200 bg-slate-50 text-[11px] font-bold text-slate-500">
                  <th className="w-10 py-2.5 pl-5 pr-2">
                    <span className="sr-only">선택</span>
                  </th>
                  <th className="whitespace-nowrap px-2 py-2.5">카드사</th>
                  <th className="whitespace-nowrap px-2 py-2.5">결제</th>
                  <th className="whitespace-nowrap px-2 py-2.5">고객</th>
                  <th className="whitespace-nowrap px-2 py-2.5">담당 CM</th>
                  <th className="whitespace-nowrap px-2 py-2.5">거래번호</th>
                  <th className="whitespace-nowrap px-2 py-2.5">작성일</th>
                  <th className="whitespace-nowrap px-2 py-2.5">승인일</th>
                  <th className="whitespace-nowrap px-2 py-2.5 text-right">금액</th>
                  <th className="whitespace-nowrap px-2 py-2.5 text-right">CM 수수료</th>
                  <th className="whitespace-nowrap px-2 py-2.5 text-right">AG 수수료</th>
                  <th className="whitespace-nowrap px-2 py-2.5">진행 · 정산</th>
                  <th className="px-2 py-2.5 pr-5">비고</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredList.map((tx) => {
                  const calc = calcSplitTotals(tx.paymentSplits, tx.appliedPromotions);
                  const isChecked = selectedTxIds.includes(tx.id);
                  return (
                    <tr
                      key={tx.id}
                      {...rowHandlers(tx.id)}
                      className={`cursor-pointer transition-colors ${isChecked ? 'bg-slate-100' : 'hover:bg-slate-50'}`}
                    >
                      <td className="py-2 pl-5 pr-2">
                        {checkbox(tx, isChecked)}
                      </td>
                      <td className="px-2 py-2">
                        {cardChip(tx)}
                      </td>
                      <td className="whitespace-nowrap px-2 py-2 font-semibold text-slate-600">{methodSummaryOf(tx)}</td>
                      <td className="whitespace-nowrap px-2 py-2 font-extrabold text-slate-900">{tx.customerName}</td>
                      <td className="whitespace-nowrap px-2 py-2 text-slate-700">
                        {tx.cmProfile.name}
                        {tx.cmProfile.affiliation && <span className="text-slate-400"> · {tx.cmProfile.affiliation}</span>}
                      </td>
                      <td className="whitespace-nowrap px-2 py-2 font-mono text-[11px] text-slate-400">{tx.id}</td>
                      <td className="whitespace-nowrap px-2 py-2 font-mono text-[11px] text-slate-500">{tx.requestDate}</td>
                      <td className="whitespace-nowrap px-2 py-2 font-mono text-[11px] font-bold text-slate-700">{tx.approvalDate || '-'}</td>
                      <td className="whitespace-nowrap px-2 py-2 text-right font-black tabular-nums text-slate-900">{formatKRW(calc.totalAmount)}</td>
                      <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums text-slate-700">
                        {isAg ? pct(calc.effectiveCmRate) : formatKRW(calc.totalCmCommission)}
                      </td>
                      <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums text-slate-700">
                        {isAg ? pct(calc.effectiveAgRate) : formatKRW(calc.totalAgCommission)}
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex gap-1">
                          {statusBadges(tx)}
                        </div>
                      </td>
                      <td className="max-w-[16rem] truncate px-2 py-2 pr-5 text-slate-500" title={tx.requestMemo}>
                        {normalizeV2ProgressStatus(tx.status) === 'REJECTED'
                          ? `반려: ${tx.rejectionReason || '심사 기준 미충족'}`
                          : tx.requestMemo || ''}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="space-y-3 select-none">
            {filteredList.map((tx) => {
              const calc = calcSplitTotals(tx.paymentSplits, tx.appliedPromotions);
              const isChecked = selectedTxIds.includes(tx.id);
              return (
                <div
                  key={tx.id}
                  {...rowHandlers(tx.id)}
                  className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors ${
                    isChecked ? 'border-slate-900 bg-slate-50 ring-1 ring-slate-900' : 'border-slate-200 bg-white hover:border-slate-400'
                  }`}
                >
                  <div className="mt-0.5">
                    {checkbox(tx, isChecked)}
                  </div>

                  <div className="min-w-0 flex-1 space-y-2.5">
                    <div className="flex flex-col gap-2.5 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0 space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          {cardChip(tx)}
                          <span className="whitespace-nowrap rounded-md bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-600">
                            {methodSummaryOf(tx)}
                          </span>
                          <span className="text-sm font-black text-slate-900">{tx.customerName} 고객</span>
                        </div>
                        <p className="text-xs text-slate-500">
                          담당 CM <strong className="font-bold text-slate-700">{tx.cmProfile.name}</strong>
                          {tx.cmProfile.affiliation && ` (${tx.cmProfile.affiliation})`}
                        </p>
                        <p className="font-mono text-[11px] text-slate-400">
                          {tx.id} · 작성 {tx.requestDate} · 승인{' '}
                          <span className={tx.approvalDate ? 'font-bold text-slate-700' : ''}>{tx.approvalDate || '대기'}</span>
                        </p>
                      </div>

                      <div className="flex shrink-0 flex-row-reverse items-center justify-between gap-2 sm:flex-col sm:items-end">
                        <div className="flex flex-wrap justify-end gap-1.5">
                          {statusBadges(tx)}
                        </div>
                        <div className="tabular-nums sm:text-right">
                          <span className="block text-sm font-black text-slate-900">{formatKRW(calc.totalAmount)}</span>
                          <span className="text-[11px] text-slate-500">{commissionText(calc)}</span>
                        </div>
                      </div>
                    </div>

                    {normalizeV2ProgressStatus(tx.status) === 'REJECTED' && (
                      <p className="text-xs font-bold text-rose-600">반려 사유: {tx.rejectionReason || '심사 기준 미충족'}</p>
                    )}

                    {tx.requestMemo && tx.requestMemo.trim() !== '' && (
                      <div className="flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700">
                        <MessageSquareText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                        <span>{tx.requestMemo}</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 3. 거래 상세 모달 */}
      {currentModalTx && (() => {
        const tx = currentModalTx;
        const total = calcSplitTotals(tx.paymentSplits, tx.appliedPromotions);
        const isApproved = normalizeV2ProgressStatus(tx.status) === 'APPROVED';
        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs"
            onClick={() => setSelectedTxId(null)}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-label={`${tx.customerName} 고객 거래 상세`}
              className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white shadow-xl overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-slate-200 bg-slate-900 px-5 py-4 text-white">
                <div>
                  <span className="text-[11px] font-mono text-slate-400 block">{tx.id}</span>
                  <h3 className="text-base font-extrabold">{tx.customerName} 고객 거래 상세</h3>
                </div>
                <button
                  type="button"
                  aria-label="닫기"
                  onClick={() => setSelectedTxId(null)}
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto text-xs">
                <div className="space-y-3 rounded-xl bg-slate-50 p-3.5 border border-slate-200">
                  <div className="flex flex-wrap gap-1.5">
                    {statusBadges(tx)}
                  </div>
                  {statusControls([tx.id], [tx])}
                </div>

                {tx.rollbackRequest && (
                  <div className="rounded-xl border border-amber-300 bg-amber-50 p-3.5 space-y-2">
                    <p className="font-extrabold text-amber-900">되돌리기 승인 대기: {tx.rollbackRequest.summary}</p>
                    <p className="text-amber-800">
                      {tx.rollbackRequest.requestedByName} · {tx.rollbackRequest.requestedAt} · 사유: {tx.rollbackRequest.reason}
                    </p>
                    {isAdmin && (
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          onClick={() => resolveRollbackRequest(tx.id, true)}
                          className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-800"
                        >
                          승인
                        </button>
                        <button
                          type="button"
                          onClick={() => resolveRollbackRequest(tx.id, false)}
                          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100"
                        >
                          거절
                        </button>
                      </div>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 rounded-xl border border-slate-200 p-3.5">
                  <div>
                    <span className="text-slate-400 block">고객명</span>
                    <span className="font-extrabold text-slate-900">{tx.customerName}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block">담당 CM</span>
                    <span className="font-bold text-slate-900">{tx.cmProfile.name}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block">작성일자</span>
                    <span className="font-mono font-bold text-slate-800">{tx.requestDate}</span>
                  </div>
                  <div>
                    <label htmlFor="modal-approval-date" className="text-slate-400 block">
                      승인일자{isAdmin && isApproved ? ' (수정 가능)' : ''}
                    </label>
                    {isAdmin && isApproved ? (
                      <input
                        id="modal-approval-date"
                        type="date"
                        value={tx.approvalDate}
                        onChange={(e) =>
                          e.target.value && quickChangeTransactionStatus(tx.id, tx.status, e.target.value, '관리자 승인일자 수정')
                        }
                        className="mt-0.5 w-full rounded-md border border-slate-300 bg-white px-1.5 py-1 font-mono text-xs font-bold text-slate-900"
                      />
                    ) : (
                      <span className="font-mono font-bold text-slate-900">{tx.approvalDate || '승인 대기 (미기록)'}</span>
                    )}
                  </div>
                </div>

                {tx.requestMemo && (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5">
                    <span className="text-slate-400 block mb-0.5">비고</span>
                    <p className="font-semibold text-slate-900">{tx.requestMemo}</p>
                  </div>
                )}

                <div className="rounded-xl border border-slate-200 p-3.5 space-y-2">
                  <h4 className="font-extrabold text-slate-900">결제 정보</h4>
                  {tx.paymentSplits.map((split, i) => {
                    const isLump = split.paymentMethod === '일시불';
                    const agAmt = Math.round((split.amount * split.agCommissionRate) / 100);
                    const cmAmt = Math.round((split.amount * split.cmCommissionRate) / 100);
                    return (
                      <div key={split.id || i} className="rounded-lg bg-slate-50 p-3 border border-slate-200/70 flex items-center justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-extrabold text-slate-900">
                              {V2_CARD_DISPLAY_NAMES[split.cardCompany]} ·{' '}
                              {split.paymentMethod === '다이렉트할부' ? '다이렉트' : split.paymentMethod} (
                              {isLump ? '1개월' : `${split.installmentMonths}개월`})
                            </span>
                            <span className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-700">
                              {split.rateCategory || '일반'}
                            </span>
                          </div>
                          <span className="text-[11px] text-slate-500 block mt-0.5">
                            {isLump ? `캐시백 ${split.cashbackRate}%` : `할부금리 ${split.interestRate}%`} · CM{' '}
                            {split.cmCommissionRate}% ({formatKRW(cmAmt)}) · AG {split.agCommissionRate}% ({formatKRW(agAmt)})
                          </span>
                        </div>
                        <span className="font-black text-slate-900 text-sm tabular-nums">{formatKRW(split.amount)}</span>
                      </div>
                    );
                  })}
                  {tx.paymentSplits.length > 1 && (
                    <div className="grid grid-cols-3 gap-2 rounded-lg bg-slate-900 p-3 text-white tabular-nums">
                      <div>
                        <span className="block text-[10px] text-slate-400">총 금액</span>
                        <span className="text-sm font-extrabold">{formatKRW(total.totalAmount)}</span>
                      </div>
                      <div>
                        <span className="block text-[10px] text-slate-400">총 CM 수수료 ({pct(total.effectiveCmRate)})</span>
                        <span className="text-sm font-extrabold">{formatKRW(total.totalCmCommission)}</span>
                      </div>
                      <div>
                        <span className="block text-[10px] text-slate-400">총 AG 수수료 ({pct(total.effectiveAgRate)})</span>
                        <span className="text-sm font-extrabold">{formatKRW(total.totalAgCommission)}</span>
                      </div>
                    </div>
                  )}
                </div>

                {tx.history && tx.history.length > 0 && (
                  <div className="rounded-xl border border-slate-200 p-3.5 space-y-2">
                    <h4 className="font-extrabold text-slate-900">진행 이력</h4>
                    <div className="space-y-1.5">
                      {tx.history.slice(-5).map((h) => (
                        <div
                          key={h.id}
                          className="flex items-start justify-between gap-2 text-[11px] text-slate-600 border-b border-slate-100 pb-1.5 last:border-0 last:pb-0"
                        >
                          <span>
                            <strong className="text-slate-900">{h.actionLabel}</strong> · {h.actorName}
                            {h.reasonOrNote && <span className="block text-slate-400">{h.reasonOrNote}</span>}
                          </span>
                          <span className="shrink-0 font-mono text-slate-400">{h.changedAt}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3.5">
                <button
                  type="button"
                  onClick={() => {
                    setEditingTxIdV2(tx.id);
                    setSelectedTxId(null);
                    navigate('/v2/register');
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800"
                >
                  <Edit3 className="h-3.5 w-3.5" />
                  이 거래 수정하기
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedTxId(null)}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100"
                >
                  닫기
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* 되돌리기 사유 입력 */}
      {pendingChange && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-4" onClick={() => setPendingChange(null)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="되돌리기 사유 입력"
            className="w-full max-w-md space-y-3 rounded-2xl bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2">
              <RotateCcw className="h-4 w-4 text-amber-600" />
              <h3 className="text-sm font-extrabold text-slate-900">이전 단계로 되돌리기</h3>
            </div>
            <p className="text-xs text-slate-600">
              {isAdmin
                ? '사유는 거래 이력에 남습니다.'
                : '되돌리기는 관리자 승인 후 반영됩니다. 승인 요청과 함께 보낼 사유를 적어 주세요.'}
            </p>
            <textarea
              autoFocus
              lang="ko"
              value={reasonText}
              onChange={(e) => setReasonText(e.target.value)}
              rows={3}
              placeholder="예: 카드사 승인 취소 통보"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:border-slate-900 focus:outline-none"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingChange(null)}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100"
              >
                취소
              </button>
              <button
                type="button"
                disabled={!reasonText.trim()}
                onClick={confirmRollback}
                className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800 disabled:opacity-40"
              >
                {isAdmin ? '되돌리기' : '승인 요청 보내기'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
