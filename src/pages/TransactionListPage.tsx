import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle,
  Building2,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Coins,
  Columns2,
  Copy,
  CreditCard,
  Edit3,
  ExternalLink,
  Eye,
  EyeOff,
  FilePlus2,
  FileSpreadsheet,
  Gift,
  Highlighter,
  Layers,
  Lock,
  Phone,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  UserCheck,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import {
  GOOGLE_MASTER_SPREADSHEET_TITLE,
  GOOGLE_SHEET_TABS,
  serializeTransactionsToTsv,
} from '../constants/googleSheetConfig';
import {
  APPROVAL_STATUS_LIST,
  APPROVAL_STATUS_META,
  AppliedPromotionSnapshot,
  ApprovalStatus,
  CARD_COMPANY_COLORS,
  CardPromotionItem,
  PaymentSplitItem,
  RateTableRowItem,
  SPLIT_CARD_COMPANIES,
  SPLIT_PAYMENT_METHODS,
  SplitCardCompany,
  SplitPaymentMethod,
  Transaction,
} from '../types';
import { ApprovalStatusBadge, SlipAndSheetBadge } from '../components/StatusBadges';
import { RateTablePanel } from '../components/RateTablePanel';
import {
  calcExpectedAgCommission,
  calcExpectedCommission,
  calcSplitTotals,
  formatKRW,
  formatNumber,
  formatSignedKRW,
  formatSignedRate,
} from '../utils/format';

function createDefaultSplit(
  index: number = 0,
  fixedCardCompany: SplitCardCompany = '제휴카드사(삼성)'
): PaymentSplitItem {
  if (index === 0) {
    return {
      id: `split-new-${Date.now()}-${index}`,
      cardCompany: fixedCardCompany,
      paymentMethod: '일시불',
      amount: 30000000,
      installmentMonths: 1,
      cashbackRate: 2.1,
      interestRate: 0,
      agCommissionRate: 0.9,
      cmCommissionRate: 0.55,
      customConditionNote: '',
    };
  }
  return {
    id: `split-new-${Date.now()}-${index}`,
    cardCompany: fixedCardCompany,
    paymentMethod: '다이렉트할부',
    amount: 15000000,
    installmentMonths: 36,
    cashbackRate: 0,
    interestRate: 4.4,
    agCommissionRate: 1.15,
    cmCommissionRate: 0.7,
    customConditionNote: '동일 카드사 잔금 분할 다이렉트할부',
  };
}

function formatMaskedRrn(rrn?: string, revealed?: boolean): string {
  const raw = rrn || '880415-1248512';
  if (revealed) return raw;
  const cleaned = raw.trim();
  if (cleaned.length >= 8) {
    return `${cleaned.slice(0, 8)}******`;
  }
  return '******-*******';
}

