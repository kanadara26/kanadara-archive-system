import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import {
  APPROVAL_STATUS_META,
  ApprovalStatus,
  CARD_COMPANY_COLORS,
  SETTLEMENT_PROGRESS_STATUS_LIST,
  SETTLEMENT_PROGRESS_STATUS_META,
  SettlementProgressStatus,
  Transaction,
  V2_CARD_DISPLAY_NAMES,
  V2_CARD_LOGO_URLS,
  V2_PROGRESS_STATUS_LIST,
  normalizeV2ProgressStatus,
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
  Search,
  Square,
  Trash2,
  X,
} from 'lucide-react';

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
    quickChangeTransactionSettlementStatus,
    bulkUpdateTransactionsV2,
  } = useApp();
  const navigate = useNavigate();

  const [isDraftListOpen, setIsDraftListOpen] = useState<boolean>(false);
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'WAITING' | 'APPROVED' | 'REJECTED'>('ALL');
  const [settlementFilter, setSettlementFilter] = useState<'ALL' | SettlementProgressStatus>('ALL');
  const [agFilter, setAgFilter] = useState<string>('MY');
  const [searchKeyword, setSearchKeyword] = useState<string>('');
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);

  // 다중 선택 및 일괄 적용 상태
  const [selectedTxIds, setSelectedTxIds] = useState<string[]>([]);

  const isAdmin = currentUser?.role === 'ADMIN';
  const agUsers = useMemo(
    () => users.filter((u) => u.role === 'AG' || u.role === 'ADMIN'),
    [users]
  );

  // 현재 계정이 등록한 거래 승인건 목록 (어드민은 전체 또는 특정 AG 선택 가능)
  const myTransactions = useMemo(() => {
    if (!currentUser) return [];
    let base = transactions;
    if (!isAdmin) {
      base = transactions.filter((tx) => tx.agId === currentUser.id);
    } else if (agFilter !== 'ALL' && agFilter !== 'MY') {
      base = transactions.filter((tx) => tx.agId === agFilter);
    } else if (agFilter === 'MY') {
      // 어드민 기본값: 전체 AG 등록건 모두 조회하되 필터로 내 것만도 볼 수 있도록
      base = transactions;
    }
    return [...base].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [transactions, currentUser, isAdmin, agFilter]);

  // 진행상황(3단계) 및 정산상황(3단계) 상태별 건수 집계
  const statusCounts = useMemo(() => {
    const counts: Record<'ALL' | 'WAITING' | 'APPROVED' | 'REJECTED', number> = {
      ALL: myTransactions.length,
      WAITING: 0,
      APPROVED: 0,
      REJECTED: 0,
    };
    myTransactions.forEach((tx) => {
      const norm = normalizeV2ProgressStatus(tx.status);
      counts[norm] = (counts[norm] || 0) + 1;
    });
    return counts;
  }, [myTransactions]);

  const settlementCounts = useMemo(() => {
    const counts: Record<'ALL' | SettlementProgressStatus, number> = {
      ALL: myTransactions.length,
      '정산 대기': 0,
      '정산 완료': 0,
      '지급 완료(CM)': 0,
    };
    myTransactions.forEach((tx) => {
      const st: SettlementProgressStatus = tx.settlementStatus || '정산 대기';
      counts[st] = (counts[st] || 0) + 1;
    });
    return counts;
  }, [myTransactions]);

  // 상태 필터 + 정산상황 필터 + 검색어 적용 목록
  const filteredList = useMemo(() => {
    const kw = searchKeyword.trim().toLowerCase();
    return myTransactions.filter((tx) => {
      const normProgress = normalizeV2ProgressStatus(tx.status);
      const normSettlement: SettlementProgressStatus = tx.settlementStatus || '정산 대기';

      if (statusFilter !== 'ALL' && normProgress !== statusFilter) return false;
      if (settlementFilter !== 'ALL' && normSettlement !== settlementFilter) return false;

      if (kw) {
        const cardKey = tx.paymentSplits[0]?.cardCompany || '제휴카드사(삼성)';
        const cardName = V2_CARD_DISPLAY_NAMES[cardKey];
        const haystack = [
          tx.id,
          tx.customerName,
          tx.cmProfile.name,
          tx.cmProfile.affiliation,
          cardName,
          tx.requestMemo || '',
        ]
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(kw)) return false;
      }
      return true;
    });
  }, [myTransactions, statusFilter, settlementFilter, searchKeyword]);

  // 현재 필터 목록 기준 전체 선택 여부
  const isAllFilteredSelected =
    filteredList.length > 0 && filteredList.every((tx) => selectedTxIds.includes(tx.id));

  const handleToggleSelectAll = () => {
    if (isAllFilteredSelected) {
      const filteredIdSet = new Set(filteredList.map((t) => t.id));
      setSelectedTxIds((prev) => prev.filter((id) => !filteredIdSet.has(id)));
    } else {
      const merged = new Set([...selectedTxIds, ...filteredList.map((t) => t.id)]);
      setSelectedTxIds(Array.from(merged));
    }
  };

  const handleToggleSelectTx = (txId: string) => {
    setSelectedTxIds((prev) =>
      prev.includes(txId) ? prev.filter((id) => id !== txId) : [...prev, txId]
    );
  };

  const hasSelection = selectedTxIds.length > 0;
  const bulkGroups: {
    label: string;
    items: { key: string; label: string; dot: string; patch: { status?: ApprovalStatus; settlementStatus?: SettlementProgressStatus } }[];
  }[] = [
    {
      label: '진행상황 변경',
      items: V2_PROGRESS_STATUS_LIST.map((st) => ({
        key: st,
        label: APPROVAL_STATUS_META[st].label,
        dot: APPROVAL_STATUS_META[st].dotClass,
        patch: { status: st },
      })),
    },
    {
      label: '정산상황 변경',
      items: SETTLEMENT_PROGRESS_STATUS_LIST.map((sst) => ({
        key: sst,
        label: SETTLEMENT_PROGRESS_STATUS_META[sst].label,
        dot: SETTLEMENT_PROGRESS_STATUS_META[sst].dotClass,
        patch: { settlementStatus: sst },
      })),
    },
  ];

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

  // 모달에 열려 있는 거래의 최신 상태 동기화
  const currentModalTx = useMemo(() => {
    if (!selectedTx) return null;
    return transactions.find((t) => t.id === selectedTx.id) || selectedTx;
  }, [selectedTx, transactions]);

  return (
    <div className="space-y-6">
      {/* =================================================================== */}
      {/* 1. 상단 메인 액션 영역: 순서대로 "거래 승인건 등록", "불러오기" 버튼 배치 */}
      {/* =================================================================== */}
      <section className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* 1번 버튼: 거래 승인건 등록 */}
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
                <span className="text-base sm:text-lg font-extrabold tracking-tight block">
                  거래 승인건 등록
                </span>
                <span className="text-xs text-slate-300 mt-0.5 block">
                  카드사 · 결제방법 · 결제 및 고객/CM 단계별 간편 등록
                </span>
              </div>
            </div>
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 group-hover:translate-x-0.5 transition-transform">
              <ArrowRight className="h-4 w-4" />
            </div>
          </button>

          {/* 2번 버튼: 불러오기 (임시저장 목록) */}
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
                  <span className="text-base sm:text-lg font-extrabold tracking-tight">
                    불러오기
                  </span>
                  <span className="rounded-full bg-slate-900 px-2.5 py-0.5 text-xs font-extrabold text-white tabular-nums">
                    {draftsV2.length}건
                  </span>
                </div>
                <span className="text-xs text-slate-500 mt-0.5 block">
                  임시 저장해 둔 작성 중인 거래 승인건을 이어서 작성합니다
                </span>
              </div>
            </div>
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-700">
              <ArrowRight className="h-4 w-4" />
            </div>
          </button>
        </div>

        {/* 불러오기 클릭 시 열리는 임시저장 목록 패널 */}
        {isDraftListOpen && (
          <div className="rounded-2xl border border-slate-300 bg-white p-5 shadow-sm space-y-3">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h2 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
                <FolderOpen className="h-4 w-4 text-slate-700" />
                임시 저장된 거래 불러오기 ({draftsV2.length}건)
              </h2>
              <button
                type="button"
                onClick={() => setIsDraftListOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {draftsV2.length === 0 ? (
              <div className="py-8 text-center space-y-2">
                <p className="text-xs font-bold text-slate-500">
                  현재 임시 저장된 거래 내역이 없습니다.
                </p>
                <p className="text-xs text-slate-400">
                  [거래 승인건 등록] 중 상단의 [임시 저장] 버튼을 누르면 이곳에서 언제든 다시 불러올 수 있습니다.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100 max-h-64 overflow-y-auto">
                {draftsV2.map((draft) => (
                  <div
                    key={draft.id}
                    className="flex items-center justify-between gap-3 py-3 px-2 hover:bg-slate-50 rounded-xl transition-colors"
                  >
                    <button
                      type="button"
                      onClick={() => handleLoadDraftToRegister(draft.id)}
                      className="flex-1 text-left"
                    >
                      <p className="text-xs sm:text-sm font-extrabold text-slate-900">
                        {draft.title}
                      </p>
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

      {/* =================================================================== */}
      {/* 2. 하단 영역: 해당 계정이 등록한 거래 승인건 조회 및 진행/정산상황 확인 */}
      {/* =================================================================== */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs space-y-4">
        {/* 섹션 타이틀 & 검색/AG 필터 */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-100 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-extrabold text-slate-900">
                등록한 거래 승인건 및 진행 · 정산상황
              </h2>
              <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-700 tabular-nums">
                총 {myTransactions.length}건
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              거래를 체크한 뒤 상단 바에서 진행상황·정산상황을 한 번에 바꿀 수 있습니다. 거래를 누르면 상세 정보가 열립니다.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {isAdmin && (
              <select
                aria-label="등록 AG 계정 필터"
                value={agFilter}
                onChange={(e) => setAgFilter(e.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-800 focus:border-slate-900 focus:outline-none"
              >
                <option value="MY">등록 계정: 전체 AG 보기</option>
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
                value={searchKeyword}
                onChange={(e) => setSearchKeyword(e.target.value)}
                placeholder="고객명, 거래번호, CM, 비고 검색..."
                className="w-52 sm:w-64 rounded-lg border border-slate-300 bg-white pl-8 pr-7 py-2 text-xs font-semibold text-slate-900 focus:border-slate-900 focus:outline-none"
              />
              {searchKeyword && (
                <button
                  type="button"
                  onClick={() => setSearchKeyword('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* 필터 탭: 진행상황 + 정산상황 */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2.5">
          {/* 진행상황(3단계) 필터 */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-extrabold text-slate-500 mr-1">진행상황</span>
            <button
              type="button"
              onClick={() => setStatusFilter('ALL')}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold border transition-colors tabular-nums ${
                statusFilter === 'ALL'
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
              }`}
            >
              전체 ({statusCounts.ALL})
            </button>
            {V2_PROGRESS_STATUS_LIST.map((st) => {
              const meta = APPROVAL_STATUS_META[st];
              const isSelected = statusFilter === st;
              return (
                <button
                  key={st}
                  type="button"
                  onClick={() => setStatusFilter(st)}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold border transition-colors tabular-nums ${
                    isSelected
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${meta.dotClass}`} />
                  <span>{meta.label}</span>
                  <span>({statusCounts[st] || 0})</span>
                </button>
              );
            })}
          </div>

          {/* 정산상황(3단계) 필터 */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-extrabold text-slate-500 mr-1">정산상황</span>
            <button
              type="button"
              onClick={() => setSettlementFilter('ALL')}
              className={`rounded-lg px-2.5 py-1.5 text-xs font-bold border transition-colors tabular-nums ${
                settlementFilter === 'ALL'
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
              }`}
            >
              전체 ({settlementCounts.ALL})
            </button>
            {SETTLEMENT_PROGRESS_STATUS_LIST.map((sst) => {
              const smeta = SETTLEMENT_PROGRESS_STATUS_META[sst];
              const isSelected = settlementFilter === sst;
              return (
                <button
                  key={sst}
                  type="button"
                  onClick={() => setSettlementFilter(sst)}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-bold border transition-colors tabular-nums ${
                    isSelected
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${smeta.dotClass}`} />
                  <span>{smeta.label}</span>
                  <span>({settlementCounts[sst] || 0})</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* 일괄 변경 바: 스크롤해도 헤더 바로 아래에 고정. 체크한 거래에 버튼을 누르는 즉시 적용 */}
        <div className="sticky top-[65px] z-20 -mx-5 border-y border-slate-200 bg-white/95 px-5 py-3 backdrop-blur-xs">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleToggleSelectAll}
                disabled={filteredList.length === 0}
                className="inline-flex items-center gap-2 whitespace-nowrap rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-extrabold text-slate-800 hover:bg-slate-100 disabled:opacity-40"
              >
                {isAllFilteredSelected ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                <span>{isAllFilteredSelected ? '선택 해제' : '전체 선택'}</span>
              </button>
              <span className={`whitespace-nowrap text-xs font-bold tabular-nums ${hasSelection ? 'text-slate-900' : 'text-slate-400'}`}>
                {hasSelection ? `${selectedTxIds.length}건 선택됨` : '거래를 체크한 뒤 상태를 누르세요'}
              </span>
              {hasSelection && !isAllFilteredSelected && (
                <button
                  type="button"
                  onClick={() => setSelectedTxIds([])}
                  className="whitespace-nowrap text-[11px] font-semibold text-slate-400 underline hover:text-slate-700"
                >
                  해제
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 lg:ml-auto">
              {bulkGroups.map((group) => (
                <div key={group.label} className="flex flex-col items-start gap-1 sm:flex-row sm:items-center sm:gap-2">
                  <span className="whitespace-nowrap text-[11px] font-extrabold text-slate-500">{group.label}</span>
                  <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-0.5">
                    {group.items.map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        disabled={!hasSelection}
                        onClick={() => bulkUpdateTransactionsV2(selectedTxIds, item.patch)}
                        title={hasSelection ? `선택한 ${selectedTxIds.length}건을 [${item.label}](으)로 변경` : '먼저 거래를 선택하세요'}
                        className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-bold text-slate-700 transition-colors enabled:hover:bg-white enabled:hover:text-slate-900 enabled:hover:shadow-2xs disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <span className={`h-1.5 w-1.5 rounded-full ${item.dot}`} />
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 거래 승인건 및 진행·정산상황 리스트 */}
        {filteredList.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 py-14 text-center space-y-2">
            <p className="text-sm font-bold text-slate-600">
              조회된 거래 승인건이 없습니다.
            </p>
            <p className="text-xs text-slate-400">
              상단의 [거래 승인건 등록] 버튼을 눌러 새 거래를 등록해 보세요.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredList.map((tx) => {
              const calc = calcSplitTotals(tx.paymentSplits, tx.appliedPromotions);
              const cardKey = tx.paymentSplits[0]?.cardCompany || '제휴카드사(삼성)';
              const cardColor = CARD_COMPANY_COLORS[cardKey];
              const cardDisplayName = V2_CARD_DISPLAY_NAMES[cardKey];
              const cardLogoUrl = V2_CARD_LOGO_URLS[cardKey];
              const normProgress = normalizeV2ProgressStatus(tx.status);
              const statusMeta = APPROVAL_STATUS_META[normProgress];
              const settlementSt: SettlementProgressStatus =
                tx.settlementStatus || '정산 대기';
              const settlementMeta = SETTLEMENT_PROGRESS_STATUS_META[settlementSt];
              const isChecked = selectedTxIds.includes(tx.id);

              const methodSummary =
                tx.paymentSplits.length > 1
                  ? `혼합 (${tx.paymentSplits.length}건)`
                  : tx.paymentSplits[0]?.paymentMethod === '다이렉트할부'
                  ? '다이렉트'
                  : tx.paymentSplits[0]?.paymentMethod || '일시불';

              return (
                <div
                  key={tx.id}
                  onClick={() => setSelectedTx(tx)}
                  className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors ${
                    isChecked
                      ? 'border-slate-900 bg-slate-50 ring-1 ring-slate-900'
                      : 'border-slate-200 bg-white hover:border-slate-400'
                  }`}
                >
                  {/* 다중 선택 체크박스 (상태 변경은 상단 고정 바에서) */}
                  <button
                    type="button"
                    aria-label={`${tx.customerName} 거래 선택`}
                    aria-pressed={isChecked}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleToggleSelectTx(tx.id);
                    }}
                    className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border transition-colors ${
                      isChecked
                        ? 'border-slate-900 bg-slate-900 text-white'
                        : 'border-slate-300 bg-white text-transparent hover:border-slate-500'
                    }`}
                  >
                    <Check className="h-3.5 w-3.5 stroke-[3]" />
                  </button>

                  <div className="min-w-0 flex-1 space-y-2.5">
                    <div className="flex flex-col gap-2.5 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0 space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-extrabold text-slate-900">
                            {cardLogoUrl ? (
                              <img src={cardLogoUrl} alt="" className="h-4 w-4 object-contain" />
                            ) : (
                              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: cardColor.mainHex }} />
                            )}
                            {cardDisplayName}
                          </span>
                          <span className="whitespace-nowrap rounded-md bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-600">
                            {methodSummary}
                          </span>
                          <span className="text-sm font-black text-slate-900">{tx.customerName} 고객</span>
                        </div>
                        <p className="text-xs text-slate-500">
                          담당 CM <strong className="font-bold text-slate-700">{tx.cmProfile.name}</strong>
                          {tx.cmProfile.affiliation && ` (${tx.cmProfile.affiliation})`}
                        </p>
                        <p className="font-mono text-[11px] text-slate-400">
                          {tx.id} · 작성 {tx.requestDate} · 승인{' '}
                          <span className={tx.approvalDate ? 'font-bold text-slate-700' : ''}>
                            {tx.approvalDate || '대기'}
                          </span>
                        </p>
                      </div>

                      {/* 우측: 진행·정산상황 배지 + 금액 */}
                      <div className="flex shrink-0 flex-row-reverse items-center justify-between gap-2 sm:flex-col sm:items-end">
                        <div className="flex flex-wrap justify-end gap-1.5">
                          <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-extrabold ${statusMeta.badgeClass}`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${statusMeta.dotClass}`} />
                            {statusMeta.label}
                          </span>
                          <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-extrabold ${settlementMeta.badgeClass}`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${settlementMeta.dotClass}`} />
                            {settlementMeta.label}
                          </span>
                        </div>
                        <div className="tabular-nums sm:text-right">
                          <span className="block text-sm font-black text-slate-900">{formatKRW(calc.totalAmount)}</span>
                          <span className="text-[11px] text-slate-500">
                            AG {formatKRW(calc.totalAgCommission)} · CM {formatKRW(calc.totalCmCommission)}
                          </span>
                        </div>
                      </div>
                    </div>

                    {normProgress === 'REJECTED' && (
                      <p className="text-xs font-bold text-rose-600">
                        반려 사유: {tx.rejectionReason || '심사 기준 미충족'}
                      </p>
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

      {/* =================================================================== */}
      {/* 3. 거래 클릭 시 진행·정산상황 이력 및 상세 정보 모달 */}
      {/* =================================================================== */}
      {currentModalTx && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs"
          onClick={() => setSelectedTx(null)}
        >
          <div
            className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white shadow-xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-900 px-5 py-4 text-white">
              <div>
                <span className="text-[11px] font-mono text-slate-400 block">
                  {currentModalTx.id}
                </span>
                <h3 className="text-base font-extrabold">
                  {currentModalTx.customerName} 고객 거래 및 진행 · 정산상황 상세
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedTx(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto text-xs">
              {/* 진행상황 변경 바 (요청 대기 / 카드 승인 / 반려) */}
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 p-3.5 border border-slate-200">
                <div>
                  <span className="text-slate-400 block">현재 진행상황</span>
                  <span className="text-sm font-extrabold text-slate-900">
                    {APPROVAL_STATUS_META[normalizeV2ProgressStatus(currentModalTx.status)].label}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {V2_PROGRESS_STATUS_LIST.map((st) => {
                    const isCurrent = normalizeV2ProgressStatus(currentModalTx.status) === st;
                    return (
                      <button
                        key={st}
                        type="button"
                        onClick={() => {
                          quickChangeTransactionStatus(currentModalTx.id, st);
                        }}
                        className={`rounded-lg px-3 py-1.5 text-xs font-bold border transition-colors ${
                          isCurrent
                            ? 'border-slate-900 bg-slate-900 text-white'
                            : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100'
                        }`}
                      >
                        {APPROVAL_STATUS_META[st].label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 정산상황 변경 바 (정산 대기 / 정산 완료 / 지급 완료(CM)) */}
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 p-3.5 border border-slate-200">
                <div>
                  <span className="text-slate-400 block">현재 정산상황</span>
                  <span className="text-sm font-extrabold text-slate-900">
                    {currentModalTx.settlementStatus || '정산 대기'}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {SETTLEMENT_PROGRESS_STATUS_LIST.map((sst) => {
                    const isCurrent =
                      (currentModalTx.settlementStatus || '정산 대기') === sst;
                    return (
                      <button
                        key={sst}
                        type="button"
                        onClick={() => {
                          quickChangeTransactionSettlementStatus(currentModalTx.id, sst);
                        }}
                        className={`rounded-lg px-3 py-1.5 text-xs font-bold border transition-colors ${
                          isCurrent
                            ? 'border-slate-900 bg-slate-900 text-white'
                            : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100'
                        }`}
                      >
                        {sst}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 기본 정보 */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 rounded-xl border border-slate-200 p-3.5">
                <div>
                  <span className="text-slate-400 block">고객명</span>
                  <span className="font-extrabold text-slate-900">
                    {currentModalTx.customerName}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block">담당 CM</span>
                  <span className="font-bold text-slate-900">
                    {currentModalTx.cmProfile.name}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block">작성일자</span>
                  <span className="font-mono font-bold text-slate-800">
                    {currentModalTx.requestDate}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block">승인일자</span>
                  <span className="font-mono font-bold text-slate-900">
                    {currentModalTx.approvalDate || '승인 대기 (미기록)'}
                  </span>
                </div>
              </div>

              {/* 비고 노출 */}
              {currentModalTx.requestMemo && (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5">
                  <span className="text-slate-400 block mb-0.5">비고</span>
                  <p className="font-semibold text-slate-900">{currentModalTx.requestMemo}</p>
                </div>
              )}

              {/* 결제 내역 */}
              <div className="rounded-xl border border-slate-200 p-3.5 space-y-2">
                <h4 className="font-extrabold text-slate-900">결제 정보</h4>
                {currentModalTx.paymentSplits.map((split, i) => {
                  const isLump = split.paymentMethod === '일시불';
                  const agAmt = Math.round((split.amount * split.agCommissionRate) / 100);
                  const cmAmt = Math.round((split.amount * split.cmCommissionRate) / 100);
                  return (
                    <div
                      key={split.id || i}
                      className="rounded-lg bg-slate-50 p-3 border border-slate-200/70 flex items-center justify-between"
                    >
                      <div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-extrabold text-slate-900">
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
                        <span className="text-[11px] text-slate-500 block mt-0.5">
                          {isLump
                            ? `캐시백 ${split.cashbackRate}%`
                            : `할부금리 ${split.interestRate}%`}{' '}
                          · AG {split.agCommissionRate}% ({formatKRW(agAmt)}) · CM{' '}
                          {split.cmCommissionRate}% ({formatKRW(cmAmt)})
                        </span>
                      </div>
                      <span className="font-black text-slate-900 text-sm tabular-nums">
                        {formatKRW(split.amount)}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* 진행 이력 타임라인 */}
              {currentModalTx.history && currentModalTx.history.length > 0 && (
                <div className="rounded-xl border border-slate-200 p-3.5 space-y-2">
                  <h4 className="font-extrabold text-slate-900">진행 이력</h4>
                  <div className="space-y-1.5">
                    {currentModalTx.history.slice(-5).map((h) => (
                      <div
                        key={h.id}
                        className="flex items-center justify-between text-[11px] text-slate-600 border-b border-slate-100 pb-1.5 last:border-0 last:pb-0"
                      >
                        <span>
                          <strong className="text-slate-900">{h.actionLabel}</strong> ·{' '}
                          {h.actorName}
                        </span>
                        <span className="font-mono text-slate-400">{h.changedAt}</span>
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
                  setEditingTxIdV2(currentModalTx.id);
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
                onClick={() => setSelectedTx(null)}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