export const TransactionListPage: React.FC = () => {
  const {
    currentUser,
    users,
    accessibleTransactions,
    cardPromotions,
    systemReferenceDate,
    setSystemReferenceDate,
    isRateTableSplitOpen,
    setRateTableSplitOpen,
    toggleRateTableSplit,
    getAssignedCmsForAg,
    saveAgTransactionRequest,
    quickChangeTransactionStatus,
    lastMasterSheetSyncedAt,
    isSyncingMasterSheet,
    pushAllMasterTabsToGoogleSheet,
    pushToast,
  } = useApp();

  // 목록 필터 상태
  const [statusFilter, setStatusFilter] = useState<'ALL' | ApprovalStatus>('ALL');
  const [cardFilter, setCardFilter] = useState<'ALL' | SplitCardCompany>('ALL');
  const [cmFilter, setCmFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  // AG 거래 승인요청 통합 폼 접기/펼치기 상태 (기본 접힘으로 담당 작업 목록이 첫 화면에 즉시 노출)
  const [isFormOpen, setIsFormOpen] = useState<boolean>(false);

  // 주민등록번호 마스킹 해제 토글 맵
  const [revealedRrnMap, setRevealedRrnMap] = useState<Record<string, boolean>>({});

  // 테이블 인라인 반려 선택 시 반려 사유 입력 가드 상태
  const [pendingRejectTxId, setPendingRejectTxId] = useState<string | null>(null);
  const [inlineRejectReason, setInlineRejectReason] = useState<string>('');

  // AG 거래 승인요청 통합 폼 상태 (한 페이지 내 작성·수정)
  const [editingTxId, setEditingTxId] = useState<string | undefined>(undefined);
  const [customerName, setCustomerName] = useState('');
  const [requestDate, setRequestDate] = useState(systemReferenceDate);
  const [txStatus, setTxStatus] = useState<ApprovalStatus>('WAITING');
  const [approvalDate, setApprovalDate] = useState(systemReferenceDate);
  const [selectedCmId, setSelectedCmId] = useState<string>('');
  const [vehicleInfo, setVehicleInfo] = useState('');
  const [requestMemo, setRequestMemo] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [paymentSplits, setPaymentSplits] = useState<PaymentSplitItem[]>(() => [
    createDefaultSplit(0, '제휴카드사(삼성)'),
  ]);
  const [appliedPromotions, setAppliedPromotions] = useState<AppliedPromotionSnapshot[]>([]);
  const [activeSplitIndex, setActiveSplitIndex] = useState<number>(0);
  const [formFeedback, setFormFeedback] = useState<{
    type: 'error' | 'success';
    message: string;
  } | null>(null);

  // AG가 선택 가능한 CM 목록 (담당 배정된 CM 우선 표시 + 전체 CM)
  const cmUsers = useMemo(
    () => users.filter((u) => u.role === 'CM' && u.isActive),
    [users]
  );

  const assignedCmIds = useMemo(() => {
    if (!currentUser || currentUser.role !== 'AG') return new Set<string>();
    return new Set(getAssignedCmsForAg(currentUser.id).map((u) => u.id));
  }, [currentUser, getAssignedCmsForAg]);

  useEffect(() => {
    if (!selectedCmId && cmUsers.length > 0) {
      const firstAssigned = cmUsers.find((u) => assignedCmIds.has(u.id));
      setSelectedCmId((firstAssigned || cmUsers[0]).id);
    }
  }, [cmUsers, assignedCmIds, selectedCmId]);

  // 선택한 CM의 등록 데이터 자동 가져오기
  const selectedCmUser = useMemo(
    () => cmUsers.find((u) => u.id === selectedCmId) || cmUsers[0],
    [cmUsers, selectedCmId]
  );

  // 기준 카드사 (결제 #1의 카드사 = 모든 분할 결제의 고정 카드사)
  const primaryCardCompany: SplitCardCompany =
    paymentSplits[0]?.cardCompany || '제휴카드사(삼성)';
  const primaryCardColor = CARD_COMPANY_COLORS[primaryCardCompany];

  // 현재 분할 결제 행들에 선택된 결제방법 목록
  const selectedPaymentMethods = useMemo(
    () => Array.from(new Set(paymentSplits.map((s) => s.paymentMethod))),
    [paymentSplits]
  );

  // 분할 결제 실시간 합계 + 적용 프로모션 인센티브 합계 계산
  const splitTotals = useMemo(
    () => calcSplitTotals(paymentSplits, appliedPromotions),
    [paymentSplits, appliedPromotions]
  );

  // 현재 선택된 카드사 및 결제방법 조건에 맞는 카드사 별 프로모션 필터링
  const matchingCardPromotions = useMemo(() => {
    return cardPromotions.filter((promo) => {
      if (!promo.isActive) return false;
      if (promo.cardCompany !== primaryCardCompany) return false;
      const methodMatched =
        promo.paymentMethod === '통합' ||
        selectedPaymentMethods.includes(promo.paymentMethod as SplitPaymentMethod);
      return methodMatched;
    });
  }, [cardPromotions, primaryCardCompany, selectedPaymentMethods]);

  // 거래 목록 필터링
  const filteredTransactions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return accessibleTransactions.filter((tx) => {
      if (statusFilter !== 'ALL' && tx.status !== statusFilter) return false;
      if (cardFilter !== 'ALL') {
        const hasCard = tx.paymentSplits?.some((s) => s.cardCompany === cardFilter);
        if (!hasCard) return false;
      }
      if (cmFilter !== 'ALL' && tx.cmId !== cmFilter) return false;
      if (q) {
        const splitCards = tx.paymentSplits?.map((s) => s.cardCompany).join(' ') || '';
        const promoTitles =
          tx.appliedPromotions?.map((p) => p.title).join(' ') || '';
        const haystack = [
          tx.id,
          tx.customerName,
          tx.vehicleInfo,
          tx.cmProfile?.name || '',
          tx.cmProfile?.affiliation || '',
          tx.cmProfile?.employeeId || '',
          splitCards,
          promoTitles,
        ]
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [accessibleTransactions, statusFilter, cardFilter, cmFilter, searchQuery]);

  // 6단계 상태별 건수 집계
  const counts = useMemo(() => {
    const map: Record<'ALL' | ApprovalStatus, number> = {
      ALL: accessibleTransactions.length,
      WAITING: 0,
      REVIEWING: 0,
      APPROVED: 0,
      REJECTED: 0,
      SLIP_REQUIRED: 0,
      COMPLETED: 0,
    };
    accessibleTransactions.forEach((tx) => {
      map[tx.status] = (map[tx.status] || 0) + 1;
    });
    return map;
  }, [accessibleTransactions]);

  // 수수료 요약 (CM에게는 CM 수수료만 계산, AG/Admin에게는 AG+CM 모두 계산)
  const commissionSummary = useMemo(() => {
    const activeTxs = accessibleTransactions.filter((tx) => tx.status !== 'REJECTED');
    let totalAmount = 0;
    let totalCmCommission = 0;
    let totalAgCommission = 0;
    let confirmedCmCommission = 0;
    let pendingCmCommission = 0;

    activeTxs.forEach((tx) => {
      const cmComm = calcExpectedCommission(tx);
      const agComm = calcExpectedAgCommission(tx);
      totalAmount += tx.amount;
      totalCmCommission += cmComm;
      totalAgCommission += agComm;
      if (
        tx.status === 'APPROVED' ||
        tx.status === 'SLIP_REQUIRED' ||
        tx.status === 'COMPLETED'
      ) {
        confirmedCmCommission += cmComm;
      } else {
        pendingCmCommission += cmComm;
      }
    });

    return {
      activeCount: activeTxs.length,
      totalAmount,
      totalCmCommission,
      totalAgCommission,
      confirmedCmCommission,
      pendingCmCommission,
    };
  }, [accessibleTransactions]);

  if (!currentUser) return null;

  const isCm = currentUser.role === 'CM';
  const canManageRequest = currentUser.role === 'AG' || currentUser.role === 'ADMIN';

  const toggleRrnReveal = (key: string) => {
    setRevealedRrnMap((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // 상태 변경 시 승인일자(상태변경일) 자동 동기화
  const handleFormStatusChange = (nextStatus: ApprovalStatus) => {
    setTxStatus(nextStatus);
    setApprovalDate(systemReferenceDate);
  };

  // 분할 결제 행 업데이트:
  // - 1번째 결제(index === 0)의 카드사 변경 시 모든 분할 행의 카드사를 동일하게 고정 동기화
  // - 2번째 이후 분할 행은 다른 카드사로 변경 불가 (항상 결제 #1의 카드사로 고정)
  const updateSplitRow = (index: number, patch: Partial<PaymentSplitItem>) => {
    setPaymentSplits((prev) => {
      const nextPrimaryCard: SplitCardCompany =
        index === 0 && patch.cardCompany
          ? patch.cardCompany
          : prev[0]?.cardCompany || '제휴카드사(삼성)';

      if (index === 0 && patch.cardCompany && patch.cardCompany !== prev[0]?.cardCompany) {
        setAppliedPromotions((prevPromos) =>
          prevPromos.filter((p) => p.cardCompany === patch.cardCompany)
        );
      }

      return prev.map((row, idx) => {
        if (idx !== index) {
          return {
            ...row,
            cardCompany: nextPrimaryCard,
          };
        }

        const merged: PaymentSplitItem = {
          ...row,
          ...patch,
          cardCompany: nextPrimaryCard,
        };

        if (merged.paymentMethod === '일시불') {
          merged.installmentMonths = 1;
          merged.interestRate = 0;
          if (patch.paymentMethod === '일시불' && merged.cashbackRate === 0) {
            merged.cashbackRate = 1.9;
          }
        } else {
          merged.cashbackRate = 0;
          if (merged.installmentMonths <= 1) {
            merged.installmentMonths = 36;
          }
          if (
            (patch.paymentMethod === '할부' || patch.paymentMethod === '다이렉트할부') &&
            merged.interestRate === 0
          ) {
            merged.interestRate = merged.paymentMethod === '다이렉트할부' ? 4.4 : 4.7;
          }
        }
        return merged;
      });
    });
  };

  // 결제 분할(+) 추가 시 위 결제(결제 #1)의 카드사가 고정으로 이어지도록 설정
  const handleAddSplitRow = () => {
    setPaymentSplits((prev) => {
      const fixedCard = prev[0]?.cardCompany || '제휴카드사(삼성)';
      const next = [...prev, createDefaultSplit(prev.length, fixedCard)];
      setActiveSplitIndex(next.length - 1);
      return next;
    });
  };

  const handleRemoveSplitRow = (index: number) => {
    if (paymentSplits.length <= 1) return;
    setPaymentSplits((prev) => prev.filter((_, idx) => idx !== index));
    setActiveSplitIndex((prev) => Math.max(0, Math.min(prev, paymentSplits.length - 2)));
  };

  // 프로모션 거래 추가 / 해제 토글
  const handleTogglePromotion = (promo: CardPromotionItem) => {
    setAppliedPromotions((prev) => {
      const exists = prev.some((p) => p.promotionId === promo.id);
      if (exists) {
        return prev.filter((p) => p.promotionId !== promo.id);
      }
      const snapshot: AppliedPromotionSnapshot = {
        promotionId: promo.id,
        cardCompany: promo.cardCompany,
        title: promo.title,
        startDate: promo.startDate,
        endDate: promo.endDate,
        paymentMethod: promo.paymentMethod,
        minAmount: promo.minAmount,
        maxAmount: promo.maxAmount,
        amountConditionLabel: promo.amountConditionLabel,
        cashbackRateDelta: promo.cashbackRateDelta ?? 0,
        interestRateDelta: promo.interestRateDelta ?? 0,
        agIncentiveRate: promo.agIncentiveRate,
        cmIncentiveRate: promo.cmIncentiveRate,
        agIncentiveAmount: promo.agIncentiveAmount,
        cmIncentiveAmount: promo.cmIncentiveAmount,
        promotionConditionText: promo.promotionConditionText,
      };
      return [...prev, snapshot];
    });
  };

  // 우측 요율표(2분할)에서 [적용] 클릭 시 현재 선택된 결제정보 행에 즉시 반영 + 명확한 피드백 제공
  const handleApplyRateTableRow = (rateRow: RateTableRowItem) => {
    const targetIdx = Math.min(activeSplitIndex, paymentSplits.length - 1);
    const parsedMonths =
      rateRow.paymentMethod === '일시불'
        ? 1
        : parseInt(rateRow.installmentMonths.replace(/\D/g, '').slice(0, 2), 10) || 36;

    setIsFormOpen(true);
    setPaymentSplits((prev) => {
      const nextCard = rateRow.cardCompany;
      if (nextCard !== prev[0]?.cardCompany) {
        setAppliedPromotions((prevPromos) =>
          prevPromos.filter((p) => p.cardCompany === nextCard)
        );
      }
      return prev.map((row, idx) => {
        if (idx !== targetIdx) {
          return {
            ...row,
            cardCompany: nextCard,
          };
        }
        return {
          ...row,
          cardCompany: nextCard,
          paymentMethod: rateRow.paymentMethod,
          installmentMonths: parsedMonths,
          cashbackRate: rateRow.paymentMethod === '일시불' ? rateRow.cashbackRate : 0,
          interestRate: rateRow.paymentMethod === '일시불' ? 0 : rateRow.interestRate,
          agCommissionRate: rateRow.agCommissionRate,
          cmCommissionRate: rateRow.cmCommissionRate,
          customConditionNote: `${rateRow.amountTier} (${rateRow.remark})`,
        };
      });
    });

    pushToast({
      type: 'success',
      title: `결제 #${targetIdx + 1} 행에 요율이 적용되었습니다`,
      description: `${rateRow.cardCompany} · ${rateRow.paymentMethod} (${rateRow.amountTier}) 조건이 반영되었습니다.`,
    });
  };

  // 작업 목록의 기존 거래를 상단 폼에 불러와 한 페이지 내에서 바로 수정
  const handleLoadTxIntoForm = (tx: Transaction) => {
    const baseSplits =
      tx.paymentSplits && tx.paymentSplits.length > 0
        ? tx.paymentSplits.map((s) => ({ ...s }))
        : [createDefaultSplit(0, '제휴카드사(삼성)')];
    const fixedCard = baseSplits[0].cardCompany;
    const normalizedSplits = baseSplits.map((s) => ({
      ...s,
      cardCompany: fixedCard,
    }));

    setEditingTxId(tx.id);
    setCustomerName(tx.customerName);
    setRequestDate(tx.requestDate || tx.createdAt.slice(0, 10));
    setTxStatus(tx.status);
    setApprovalDate(tx.approvalDate || tx.updatedAt.slice(0, 10));
    setSelectedCmId(tx.cmId);
    setVehicleInfo(tx.vehicleInfo || '');
    setRequestMemo(tx.requestMemo || '');
    setRejectionReason(tx.rejectionReason || '');
    setPaymentSplits(normalizedSplits);
    setAppliedPromotions(tx.appliedPromotions ? [...tx.appliedPromotions] : []);
    setActiveSplitIndex(0);
    setFormFeedback(null);
    setIsFormOpen(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleResetForm = () => {
    setEditingTxId(undefined);
    setCustomerName('');
    setRequestDate(systemReferenceDate);
    setTxStatus('WAITING');
    setApprovalDate(systemReferenceDate);
    setVehicleInfo('');
    setRequestMemo('');
    setRejectionReason('');
    setPaymentSplits([createDefaultSplit(0, '제휴카드사(삼성)')]);
    setAppliedPromotions([]);
    setActiveSplitIndex(0);
    setFormFeedback(null);
  };

  const handleSubmitAgForm = (e: React.FormEvent) => {
    e.preventDefault();
    setFormFeedback(null);

    if (txStatus === 'REJECTED' && !rejectionReason.trim()) {
      setFormFeedback({
        type: 'error',
        message: '반려 상태로 저장하려면 반려 사유를 반드시 입력해 주세요.',
      });
      return;
    }

    const res = saveAgTransactionRequest({
      txId: editingTxId,
      customerName,
      requestDate,
      status: txStatus,
      approvalDate,
      cmId: selectedCmId,
      paymentSplits,
      appliedPromotions,
      vehicleInfo,
      requestMemo,
      rejectionReason,
    });

    if (!res.ok) {
      setFormFeedback({ type: 'error', message: res.message });
      return;
    }

    setFormFeedback({
      type: 'success',
      message: editingTxId
        ? `거래(${editingTxId}) 수정이 완료되어 담당 작업 목록에 반영되었습니다.`
        : `신규 거래 승인요청(${res.transactionId})이 등록되었습니다.`,
    });

    if (!editingTxId) {
      setCustomerName('');
      setVehicleInfo('');
      setRequestMemo('');
      setRejectionReason('');
      setPaymentSplits([createDefaultSplit(0, primaryCardCompany)]);
      setAppliedPromotions([]);
      setActiveSplitIndex(0);
    }
  };

  return (
    <div className="space-y-5">
      {/* 통합 워크스페이스 헤더 + 구글 시트 실시간 동기화 바 (단일 카드 통합으로 상단 공간 확보) */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-2xs overflow-hidden">
        <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-800 border border-slate-200">
                {isCm
                  ? 'CM 거래 · 수수료 조회'
                  : currentUser.role === 'AG'
                  ? 'AG 승인 · 작업 워크스페이스'
                  : 'ADMIN 통합 관리'}
              </span>
            </div>
            <h1 className="mt-1.5 text-xl sm:text-2xl font-black tracking-tight text-slate-900">
              {isCm
                ? `${currentUser.name} CM 거래 내역 및 예상 수수료`
                : '거래 승인요청 및 담당 작업 목록'}
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* 기준일자 시뮬레이터 */}
            <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <Calendar className="h-4 w-4 text-slate-600" />
              <span className="text-xs font-medium text-slate-600">기준일:</span>
              <input
                type="date"
                aria-label="시스템 기준일자"
                value={systemReferenceDate}
                onChange={(e) => {
                  setSystemReferenceDate(e.target.value);
                  if (!editingTxId) {
                    setRequestDate(e.target.value);
                    setApprovalDate(e.target.value);
                  }
                }}
                className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-bold text-slate-800"
              />
            </div>

            {canManageRequest && (
              <button
                type="button"
                onClick={() => {
                  if (editingTxId) handleResetForm();
                  setIsFormOpen((prev) => !prev);
                }}
                className={`inline-flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-xs font-bold shadow-2xs transition-all border ${
                  isFormOpen
                    ? 'bg-slate-100 text-slate-800 border-slate-300 hover:bg-slate-200'
                    : 'bg-slate-900 text-white border-slate-900 hover:bg-slate-800'
                }`}
              >
                <FilePlus2 className="h-4 w-4" />
                {isFormOpen ? '폼 닫기' : '+ 신규 거래 승인요청'}
              </button>
            )}

            {/* 좌우 2분할 요율표 동시조회 토글 버튼 */}
            <button
              type="button"
              onClick={toggleRateTableSplit}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold shadow-2xs transition-all border ${
                isRateTableSplitOpen
                  ? 'bg-emerald-600 text-white border-emerald-500 hover:bg-emerald-700'
                  : 'bg-white text-slate-800 border-slate-300 hover:bg-slate-50'
              }`}
            >
              <Columns2 className="h-4 w-4" />
              {isRateTableSplitOpen
                ? `요율표 닫기 (${primaryCardCompany})`
                : `요율표 2분할 (${primaryCardCompany})`}
            </button>
          </div>
        </div>

        {/* 하단 통합 구글 시트 마스터 상태 스트립 */}
        <div className="bg-slate-900 px-5 py-2.5 text-white border-t border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-emerald-500/20 border border-emerald-400/40 text-emerald-200 font-bold">
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-300" />
              Sheets 연동됨
            </span>
            <span className="text-slate-400 font-mono">
              동기화: {lastMasterSheetSyncedAt} · 거래 {accessibleTransactions.length}건
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {!isCm && (
              <>
                <a
                  href={GOOGLE_SHEET_TABS.TRANSACTION_MASTER.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 transition-colors"
                >
                  <ExternalLink className="w-3 h-3" />
                  07_거래내역
                </a>
                <a
                  href={GOOGLE_SHEET_TABS.SPLIT_PAYMENT_DB.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 transition-colors"
                >
                  <ExternalLink className="w-3 h-3" />
                  08_분할결제
                </a>
                <button
                  type="button"
                  disabled={isSyncingMasterSheet}
                  onClick={() => pushAllMasterTabsToGoogleSheet('07_거래내역 & 08_분할결제 마스터')}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-400 hover:bg-amber-300 disabled:opacity-50 text-slate-950 text-xs font-bold cursor-pointer"
                >
                  <RefreshCw className={`w-3 h-3 ${isSyncingMasterSheet ? 'animate-spin' : ''}`} />
                  시트 반영 (Push)
                </button>
              </>
            )}

            <button
              type="button"
              onClick={() => {
                const tsv = serializeTransactionsToTsv(accessibleTransactions, users, isCm);
                navigator.clipboard.writeText(tsv);
                pushToast({
                  type: 'success',
                  title: isCm
                    ? '내 거래내역 (CM 수수료 전용) TSV 복사 완료'
                    : '07_거래내역_통합마스터 TSV 복사 완료',
                  description: '구글 시트 A1 셀을 선택하고 Ctrl+V를 누르면 표가 붙여넣어집니다.',
                });
              }}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 cursor-pointer"
            >
              <Copy className="w-3 h-3 text-emerald-300" />
              TSV 복사
            </button>
          </div>
        </div>
      </div>

      {/* =====================================================================
          메인 좌우 2분할 컨테이너 (isRateTableSplitOpen 시 좌측 7 : 우측 5 분할)
         ===================================================================== */}
      <div
        className={
          isRateTableSplitOpen
            ? 'grid grid-cols-1 xl:grid-cols-12 gap-6 items-start'
            : 'space-y-5'
        }
      >
        {/* 좌측 메인 영역 */}
        <div className={isRateTableSplitOpen ? 'xl:col-span-7 space-y-5' : 'space-y-5'}>
          {/* 1) CM 전용 예상 수수료 배너 (CM에게는 오직 CM 수수료만 노출) */}
          {isCm && (
            <div className="rounded-2xl bg-slate-900 border border-slate-800 p-5 text-white shadow-md">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="space-y-1.5">
                  <div className="inline-flex items-center gap-1.5 rounded-full bg-slate-800 px-3 py-1 text-xs font-semibold text-emerald-300 border border-slate-700">
                    <Coins className="h-3.5 w-3.5" />
                    내 이름으로 진행된 거래 CM 수수료 실시간 집계 (승인요청 총 {commissionSummary.activeCount}건)
                  </div>
                  <div className="flex flex-wrap items-baseline gap-3 pt-1">
                    <span className="text-xs text-slate-300">총 예상 CM 수수료:</span>
                    <span className="text-3xl font-black tracking-tight text-amber-300 tabular-nums">
                      {formatKRW(commissionSummary.totalCmCommission)}
                    </span>
                    <span className="text-xs text-slate-300 tabular-nums">
                      (누적 결제금액 {formatKRW(commissionSummary.totalAmount)})
                    </span>
                  </div>
                  <p className="flex items-center gap-1.5 text-[11px] text-amber-200/80 pt-1">
                    <AlertCircle className="h-3 w-3 shrink-0 text-amber-300" />
                    반려 건 제외 기준 금액이며 심사 진행 상태에 따라 변동될 수 있습니다.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3 sm:min-w-[300px]">
                  <div className="rounded-xl bg-slate-800/90 p-3 border border-slate-700">
                    <p className="text-xs font-medium text-slate-300">
                      승인 · 전표제출필요 · 거래완료
                    </p>
                    <p className="mt-1 text-base font-extrabold text-emerald-300 tabular-nums">
                      {formatKRW(commissionSummary.confirmedCmCommission)}
                    </p>
                  </div>
                  <div className="rounded-xl bg-slate-800/90 p-3 border border-slate-700">
                    <p className="text-xs font-medium text-slate-300">요청대기 · 심사중</p>
                    <p className="mt-1 text-base font-extrabold text-amber-200 tabular-nums">
                      {formatKRW(commissionSummary.pendingCmCommission)}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 2) AG / ADMIN 전용: 접기/펼치기 지원 [거래 승인요청 작성·수정 워크스페이스] */}
          {canManageRequest && (
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              {/* 폼 상단 헤더 바 (항상 노출되며 클릭 시 접기/펼치기 전환) */}
              <div className="bg-slate-900 px-5 py-3.5 text-white flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-800 border border-slate-700 text-slate-200">
                    <FilePlus2 className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-base font-extrabold">
                        {editingTxId
                          ? `거래 승인요청 수정 (${editingTxId})`
                          : '거래 승인요청 작성'}
                      </h2>
                      <span
                        style={{
                          backgroundColor: primaryCardColor.mainHex,
                          color: primaryCardColor.badgeTextHex,
                        }}
                        className="rounded-md px-2 py-0.5 text-xs font-black"
                      >
                        {primaryCardCompany}
                      </span>
                      <span className="text-xs text-slate-300 tabular-nums">
                        분할 {paymentSplits.length}건 · 총 {formatKRW(splitTotals.totalAmount)}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {editingTxId && (
                    <button
                      type="button"
                      onClick={handleResetForm}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 px-3 py-1.5 text-xs font-bold text-slate-200 border border-slate-700"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      신규 등록으로 전환
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setIsFormOpen((prev) => !prev)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 px-3 py-1.5 text-xs font-bold text-white border border-slate-700"
                  >
                    {isFormOpen ? (
                      <>
                        <ChevronUp className="h-4 w-4" />
                        폼 접기
                      </>
                    ) : (
                      <>
                        <ChevronDown className="h-4 w-4" />
                        입력 폼 펼치기
                      </>
                    )}
                  </button>
                </div>
              </div>

              {formFeedback && !isFormOpen && (
                <div
                  className={`flex items-center justify-between gap-3 px-5 py-3 text-xs font-bold border-t ${
                    formFeedback.type === 'error'
                      ? 'bg-rose-50 text-rose-800 border-rose-200'
                      : 'bg-emerald-50 text-emerald-900 border-emerald-200'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {formFeedback.type === 'error' ? (
                      <AlertCircle className="h-4 w-4 text-rose-600 shrink-0" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                    )}
                    <span>{formFeedback.message}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setFormFeedback(null)}
                    className="text-slate-500 hover:text-slate-800"
                  >
                    닫기
                  </button>
                </div>
              )}

              {isFormOpen && (
                <form onSubmit={handleSubmitAgForm} className="p-5 space-y-5">
                  {formFeedback && (
                    <div
                      className={`flex items-center justify-between gap-3 rounded-xl px-4 py-3 text-xs font-bold border ${
                        formFeedback.type === 'error'
                          ? 'bg-rose-50 text-rose-800 border-rose-200'
                          : 'bg-emerald-50 text-emerald-900 border-emerald-200'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        {formFeedback.type === 'error' ? (
                          <AlertCircle className="h-4 w-4 text-rose-600 shrink-0" />
                        ) : (
                          <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                        )}
                        <span>{formFeedback.message}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setFormFeedback(null)}
                        className="text-slate-400 hover:text-slate-700"
                      >
                        닫기
                      </button>
                    </div>
                  )}

                  {/* 섹션 A & B: [1. 거래 기본 정보] + [2. 담당 CM 정보] */}
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                    {/* 1. 거래 기본 정보 */}
                    <div className="lg:col-span-5 rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-3">
                      <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                        <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                          <Layers className="h-4 w-4 text-slate-600" />
                          1. 거래 기본 정보
                        </span>
                        <span className="text-xs font-medium text-slate-500">
                          상태 변경 시 승인일 자동 갱신
                        </span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label htmlFor="tx-customer-name" className="block text-xs font-bold text-slate-700 mb-1">
                            고객이름 <span className="text-rose-500">*</span>
                          </label>
                          <input
                            id="tx-customer-name"
                            type="text"
                            required
                            value={customerName}
                            onChange={(e) => setCustomerName(e.target.value)}
                            placeholder="예: 홍길동"
                            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-900 focus:border-slate-600 focus:outline-none"
                          />
                        </div>

                        <div>
                          <label htmlFor="tx-status-select" className="block text-xs font-bold text-slate-700 mb-1">
                            진행 상태 <span className="text-rose-500">*</span>
                          </label>
                          <select
                            id="tx-status-select"
                            value={txStatus}
                            onChange={(e) =>
                              handleFormStatusChange(e.target.value as ApprovalStatus)
                            }
                            aria-label="거래 상태"
                            className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs font-bold text-slate-900 focus:border-slate-600 focus:outline-none"
                          >
                            {APPROVAL_STATUS_LIST.map((st) => (
                              <option key={st} value={st}>
                                {APPROVAL_STATUS_META[st].label}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label htmlFor="tx-request-date" className="block text-xs font-medium text-slate-700 mb-1">
                            요청일자
                          </label>
                          <input
                            id="tx-request-date"
                            type="date"
                            value={requestDate}
                            onChange={(e) => setRequestDate(e.target.value)}
                            className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs font-medium text-slate-800"
                          />
                        </div>

                        <div>
                          <label htmlFor="tx-approval-date" className="block text-xs font-medium text-slate-700 mb-1">
                            승인일자 (상태변경일)
                          </label>
                          <input
                            id="tx-approval-date"
                            type="date"
                            value={approvalDate}
                            onChange={(e) => setApprovalDate(e.target.value)}
                            className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs font-bold text-slate-900"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                        <input
                          type="text"
                          aria-label="차량명"
                          value={vehicleInfo}
                          onChange={(e) => setVehicleInfo(e.target.value)}
                          placeholder="차량명 (선택: 예 그랜저 하이브리드)"
                          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs"
                        />
                        <input
                          type="text"
                          aria-label="진행 메모 및 특이사항"
                          value={requestMemo}
                          onChange={(e) => setRequestMemo(e.target.value)}
                          placeholder="진행 메모 / 특이사항 (선택)"
                          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs"
                        />
                      </div>

                      {txStatus === 'REJECTED' && (
                        <div>
                          <label htmlFor="tx-rejection-reason" className="block text-xs font-bold text-rose-700 mb-1">
                            반려 사유 <span className="text-rose-500">*</span>
                          </label>
                          <input
                            id="tx-rejection-reason"
                            type="text"
                            required
                            value={rejectionReason}
                            onChange={(e) => setRejectionReason(e.target.value)}
                            placeholder="반려 사유를 입력해 주세요"
                            className="w-full rounded-lg border border-rose-300 bg-rose-50/40 px-3 py-1.5 text-xs text-rose-900"
                          />
                        </div>
                      )}
                    </div>

                    {/* 2. 담당 CM 정보 */}
                    <div className="lg:col-span-7 rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-2">
                        <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                          <UserCheck className="h-4 w-4 text-slate-600" />
                          2. 담당 CM 정보
                          <span className="rounded bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-700">
                            등록 데이터 자동 연동
                          </span>
                        </span>

                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium text-slate-700">CM 선택:</span>
                          <select
                            value={selectedCmId}
                            onChange={(e) => setSelectedCmId(e.target.value)}
                            aria-label="연동할 CM 선택"
                            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-900 shadow-2xs focus:border-slate-600 focus:outline-none"
                          >
                            {cmUsers.map((cm) => (
                              <option key={cm.id} value={cm.id}>
                                {assignedCmIds.has(cm.id) ? '★ [담당] ' : ''}
                                {cm.name} ({cm.affiliation} · 사번 {cm.employeeId || '-'})
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      {selectedCmUser ? (
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                          <div className="rounded-lg bg-white p-2.5 border border-slate-200/80">
                            <span className="block text-xs font-medium text-slate-500">
                              이름
                            </span>
                            <span className="mt-0.5 block text-xs font-bold text-slate-900">
                              {selectedCmUser.name}
                            </span>
                          </div>
                          <div className="rounded-lg bg-white p-2.5 border border-slate-200/80">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-medium text-slate-500">
                                주민등록번호
                              </span>
                              <button
                                type="button"
                                aria-label={revealedRrnMap[`form-${selectedCmUser.id}`] ? '주민등록번호 마스킹 숨기기' : '주민등록번호 전체 열람'}
                                onClick={() => toggleRrnReveal(`form-${selectedCmUser.id}`)}
                                className="inline-flex items-center gap-1 min-h-6 px-2 py-0.5 rounded text-xs font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-400"
                              >
                                {revealedRrnMap[`form-${selectedCmUser.id}`] ? (
                                  <>
                                    <EyeOff className="h-3.5 w-3.5" /> 숨김
                                  </>
                                ) : (
                                  <>
                                    <Eye className="h-3.5 w-3.5" /> 열람
                                  </>
                                )}
                              </button>
                            </div>
                            <span className="mt-0.5 block font-mono text-xs font-bold text-slate-800">
                              {formatMaskedRrn(
                                selectedCmUser.rrn,
                                revealedRrnMap[`form-${selectedCmUser.id}`]
                              )}
                            </span>
                          </div>
                          <div className="rounded-lg bg-white p-2.5 border border-slate-200/80">
                            <span className="block text-xs font-medium text-slate-500">
                              사업자등록번호
                            </span>
                            <span className="mt-0.5 block font-mono text-xs font-bold text-slate-800">
                              {selectedCmUser.businessNumber || '214-19-48102'}
                            </span>
                          </div>
                          <div className="rounded-lg bg-white p-2.5 border border-slate-200/80">
                            <span className="text-xs font-medium text-slate-500 flex items-center gap-1">
                              <Phone className="h-3 w-3" /> 전화번호
                            </span>
                            <span className="mt-0.5 block font-mono text-xs font-bold text-slate-800">
                              {selectedCmUser.phone}
                            </span>
                          </div>
                          <div className="rounded-lg bg-white p-2.5 border border-slate-200/80">
                            <span className="text-xs font-medium text-slate-500 flex items-center gap-1">
                              <Building2 className="h-3 w-3" /> 소속
                            </span>
                            <span className="mt-0.5 block truncate text-xs font-bold text-slate-800">
                              {selectedCmUser.affiliation}
                            </span>
                          </div>
                          <div className="rounded-lg bg-white p-2.5 border border-slate-200/80">
                            <span className="block text-xs font-medium text-slate-500">
                              사번
                            </span>
                            <span className="mt-0.5 block font-mono text-xs font-bold text-slate-900">
                              {selectedCmUser.employeeId || 'HD-SC-201904'}
                            </span>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  {/* 섹션 C: [3. 결제 및 분할 조건 (2줄 4열 구조로 2분할 화면에서도 넉넉한 입력 폭 보장)] */}
                  <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-2.5">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                            <CreditCard className="h-4 w-4 text-slate-600" />
                            3. 결제 및 분할 조건
                          </span>
                          <span
                            style={{
                              backgroundColor: primaryCardColor.mainHex,
                              color: primaryCardColor.badgeTextHex,
                            }}
                            className="inline-flex items-center gap-1 rounded-md px-2.5 py-0.5 text-xs font-black"
                          >
                            <Lock className="h-3 w-3" />
                            기준 카드사 고정: {primaryCardCompany}
                          </span>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setRateTableSplitOpen(true)}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 px-3 py-2 text-xs font-bold text-slate-950 shadow-2xs transition-colors"
                        >
                          <Highlighter className="h-3.5 w-3.5" />
                          요율표 [{primaryCardCompany}] 하이라이트
                        </button>

                        <button
                          type="button"
                          onClick={handleAddSplitRow}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 px-3.5 py-2 text-xs font-bold text-white shadow-2xs transition-colors"
                        >
                          <Plus className="h-4 w-4" />
                          동일 카드사 분할 추가 ({paymentSplits.length}건)
                        </button>
                      </div>
                    </div>

                    {/* 분할 결제 행 리스트 (2줄 4열 구조) */}
                    <div className="space-y-3">
                      {paymentSplits.map((split, index) => {
                        const isLumpSum = split.paymentMethod === '일시불';
                        const rowCashbackAmt = isLumpSum
                          ? Math.round((split.amount * split.cashbackRate) / 100)
                          : 0;
                        const rowAgCommAmt = Math.round(
                          (split.amount * split.agCommissionRate) / 100
                        );
                        const rowCmCommAmt = Math.round(
                          (split.amount * split.cmCommissionRate) / 100
                        );
                        const isFocused = activeSplitIndex === index;
                        const isSecondarySplit = index > 0;

                        return (
                          <div
                            key={split.id}
                            role="button"
                            tabIndex={0}
                            aria-label={`결제 #${index + 1} 행 선택 (금액 ${formatKRW(split.amount || 0)})`}
                            onClick={() => setActiveSplitIndex(index)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                setActiveSplitIndex(index);
                              }
                            }}
                            className={`rounded-xl border p-4 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-800 ${
                              isFocused
                                ? 'border-slate-900 bg-white ring-2 ring-slate-900/10 shadow-2xs'
                                : 'border-slate-200 bg-white hover:border-slate-300'
                            }`}
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="inline-flex items-center justify-center rounded-md bg-slate-900 px-2.5 py-0.5 text-xs font-bold text-white">
                                  결제 #{index + 1}
                                </span>
                                <span className="text-xs font-bold text-slate-800 tabular-nums">
                                  {split.cardCompany} · {split.paymentMethod} ·{' '}
                                  <strong className="text-slate-900">
                                    {formatKRW(split.amount || 0)}
                                  </strong>
                                </span>
                                {isSecondarySplit && (
                                  <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 text-xs font-bold text-amber-800 border border-amber-200">
                                    <Lock className="h-3 w-3 text-amber-600" />
                                    결제 #1 카드사 고정
                                  </span>
                                )}
                                {isRateTableSplitOpen && isFocused && (
                                  <span className="rounded bg-emerald-50 px-2 py-0.5 text-xs font-bold text-emerald-800 border border-emerald-200">
                                    요율표 [적용] 대상 행
                                  </span>
                                )}
                              </div>

                              <div className="flex items-center gap-3 text-xs tabular-nums">
                                {isLumpSum && (
                                  <span className="font-bold text-blue-700">
                                    캐시백: {formatKRW(rowCashbackAmt)}
                                  </span>
                                )}
                                <span className="font-bold text-slate-700">
                                  AG수수료: {formatKRW(rowAgCommAmt)}
                                </span>
                                <span className="font-bold text-emerald-700">
                                  CM수수료: {formatKRW(rowCmCommAmt)}
                                </span>
                                {paymentSplits.length > 1 && (
                                  <button
                                    type="button"
                                    aria-label={`결제 #${index + 1} 행 삭제`}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleRemoveSplitRow(index);
                                    }}
                                    className="inline-flex items-center gap-1 min-h-7 px-2.5 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 text-xs font-bold text-rose-600 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-rose-400"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                    삭제
                                  </button>
                                )}
                              </div>
                            </div>

                            {/* 2줄 4열 그리드: 좌우 2분할 화면에서도 잘림 없이 여유로운 입력 폭 확보 */}
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                              {/* 1. 카드사 */}
                              <div>
                                <label htmlFor={`split-card-${split.id}`} className="block text-xs font-medium text-slate-600 mb-1">
                                  {isSecondarySplit ? '카드사 (결제 #1 고정)' : '카드사 (기준 카드사)'}
                                </label>
                                {isSecondarySplit ? (
                                  <div
                                    id={`split-card-${split.id}`}
                                    title="결제 분할 시 다른 카드사로 분할 결제할 수 없으며, 결제 #1의 카드사로 고정됩니다."
                                    className="flex items-center justify-between gap-1 w-full rounded-lg border border-amber-300 bg-amber-50/70 px-2.5 py-2 text-xs font-bold text-amber-950 select-none cursor-not-allowed"
                                  >
                                    <span className="truncate">{split.cardCompany}</span>
                                    <span className="inline-flex items-center gap-0.5 rounded bg-amber-200/80 px-1.5 py-0.5 text-xs font-bold text-amber-900 shrink-0">
                                      <Lock className="h-3 w-3" />
                                      고정
                                    </span>
                                  </div>
                                ) : (
                                  <select
                                    id={`split-card-${split.id}`}
                                    value={split.cardCompany}
                                    onChange={(e) =>
                                      updateSplitRow(0, {
                                        cardCompany: e.target.value as SplitCardCompany,
                                      })
                                    }
                                    className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs font-bold text-slate-900 focus:border-slate-600"
                                  >
                                    {SPLIT_CARD_COMPANIES.map((c) => (
                                      <option key={c} value={c}>
                                        {c}
                                      </option>
                                    ))}
                                  </select>
                                )}
                              </div>

                              {/* 2. 결제방법 */}
                              <div>
                                <label htmlFor={`split-method-${split.id}`} className="block text-xs font-medium text-slate-600 mb-1">
                                  결제방법
                                </label>
                                <select
                                  id={`split-method-${split.id}`}
                                  value={split.paymentMethod}
                                  onChange={(e) =>
                                    updateSplitRow(index, {
                                      paymentMethod: e.target.value as SplitPaymentMethod,
                                    })
                                  }
                                  className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs font-bold text-slate-900"
                                >
                                  {SPLIT_PAYMENT_METHODS.map((m) => (
                                    <option key={m} value={m}>
                                      {m}
                                    </option>
                                  ))}
                                </select>
                              </div>

                              {/* 3. 결제 금액 */}
                              <div>
                                <label htmlFor={`split-amount-${split.id}`} className="block text-xs font-medium text-slate-700 mb-1">
                                  결제 금액 ({(split.amount / 10000).toLocaleString()}만원)
                                </label>
                                <input
                                  id={`split-amount-${split.id}`}
                                  type="number"
                                  step="100000"
                                  min="0"
                                  value={split.amount || ''}
                                  onChange={(e) =>
                                    updateSplitRow(index, {
                                      amount: parseInt(e.target.value, 10) || 0,
                                    })
                                  }
                                  placeholder="결제 금액 (원)"
                                  className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs font-bold text-slate-900 tabular-nums"
                                />
                              </div>

                              {/* 4. 할부개월 */}
                              <div>
                                <label htmlFor={`split-months-${split.id}`} className="block text-xs font-medium text-slate-600 mb-1">
                                  할부개월 {isLumpSum ? '(일시불 1달)' : ''}
                                </label>
                                {isLumpSum ? (
                                  <input
                                    id={`split-months-${split.id}`}
                                    type="text"
                                    disabled
                                    value="1달 (일시불)"
                                    className="w-full rounded-lg border border-slate-200 bg-slate-100 px-2.5 py-2 text-xs font-medium text-slate-500"
                                  />
                                ) : (
                                  <select
                                    id={`split-months-${split.id}`}
                                    value={split.installmentMonths}
                                    onChange={(e) =>
                                      updateSplitRow(index, {
                                        installmentMonths: parseInt(e.target.value, 10) || 36,
                                      })
                                    }
                                    className="w-full rounded-lg border border-amber-300 bg-amber-50/40 px-2.5 py-2 text-xs font-bold text-amber-950"
                                  >
                                    {[12, 24, 36, 48, 60, 72].map((m) => (
                                      <option key={m} value={m}>
                                        {m}개월
                                      </option>
                                    ))}
                                  </select>
                                )}
                              </div>

                              {/* 5. 캐시백 */}
                              <div>
                                <label htmlFor={`split-cb-${split.id}`} className="block text-xs font-medium text-blue-700 mb-1">
                                  캐시백 (%) {isLumpSum ? '' : '(일시불 전용)'}
                                </label>
                                <input
                                  id={`split-cb-${split.id}`}
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  max="10"
                                  disabled={!isLumpSum}
                                  value={isLumpSum ? split.cashbackRate : 0}
                                  onChange={(e) =>
                                    updateSplitRow(index, {
                                      cashbackRate: parseFloat(e.target.value) || 0,
                                    })
                                  }
                                  className="w-full rounded-lg border border-blue-200 bg-white disabled:bg-slate-100 disabled:text-slate-400 px-2.5 py-2 text-xs font-bold text-blue-700 tabular-nums"
                                />
                              </div>

                              {/* 6. 할부 금리 */}
                              <div>
                                <label htmlFor={`split-interest-${split.id}`} className="block text-xs font-medium text-amber-700 mb-1">
                                  할부 금리 (%) {isLumpSum ? '(할부 전용)' : ''}
                                </label>
                                <input
                                  id={`split-interest-${split.id}`}
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  max="20"
                                  disabled={isLumpSum}
                                  value={isLumpSum ? 0 : split.interestRate}
                                  onChange={(e) =>
                                    updateSplitRow(index, {
                                      interestRate: parseFloat(e.target.value) || 0,
                                    })
                                  }
                                  className="w-full rounded-lg border border-amber-200 bg-white disabled:bg-slate-100 disabled:text-slate-400 px-2.5 py-2 text-xs font-bold text-amber-800 tabular-nums"
                                />
                              </div>

                              {/* 7. AG 수수료율 */}
                              <div>
                                <label htmlFor={`split-ag-${split.id}`} className="block text-xs font-medium text-slate-700 mb-1">
                                  AG 수수료율 (%)
                                </label>
                                <input
                                  id={`split-ag-${split.id}`}
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  max="10"
                                  value={split.agCommissionRate}
                                  onChange={(e) =>
                                    updateSplitRow(index, {
                                      agCommissionRate: parseFloat(e.target.value) || 0,
                                    })
                                  }
                                  className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs font-bold text-slate-900 tabular-nums"
                                />
                              </div>

                              {/* 8. CM 수수료율 */}
                              <div>
                                <label htmlFor={`split-cm-${split.id}`} className="block text-xs font-medium text-emerald-700 mb-1">
                                  CM 수수료율 (%)
                                </label>
                                <input
                                  id={`split-cm-${split.id}`}
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  max="10"
                                  value={split.cmCommissionRate}
                                  onChange={(e) =>
                                    updateSplitRow(index, {
                                      cmCommissionRate: parseFloat(e.target.value) || 0,
                                    })
                                  }
                                  className="w-full rounded-lg border border-emerald-200 bg-emerald-50/40 px-2.5 py-2 text-xs font-bold text-emerald-800 tabular-nums"
                                />
                              </div>
                            </div>

                            {/* 별도 조건 메모 및 빠른 금액 버튼 */}
                            <div className="mt-3 flex flex-wrap items-center gap-2">
                              <input
                                type="text"
                                aria-label={`결제 #${index + 1} 별도 조건 메모`}
                                value={split.customConditionNote || ''}
                                onChange={(e) =>
                                  updateSplitRow(index, {
                                    customConditionNote: e.target.value,
                                  })
                                }
                                placeholder="별도 조건 메모 (예: 선수금 2,500만 가상계좌 선입금 / 중도상환수수료 면제 특약 등)"
                                className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-700 focus:bg-white focus:border-slate-500 focus:outline-none"
                              />
                              <div className="flex items-center gap-1.5">
                                {[1000, 2000, 3000, 5000].map((man) => (
                                  <button
                                    key={man}
                                    type="button"
                                    aria-label={`금액 ${man}만원으로 설정`}
                                    onClick={() =>
                                      updateSplitRow(index, { amount: man * 10000 })
                                    }
                                    className="min-h-7 px-2.5 py-1 rounded border border-slate-200 bg-slate-100 hover:bg-slate-200 text-xs font-medium text-slate-700 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-400"
                                  >
                                    {man.toLocaleString()}만
                                  </button>
                                ))}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* 하단 + 버튼 (동일 카드사 고정 분할 추가) */}
                    <button
                      type="button"
                      onClick={handleAddSplitRow}
                      className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-white hover:bg-slate-50 py-2.5 text-xs font-bold text-slate-700 transition-colors"
                    >
                      <Plus className="h-4 w-4" />
                      동일 카드사({primaryCardCompany}) 분할결제 행 추가
                    </button>

                    {/* 선택된 카드사 · 결제방법 맞춤 프로모션 하단 추가 옵션 */}
                    <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-2.5">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                              <Gift className="h-4 w-4 text-amber-600" />
                              카드사 · 결제방법 맞춤 프로모션 ({primaryCardCompany} ·{' '}
                              {selectedPaymentMethods.join(' + ')})
                            </span>
                            <span className="rounded-full bg-slate-100 border border-slate-200 px-2.5 py-0.5 text-xs font-bold text-slate-700">
                              적용 가능 {matchingCardPromotions.length}건 · 선택{' '}
                              {appliedPromotions.length}건
                            </span>
                          </div>
                        </div>
                      </div>

                      {matchingCardPromotions.length === 0 ? (
                        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 py-6 text-center text-xs text-slate-500">
                          현재 선택한 <strong>{primaryCardCompany}</strong> ({selectedPaymentMethods.join(', ')}) 조건에 해당하는 진행 중 프로모션이 없습니다.
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 gap-2.5">
                          {matchingCardPromotions.map((promo) => {
                            const isApplied = appliedPromotions.some(
                              (p) => p.promotionId === promo.id
                            );
                            const cardColor = CARD_COMPANY_COLORS[promo.cardCompany];
                            const targetAmt =
                              promo.paymentMethod === '통합'
                                ? splitTotals.totalAmount
                                : paymentSplits
                                    .filter((s) => s.paymentMethod === promo.paymentMethod)
                                    .reduce((sum, s) => sum + (Number(s.amount) || 0), 0);
                            const meetsAmountCondition =
                              targetAmt >= promo.minAmount &&
                              (promo.maxAmount === null || targetAmt <= promo.maxAmount);
                            const cbDelta = Number(promo.cashbackRateDelta) || 0;
                            const intDelta = Number(promo.interestRateDelta) || 0;
                            const estAgPromoAmt =
                              Math.round((targetAmt * promo.agIncentiveRate) / 100) +
                              promo.agIncentiveAmount;
                            const estCmPromoAmt =
                              Math.round((targetAmt * promo.cmIncentiveRate) / 100) +
                              promo.cmIncentiveAmount;
                            const bulletLines = promo.promotionConditionText
                              .split('\n')
                              .map((line) => line.trim())
                              .filter(Boolean);

                            return (
                              <div
                                key={promo.id}
                                role="button"
                                tabIndex={0}
                                aria-label={`프로모션 ${promo.title} ${isApplied ? '적용됨 (클릭 시 해제)' : '추가하기'}`}
                                onClick={() => handleTogglePromotion(promo)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    handleTogglePromotion(promo);
                                  }
                                }}
                                className={`rounded-xl border p-3.5 transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-800 ${
                                  isApplied
                                    ? 'border-2 border-slate-900 bg-slate-50 ring-2 ring-slate-900/10 shadow-2xs'
                                    : 'border-slate-200 bg-white hover:border-slate-300'
                                }`}
                              >
                                <div className="flex flex-col gap-2.5 sm:flex-row sm:items-start sm:justify-between">
                                  <div className="space-y-1.5 flex-1">
                                    <div className="flex flex-wrap items-center gap-1.5">
                                      <span
                                        style={{
                                          backgroundColor: cardColor.mainHex,
                                          color: cardColor.badgeTextHex,
                                        }}
                                        className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-black shadow-2xs"
                                      >
                                        {promo.cardCompany}
                                      </span>
                                      <span
                                        className={`rounded-md px-2 py-0.5 text-xs font-bold ${
                                          promo.paymentMethod === '통합'
                                            ? 'bg-slate-100 text-slate-800 border border-slate-300'
                                            : promo.paymentMethod === '일시불'
                                            ? 'bg-blue-50 text-blue-700 border border-blue-200'
                                            : 'bg-amber-50 text-amber-800 border border-amber-200'
                                        }`}
                                      >
                                        결제방법: {promo.paymentMethod}
                                      </span>
                                      <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                                        금액조건: {promo.amountConditionLabel}
                                      </span>
                                      <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                                        기간: {promo.startDate} ~ {promo.endDate || '계속 진행'}
                                      </span>
                                      {meetsAmountCondition ? (
                                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-800 border border-emerald-300">
                                          ✓ 조건 충족 ({formatKRW(targetAmt)})
                                        </span>
                                      ) : (
                                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 border border-amber-300">
                                          대상금액 {formatKRW(targetAmt)} (기준: {promo.amountConditionLabel})
                                        </span>
                                      )}
                                    </div>

                                    <div className="text-xs font-bold text-slate-900">
                                      {promo.title}
                                    </div>

                                    {/* 캐시백/금리/AG/CM 요율 가감 (±% 마이너스 반영 포함) & 정액 배지 */}
                                    <div className="flex flex-wrap items-center gap-2 pt-0.5 text-xs tabular-nums">
                                      {cbDelta !== 0 && (
                                        <span
                                          className={`rounded-lg border px-2.5 py-1 font-bold ${
                                            cbDelta < 0
                                              ? 'bg-rose-50 border-rose-200 text-rose-800'
                                              : 'bg-blue-50 border-blue-200 text-blue-800'
                                          }`}
                                        >
                                          캐시백: {formatSignedRate(cbDelta)}
                                        </span>
                                      )}
                                      {intDelta !== 0 && (
                                        <span
                                          className={`rounded-lg border px-2.5 py-1 font-bold ${
                                            intDelta < 0
                                              ? 'bg-amber-50 border-amber-300 text-amber-900'
                                              : 'bg-rose-50 border-rose-200 text-rose-800'
                                          }`}
                                        >
                                          할부 금리: {formatSignedRate(intDelta)}
                                        </span>
                                      )}
                                      <span
                                        className={`rounded-lg border px-2.5 py-1 font-bold ${
                                          promo.agIncentiveRate < 0 || estAgPromoAmt < 0
                                            ? 'bg-rose-50 border-rose-200 text-rose-800'
                                            : 'bg-slate-100 border-slate-200 text-slate-800'
                                        }`}
                                      >
                                        AG: {formatSignedRate(promo.agIncentiveRate)} / 정액{' '}
                                        {formatSignedKRW(promo.agIncentiveAmount)} (예상{' '}
                                        {formatSignedKRW(estAgPromoAmt)})
                                      </span>
                                      <span
                                        className={`rounded-lg border px-2.5 py-1 font-bold ${
                                          promo.cmIncentiveRate < 0 || estCmPromoAmt < 0
                                            ? 'bg-rose-50 border-rose-200 text-rose-800'
                                            : 'bg-emerald-50 border-emerald-200 text-emerald-800'
                                        }`}
                                      >
                                        CM: {formatSignedRate(promo.cmIncentiveRate)} / 정액{' '}
                                        {formatSignedKRW(promo.cmIncentiveAmount)} (예상{' '}
                                        {formatSignedKRW(estCmPromoAmt)})
                                      </span>
                                    </div>

                                    {/* 불릿포인트 식 프로모션 조건 설명 */}
                                    <ul className="mt-1.5 space-y-0.5 rounded-lg bg-slate-50 border border-slate-200/80 px-3 py-2 text-xs text-slate-600">
                                      {bulletLines.map((line, lIdx) => (
                                        <li key={lIdx} className="leading-relaxed">
                                          {line.startsWith('•') || line.startsWith('-')
                                            ? line
                                            : `• ${line}`}
                                        </li>
                                      ))}
                                    </ul>
                                  </div>

                                  <div className="shrink-0">
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleTogglePromotion(promo);
                                      }}
                                      className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold shadow-2xs transition-all ${
                                        isApplied
                                          ? 'bg-slate-900 text-white hover:bg-slate-800'
                                          : 'bg-white text-slate-800 border border-slate-300 hover:bg-slate-50'
                                      }`}
                                    >
                                      {isApplied ? (
                                        <>
                                          <Check className="h-4 w-4" />
                                          적용됨 (해제)
                                        </>
                                      ) : (
                                        <>
                                          <Plus className="h-4 w-4" />
                                          프로모션 추가
                                        </>
                                      )}
                                    </button>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* 분할 결제 실시간 합산 바 + 등록/수정 제출 버튼 */}
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-xl bg-slate-900 p-4 text-white">
                      <div className="flex flex-wrap items-center gap-4 text-xs">
                        <div>
                          <span className="text-slate-400 block">
                            총 결제금액 ({primaryCardCompany} · {paymentSplits.length}건)
                          </span>
                          <span className="text-base font-black text-white tabular-nums">
                            {formatKRW(splitTotals.totalAmount)}
                          </span>
                        </div>
                        <div className="h-7 w-px bg-slate-700 hidden sm:block" />
                        <div>
                          <span className="text-slate-400 block">
                            일시불 캐시백 합계
                            {splitTotals.promoCashbackDeltaAmount !== 0 &&
                              ` (프로모션 ${formatSignedKRW(splitTotals.promoCashbackDeltaAmount)})`}
                          </span>
                          <span className="text-sm font-extrabold text-sky-300 tabular-nums">
                            {formatKRW(splitTotals.totalCashbackAmount)}
                          </span>
                        </div>
                        {splitTotals.installmentAmount > 0 && (
                          <>
                            <div className="h-7 w-px bg-slate-700 hidden sm:block" />
                            <div>
                              <span className="text-amber-300 block">
                                할부 적용 금리
                                {splitTotals.promoInterestRateDelta !== 0 &&
                                  ` (${formatSignedRate(splitTotals.promoInterestRateDelta)})`}
                              </span>
                              <span className="text-sm font-extrabold text-amber-300 tabular-nums">
                                {splitTotals.effectiveInterestRate.toFixed(2)}%
                              </span>
                            </div>
                          </>
                        )}
                        <div className="h-7 w-px bg-slate-700 hidden sm:block" />
                        <div>
                          <span className="text-slate-300 block">
                            AG 수수료 합계 (평균 {splitTotals.weightedAgRate}%)
                          </span>
                          <span className="text-sm font-extrabold text-white tabular-nums">
                            {formatKRW(splitTotals.totalAgCommission)}
                          </span>
                        </div>
                        <div className="h-7 w-px bg-slate-700 hidden sm:block" />
                        <div>
                          <span className="text-emerald-300 block">
                            CM 수수료 합계 (평균 {splitTotals.weightedCmRate}%)
                          </span>
                          <span className="text-sm font-extrabold text-emerald-300 tabular-nums">
                            {formatKRW(splitTotals.totalCmCommission)}
                          </span>
                        </div>
                      </div>

                      <button
                        type="submit"
                        className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 px-5 py-2.5 text-sm font-bold text-white shadow-sm transition-colors cursor-pointer"
                      >
                        <CheckCircle2 className="h-4 w-4" />
                        {editingTxId ? '거래 승인요청 수정 저장' : '거래 승인요청 등록'}
                      </button>
                    </div>
                  </div>
                </form>
              )}
            </div>
          )}

          {/* =================================================================
              3) 하단: 6단계 상태 필터 카드 + 담당 작업 목록 (또는 CM 내 거래 내역)
             ================================================================= */}
          <div className="space-y-4">
            {/* 6단계 상태 탭 */}
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5">
              {(
                [
                  { key: 'ALL', label: '전체 거래', count: counts.ALL },
                  { key: 'WAITING', label: '요청대기', count: counts.WAITING },
                  { key: 'REVIEWING', label: '심사중', count: counts.REVIEWING },
                  { key: 'APPROVED', label: '승인', count: counts.APPROVED },
                  { key: 'REJECTED', label: '반려', count: counts.REJECTED },
                  { key: 'SLIP_REQUIRED', label: '전표제출필요', count: counts.SLIP_REQUIRED },
                  { key: 'COMPLETED', label: '거래완료', count: counts.COMPLETED },
                ] as const
              ).map((card) => {
                const active = statusFilter === card.key;
                return (
                  <button
                    key={card.key}
                    type="button"
                    onClick={() => setStatusFilter(card.key)}
                    className={`rounded-xl border p-3 text-left transition-all ${
                      active
                        ? 'border-slate-900 bg-slate-900 text-white shadow-2xs'
                        : 'border-slate-200 bg-white hover:border-slate-300 text-slate-900'
                    }`}
                  >
                    <p
                      className={`text-xs font-medium truncate ${
                        active ? 'text-slate-300' : 'text-slate-500'
                      }`}
                    >
                      {card.label}
                    </p>
                    <p className="mt-1 text-xl font-black tabular-nums">
                      {card.count}
                      <span
                        className={`ml-0.5 text-xs font-medium ${
                          active ? 'text-slate-300' : 'text-slate-400'
                        }`}
                      >
                        건
                      </span>
                    </p>
                  </button>
                );
              })}
            </div>

            {/* 검색 및 카드사·CM 필터 바 */}
            <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs sm:flex-row sm:items-center sm:justify-between">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="고객이름, 거래번호, CM 이름/소속/사번, 카드사, 프로모션 검색..."
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-10 pr-4 text-xs font-medium text-slate-900 focus:border-slate-500 focus:bg-white focus:outline-none"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <select
                  aria-label="카드사 필터"
                  value={cardFilter}
                  onChange={(e) => setCardFilter(e.target.value as 'ALL' | SplitCardCompany)}
                  className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700"
                >
                  <option value="ALL">카드사 전체</option>
                  {SPLIT_CARD_COMPANIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>

                {!isCm && (
                  <select
                    aria-label="CM 필터"
                    value={cmFilter}
                    onChange={(e) => setCmFilter(e.target.value)}
                    className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700"
                  >
                    <option value="ALL">담당 CM 전체</option>
                    {cmUsers.map((cm) => (
                      <option key={cm.id} value={cm.id}>
                        {cm.name} ({cm.affiliation})
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>

            {/* 거래 목록 테이블 */}
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xs">
              <div className="border-b border-slate-200 bg-slate-50 px-5 py-3 flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-bold text-slate-800">
                  {isCm
                    ? `내 이름으로 진행된 거래 목록 (${filteredTransactions.length}건)`
                    : `담당 작업 목록 (${filteredTransactions.length}건)`}
                </span>
                {canManageRequest && !isFormOpen && (
                  <button
                    type="button"
                    onClick={() => {
                      handleResetForm();
                      setIsFormOpen(true);
                    }}
                    className="inline-flex items-center gap-1 rounded-lg bg-slate-900 hover:bg-slate-800 px-3 py-1.5 text-xs font-bold text-white"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    신규 거래 승인요청 작성
                  </button>
                )}
              </div>

              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-100/80 text-xs font-bold text-slate-600">
                      <th className="py-3 pl-5 pr-3">고객 · 요청/승인일</th>
                      <th className="py-3 px-3">진행 상태</th>
                      <th className="py-3 px-3">담당 CM</th>
                      <th className="py-3 px-3">
                        결제 · 프로모션 · {isCm ? 'CM수수료' : 'AG/CM수수료'}
                      </th>
                      <th className="py-3 px-3">전표 · 시트</th>
                      <th className="py-3 pl-3 pr-5 text-right">관리</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-xs">
                    {filteredTransactions.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-12 text-center text-slate-500">
                          조건에 해당하는 거래 내역이 없습니다.
                        </td>
                      </tr>
                    ) : (
                      filteredTransactions.map((tx) => {
                        const cmComm = calcExpectedCommission(tx);
                        const agComm = calcExpectedAgCommission(tx);
                        const splits = tx.paymentSplits || [];
                        const promos = tx.appliedPromotions || [];
                        const cmInfo = tx.cmProfile;
                        const isBeingEdited = editingTxId === tx.id;
                        const isRrnRevealed = Boolean(revealedRrnMap[tx.id]);

                        return (
                          <tr
                            key={tx.id}
                            className={`transition-colors ${
                              isBeingEdited
                                ? 'bg-slate-100/80'
                                : 'hover:bg-slate-50/90'
                            }`}
                          >
                            {/* 1. 거래정보 */}
                            <td className="py-3.5 pl-5 pr-3 align-top">
                              <div className="font-mono text-xs font-semibold text-slate-500">
                                {tx.id}
                              </div>
                              <div className="mt-0.5 text-sm font-black text-slate-900">
                                {tx.customerName} 고객
                              </div>
                              <div className="mt-1 space-y-0.5 text-xs text-slate-500 tabular-nums">
                                <div>요청일: {tx.requestDate || tx.createdAt.slice(0, 10)}</div>
                                <div className="font-medium text-slate-700">
                                  승인일: {tx.approvalDate || tx.updatedAt.slice(0, 10)}
                                </div>
                              </div>
                            </td>

                            {/* 2. 상태 (반려 선택 시 사유 입력 가드 적용) */}
                            <td className="py-3.5 px-3 align-top">
                              <ApprovalStatusBadge status={tx.status} />
                              {canManageRequest && (
                                <div className="mt-2 space-y-1.5">
                                  <select
                                    aria-label={`${tx.customerName} 거래 상태 즉시 변경`}
                                    value={
                                      pendingRejectTxId === tx.id ? 'REJECTED' : tx.status
                                    }
                                    onChange={(e) => {
                                      const nextSt = e.target.value as ApprovalStatus;
                                      if (nextSt === 'REJECTED') {
                                        setPendingRejectTxId(tx.id);
                                        setInlineRejectReason(tx.rejectionReason || '');
                                        return;
                                      }
                                      setPendingRejectTxId(null);
                                      quickChangeTransactionStatus(
                                        tx.id,
                                        nextSt,
                                        systemReferenceDate
                                      );
                                    }}
                                    className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-bold text-slate-800 hover:border-slate-500"
                                  >
                                    {APPROVAL_STATUS_LIST.map((st) => (
                                      <option key={st} value={st}>
                                        → {APPROVAL_STATUS_META[st].label}
                                      </option>
                                    ))}
                                  </select>

                                  {pendingRejectTxId === tx.id && (
                                    <div className="rounded-lg border border-rose-200 bg-rose-50 p-2 space-y-1.5 w-48">
                                      <input
                                        type="text"
                                        value={inlineRejectReason}
                                        onChange={(e) => setInlineRejectReason(e.target.value)}
                                        placeholder="반려 사유 입력..."
                                        className="w-full rounded border border-rose-300 bg-white px-2 py-1 text-xs text-slate-900"
                                      />
                                      <div className="flex items-center gap-1">
                                        <button
                                          type="button"
                                          onClick={() => {
                                            if (!inlineRejectReason.trim()) {
                                              pushToast({
                                                type: 'warning',
                                                title: '반려 사유를 입력해 주세요',
                                                description: '반려 상태 변경 시 사유 기록이 필요합니다.',
                                              });
                                              return;
                                            }
                                            quickChangeTransactionStatus(
                                              tx.id,
                                              'REJECTED',
                                              systemReferenceDate,
                                              inlineRejectReason.trim()
                                            );
                                            setPendingRejectTxId(null);
                                            setInlineRejectReason('');
                                          }}
                                          className="flex-1 rounded bg-rose-600 hover:bg-rose-700 px-2 py-1 text-xs font-bold text-white"
                                        >
                                          반려 확정
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setPendingRejectTxId(null);
                                            setInlineRejectReason('');
                                          }}
                                          className="rounded bg-white border border-slate-300 px-2 py-1 text-xs font-medium text-slate-600"
                                        >
                                          취소
                                        </button>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}
                            </td>

                            {/* 3. CM 정보 (주민등록번호 기본 마스킹 + 클릭 시 열람) */}
                            <td className="py-3.5 px-3 align-top">
                              <div className="font-bold text-slate-900">
                                {cmInfo?.name}{' '}
                                <span className="font-mono text-xs font-medium text-slate-500">
                                  ({cmInfo?.employeeId})
                                </span>
                              </div>
                              <div className="text-xs font-medium text-slate-600">
                                {cmInfo?.affiliation}
                              </div>
                              <div className="mt-1 space-y-0.5 font-mono text-xs text-slate-500">
                                <div className="flex items-center gap-1.5">
                                  <span>주민: {formatMaskedRrn(cmInfo?.rrn, isRrnRevealed)}</span>
                                  <button
                                    type="button"
                                    aria-label={isRrnRevealed ? '주민등록번호 마스킹 숨기기' : '주민등록번호 전체 열람'}
                                    onClick={() => toggleRrnReveal(tx.id)}
                                    className="font-sans text-xs font-medium text-slate-600 underline hover:text-slate-900 min-h-6 px-1.5 py-0.5 rounded focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-400"
                                  >
                                    {isRrnRevealed ? '숨김' : '열람'}
                                  </button>
                                </div>
                                <div>사업자: {cmInfo?.businessNumber}</div>
                                <div>연락처: {cmInfo?.phone}</div>
                              </div>
                            </td>

                            {/* 4. 결제정보 (분할결제 내역 + 적용 프로모션 + CM/AG 수수료 표기) */}
                            <td className="py-3.5 px-3 align-top">
                              <div className="space-y-1.5">
                                {splits.map((s, idx) => {
                                  const sColor = CARD_COMPANY_COLORS[s.cardCompany];
                                  return (
                                    <div
                                      key={s.id || idx}
                                      className="rounded-lg border border-slate-200/90 bg-slate-50/70 px-2.5 py-1.5 text-xs"
                                    >
                                      <div className="flex flex-wrap items-center gap-1.5">
                                        <span
                                          style={{
                                            backgroundColor: sColor.mainHex,
                                            color: sColor.badgeTextHex,
                                          }}
                                          className="rounded px-2 py-0.5 text-xs font-black"
                                        >
                                          {s.cardCompany}
                                        </span>
                                        <span className="font-bold text-slate-900">
                                          [{s.paymentMethod}]
                                        </span>
                                        <span className="font-black text-slate-900 tabular-nums">
                                          {formatNumber(s.amount)}원
                                        </span>
                                        <span className="text-slate-400">/</span>
                                        {s.paymentMethod === '일시불' ? (
                                          <span className="font-bold text-blue-700 tabular-nums">
                                            1달 · 캐시백 {s.cashbackRate}%
                                          </span>
                                        ) : (
                                          <span className="font-bold text-amber-800 tabular-nums">
                                            {s.installmentMonths}개월 · 금리 {s.interestRate}%
                                          </span>
                                        )}
                                        <span className="text-slate-400">/</span>
                                        {!isCm && (
                                          <span className="font-bold text-slate-700 tabular-nums">
                                            AG {s.agCommissionRate}%
                                          </span>
                                        )}
                                        <span className="font-bold text-emerald-700 tabular-nums">
                                          CM {s.cmCommissionRate}%
                                        </span>
                                      </div>
                                      {s.customConditionNote && (
                                        <div className="text-xs text-slate-500 mt-0.5">
                                          조건: {s.customConditionNote}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}

                                {/* 적용된 프로모션 표시 (±% 마이너스 반영 포함) */}
                                {promos.length > 0 && (
                                  <div className="space-y-1 pt-0.5">
                                    {promos.map((p) => {
                                      const cbD = Number(p.cashbackRateDelta) || 0;
                                      const intD = Number(p.interestRateDelta) || 0;
                                      return (
                                        <div
                                          key={p.promotionId}
                                          className="flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-100/80 px-2.5 py-1 text-xs font-medium text-slate-800 tabular-nums"
                                        >
                                          <Gift className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                                          <span className="font-bold">[프로모션] {p.title}</span>
                                          <span className="text-slate-400">|</span>
                                          {cbD !== 0 && (
                                            <span className="text-blue-700 font-bold">
                                              캐시백 {formatSignedRate(cbD)}
                                            </span>
                                          )}
                                          {intD !== 0 && (
                                            <span className="text-amber-800 font-bold">
                                              금리 {formatSignedRate(intD)}
                                            </span>
                                          )}
                                          {!isCm && (
                                            <span
                                              className={
                                                p.agIncentiveRate < 0
                                                  ? 'text-rose-700 font-bold'
                                                  : 'text-slate-700 font-bold'
                                              }
                                            >
                                              AG {formatSignedRate(p.agIncentiveRate)}
                                              {p.agIncentiveAmount !== 0 &&
                                                ` (${formatSignedKRW(p.agIncentiveAmount)})`}
                                            </span>
                                          )}
                                          <span
                                            className={
                                              p.cmIncentiveRate < 0
                                                ? 'text-rose-700 font-bold'
                                                : 'text-emerald-700 font-bold'
                                            }
                                          >
                                            CM {formatSignedRate(p.cmIncentiveRate)}
                                            {p.cmIncentiveAmount !== 0 &&
                                              ` (${formatSignedKRW(p.cmIncentiveAmount)})`}
                                          </span>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}

                                {/* 합산 요약 라인 (CM 화면 포맷: "32,000,000원 / 캐시백 1.75% / 예상수수료 xxx원" & AG 수수료 비노출) */}
                                <div className="pt-1 text-xs font-extrabold text-slate-900 tabular-nums">
                                  <span>{formatNumber(tx.amount)}원</span>
                                  <span className="mx-1.5 text-slate-300">/</span>
                                  <span className="text-blue-700">
                                    캐시백 {tx.conditionSnapshot.customerCashbackRate}%
                                  </span>
                                  <span className="mx-1.5 text-slate-300">/</span>
                                  {isCm ? (
                                    <span className="text-emerald-700">
                                      예상수수료 {formatKRW(cmComm)}
                                    </span>
                                  ) : (
                                    <>
                                      <span className="text-slate-800">
                                        AG수수료 {formatKRW(agComm)}
                                      </span>
                                      <span className="mx-1.5 text-slate-300">·</span>
                                      <span className="text-emerald-700">
                                        CM수수료 {formatKRW(cmComm)}
                                      </span>
                                    </>
                                  )}
                                </div>
                              </div>
                            </td>

                            {/* 5. 전표 · 시트 */}
                            <td className="py-3.5 px-3 align-top">
                              <SlipAndSheetBadge tx={tx} />
                            </td>

                            {/* 6. 작업 버튼 */}
                            <td className="py-3.5 pl-3 pr-5 text-right align-top whitespace-nowrap">
                              <div className="inline-flex flex-col items-end gap-1.5">
                                {canManageRequest && (
                                  <button
                                    type="button"
                                    onClick={() => handleLoadTxIntoForm(tx)}
                                    className="inline-flex items-center gap-1 min-h-7 rounded-lg bg-slate-900 hover:bg-slate-800 px-3 py-1.5 text-xs font-bold text-white shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-700"
                                  >
                                    <Edit3 className="h-3.5 w-3.5" />
                                    폼에 불러와 수정
                                  </button>
                                )}
                                <Link
                                  to={`/transactions/${tx.id}`}
                                  className="inline-flex items-center gap-1 min-h-7 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-slate-400 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
                                >
                                  전표·이력 상세
                                  <ChevronRight className="h-3.5 w-3.5" />
                                </Link>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>

        {/* 우측 2분할 영역: 요율표 동시 조회 + 선택 카드사 자동 하이라이트 */}
        {isRateTableSplitOpen && (
          <div className="xl:col-span-5 xl:sticky xl:top-20">
            <RateTablePanel
              isSplitMode
              onCloseSplit={() => setRateTableSplitOpen(false)}
              onApplyRowToSplit={canManageRequest ? handleApplyRateTableRow : undefined}
              highlightedCardCompany={canManageRequest ? primaryCardCompany : undefined}
              highlightedPaymentMethods={canManageRequest ? selectedPaymentMethods : undefined}
              appliedPromotionIds={appliedPromotions.map((p) => p.promotionId)}
              onTogglePromotion={canManageRequest ? handleTogglePromotion : undefined}
            />
          </div>
        )}
      </div>
    </div>
  );
};
