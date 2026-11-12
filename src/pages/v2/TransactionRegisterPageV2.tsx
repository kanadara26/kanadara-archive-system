import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import {
  CARD_COMPANY_COLORS,
  PaymentSplitItem,
  RateTableRowItem,
  SPLIT_CARD_COMPANIES,
  SplitCardCompany,
  SplitPaymentMethod,
  TransactionDraftV2,
  V2_CARD_DISPLAY_NAMES,
  V2_CARD_LOGO_URLS,
  V2_PAYMENT_METHODS,
  V2PaymentMethodType,
} from '../../types';
import { calcSplitTotals, formatKRW, formatNumber } from '../../utils/format';
import { DecimalInput } from '../../components/DecimalInput';
import { CmCombobox } from '../../components/v2/CmCombobox';
import {
  Check,
  ChevronDown,
  ChevronRight,
  CreditCard,
  FolderOpen,
  Plus,
  RotateCcw,
  Save,
  Sparkles,
  Trash2,
  UserCheck,
  UserPlus,
  X,
} from 'lucide-react';

function getTodayDateString(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function parseKoreanAmountToken(token: string): number | null {
  const cleaned = token.replace(/,/g, '').trim();
  if (!cleaned || cleaned.includes('%')) return null;
  const match = cleaned.match(/(\d+(?:\.\d+)?)\s*(억|천만|백만|만|원)?/);
  if (!match) return null;
  const num = parseFloat(match[1]);
  if (Number.isNaN(num)) return null;
  const unit = match[2] || '';
  if (unit === '억') return Math.round(num * 100_000_000);
  if (unit === '천만') return Math.round(num * 10_000_000);
  if (unit === '백만') return Math.round(num * 1_000_000);
  if (unit === '만') return Math.round(num * 10_000);
  if (num < 100_000) return Math.round(num * 10_000);
  return Math.round(num);
}

function parseAmountTierRange(amountTier: string): {
  minAmount: number;
  maxAmount: number | null;
} {
  if (amountTier.includes('~')) {
    const [leftPart, rightPart] = amountTier.split('~');
    const minAmount = parseKoreanAmountToken(leftPart) ?? 0;
    const rightVal = parseKoreanAmountToken(rightPart);
    if (rightVal === null) {
      return { minAmount, maxAmount: null };
    }
    const maxAmount = rightPart.includes('미만') ? rightVal - 1 : rightVal;
    return { minAmount, maxAmount };
  }

  const singleVal = parseKoreanAmountToken(amountTier);
  if (singleVal === null) {
    return { minAmount: 0, maxAmount: null };
  }
  if (amountTier.includes('미만')) {
    return { minAmount: 0, maxAmount: singleVal - 1 };
  }
  if (amountTier.includes('이하')) {
    return { minAmount: 0, maxAmount: singleVal };
  }
  return { minAmount: singleVal, maxAmount: null };
}

function isMethodMatch(m1: string, m2: string): boolean {
  if (m1 === m2) return true;
  if (
    (m1 === '다이렉트' || m1 === '다이렉트할부') &&
    (m2 === '다이렉트' || m2 === '다이렉트할부')
  ) {
    return true;
  }
  return false;
}

function normalizeCategoryName(cat?: string): string {
  if (!cat || cat.trim() === '' || cat.trim() === '기본') {
    return '일반';
  }
  return cat.trim();
}

function getMonthMatchScore(monthsStr: string | undefined, targetMonth: number): number {
  if (!monthsStr || monthsStr.trim() === '' || monthsStr.includes('1달')) {
    return 1;
  }
  const clean = monthsStr.replace(/개월/g, '').trim();
  const nums = clean.match(/\d+/g)?.map(Number) || [];
  if (nums.length === 0) return 1;

  // 단일 개월 정확 일치 (예: 36개월 -> 36)
  if (nums.length === 1 && nums[0] === targetMonth) {
    return 10;
  }
  // 목록 내 포함 (예: 12 / 24 -> 12 또는 24)
  if (nums.includes(targetMonth)) {
    return 8;
  }
  // 구간 범위 내 포함 (예: 36 / 60 -> 48)
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  if (targetMonth >= min && targetMonth <= max) {
    return 5;
  }
  return 0;
}

function findBestRateRowForAmount(
  rows: RateTableRowItem[],
  cardCompany: SplitCardCompany,
  paymentMethod: SplitPaymentMethod,
  amount: number,
  preferredCategory?: string,
  targetMonths?: number
): RateTableRowItem | undefined {
  const baseRows = rows.filter(
    (r) => r.cardCompany === cardCompany && isMethodMatch(r.paymentMethod, paymentMethod)
  );
  if (baseRows.length === 0) return undefined;

  const targetCategory = normalizeCategoryName(preferredCategory);

  const categoryFiltered =
    targetCategory && targetCategory !== '전체'
      ? baseRows.filter((r) => normalizeCategoryName(r.category) === targetCategory)
      : baseRows;

  const targetRows = categoryFiltered.length > 0 ? categoryFiltered : baseRows;

  const isInstallment =
    paymentMethod === '할부' || paymentMethod === '다이렉트' || paymentMethod === '다이렉트할부';
  const effectiveMonths = isInstallment ? (targetMonths || 36) : 1;

  const candidates = targetRows.map((row) => ({
    row,
    range: parseAmountTierRange(row.amountTier),
    monthScore: isInstallment ? getMonthMatchScore(row.installmentMonths, effectiveMonths) : 1,
  }));

  const monthFiltered = isInstallment
    ? candidates.filter((c) => c.monthScore > 0)
    : candidates;
  const pool = monthFiltered.length > 0 ? monthFiltered : candidates;

  if (amount > 0) {
    const directMatches = pool.filter(
      ({ range }) =>
        amount >= range.minAmount &&
        (range.maxAmount === null || amount <= range.maxAmount)
    );

    if (directMatches.length > 0) {
      directMatches.sort((a, b) => {
        if (b.monthScore !== a.monthScore) {
          return b.monthScore - a.monthScore;
        }
        if (b.range.minAmount !== a.range.minAmount) {
          return b.range.minAmount - a.range.minAmount;
        }
        if (a.range.maxAmount !== null && b.range.maxAmount === null) return -1;
        if (a.range.maxAmount === null && b.range.maxAmount !== null) return 1;
        if (a.range.maxAmount !== null && b.range.maxAmount !== null) {
          return a.range.maxAmount - b.range.maxAmount;
        }
        return 0;
      });
      return directMatches[0].row;
    }

    const sortedByMinAsc = [...pool].sort((a, b) => {
      if (b.monthScore !== a.monthScore) return b.monthScore - a.monthScore;
      return a.range.minAmount - b.range.minAmount;
    });
    if (amount < sortedByMinAsc[0].range.minAmount) {
      return sortedByMinAsc[0].row;
    }
    return sortedByMinAsc[sortedByMinAsc.length - 1].row;
  }

  const sorted = [...pool].sort((a, b) => b.monthScore - a.monthScore);
  return sorted[0].row;
}

function createDefaultSplit(
  cardCompany: SplitCardCompany,
  paymentMethod: SplitPaymentMethod,
  rateRow?: RateTableRowItem,
  defaultAmount = 30000000
): PaymentSplitItem {
  const isLumpSum = paymentMethod === '일시불';
  return {
    id: `v2-split-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    cardCompany,
    paymentMethod,
    rateCategory: normalizeCategoryName(rateRow?.category),
    amount: defaultAmount,
    installmentMonths: isLumpSum ? 1 : 36,
    cashbackRate: isLumpSum ? (rateRow ? rateRow.cashbackRate : 2.0) : 0,
    interestRate: isLumpSum ? 0 : rateRow ? rateRow.interestRate : 4.5,
    agCommissionRate: rateRow ? rateRow.agCommissionRate : isLumpSum ? 0.85 : 1.1,
    cmCommissionRate: rateRow ? rateRow.cmCommissionRate : isLumpSum ? 0.5 : 0.65,
  };
}

const EMPTY_NEW_CM = {
  name: '',
  employeeId: '',
  affiliation: '',
  phone: '',
  isBusiness: false,
  idNumber: '',
  bankName: '',
  bankAccount: '',
};

export const TransactionRegisterPageV2: React.FC = () => {
  const {
    users,
    transactions,
    rateTableRows,
    refreshFromSheet,
    draftsV2,
    saveDraftV2,
    deleteDraftV2,
    editingTxIdV2,
    setEditingTxIdV2,
    pendingDraftIdV2,
    setPendingDraftIdV2,
    saveAgTransactionRequest,
    saveUserAccount,
    pushToast,
    currentUser,
  } = useApp();
  const navigate = useNavigate();

  // 등록 화면에 들어올 때 한 번 최신 요율·프로모션으로 새로고침
  // (예전에는 의존성에 매번 새로 만들어지는 함수를 넣어 화면이 바뀔 때마다 시트를 다시 읽었음)
  useEffect(() => {
    refreshFromSheet(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cmUsers = useMemo(
    () => users.filter((u) => u.role === 'CM' && u.isActive),
    [users]
  );

  const todayStr = useMemo(() => getTodayDateString(), []);

  // 현재 열려있는 단계 (1: 카드사·결제방법 선택, 2: 고객/CM 및 결제 정보 입력)
  const [activeStep, setActiveStep] = useState<1 | 2>(1);
  const methodGroupRef = useRef<HTMLDivElement>(null);
  const [isConfirmOpen, setIsConfirmOpen] = useState<boolean>(false);

  // 각 단계 입력 상태
  const [selectedCard, setSelectedCard] = useState<SplitCardCompany | null>(null);
  const [selectedMethodType, setSelectedMethodType] =
    useState<V2PaymentMethodType | null>(null);
  const [requestDate, setRequestDate] = useState<string>(todayStr);
  // 승인일자는 기본 공백(''), 진행상황이 '카드 승인'으로 변경될 때 자동 기록
  const [approvalDate, setApprovalDate] = useState<string>('');
  const [paymentSplits, setPaymentSplits] = useState<PaymentSplitItem[]>([]);
  const [selectedRateRowIds, setSelectedRateRowIds] = useState<Record<number, string>>({});
  const [rateTableCategoryFilter, setRateTableCategoryFilter] = useState<string>('전체');
  // 우측 요율표: 기본은 적용 중인 옵션만, 적용을 해제하면 전체 옵션 표시
  const [showAllRates, setShowAllRates] = useState<boolean>(false);

  // 고객 / CM 정보 및 비고
  const [customerName, setCustomerName] = useState<string>('');
  const [selectedCmId, setSelectedCmId] = useState<string>(() => cmUsers[0]?.id || '');
  const [requestMemo, setRequestMemo] = useState<string>('');

  // 임시저장 목록 모달 및 현재 불러온 드래프트 ID
  const [currentDraftId, setCurrentDraftId] = useState<string | undefined>(undefined);
  const [isDraftDrawerOpen, setIsDraftDrawerOpen] = useState<boolean>(false);

  // 간편 CM 즉시 추가 토글
  const [isQuickCmOpen, setIsQuickCmOpen] = useState<boolean>(false);
  const [newCm, setNewCm] = useState(EMPTY_NEW_CM);
  const pendingCmLoginIdRef = useRef<string | null>(null); // 방금 등록한 CM을 자동 선택하기 위함


  // cmUsers 변동 시 기본 선택 보정
  useEffect(() => {
    if (!selectedCmId && cmUsers.length > 0) {
      setSelectedCmId(cmUsers[0].id);
    }
  }, [cmUsers, selectedCmId]);

  // 월별 정산/대시보드에서 '수정하기'로 넘어온 경우 해당 거래 로드
  useEffect(() => {
    if (!editingTxIdV2) return;
    const target = transactions.find((t) => t.id === editingTxIdV2);
    if (!target) return;

    const firstSplit = target.paymentSplits[0];
    const card: SplitCardCompany = firstSplit?.cardCompany || '국민';
    let methodType: V2PaymentMethodType = '일시불';
    if (target.paymentSplits.length > 1) {
      methodType = '혼합';
    } else if (firstSplit?.paymentMethod === '다이렉트할부') {
      methodType = '다이렉트';
    } else if (firstSplit?.paymentMethod === '할부') {
      methodType = '할부';
    } else {
      methodType = '일시불';
    }

    setSelectedCard(card);
    setSelectedMethodType(methodType);
    setRequestDate(target.requestDate || todayStr);
    setApprovalDate(target.approvalDate || '');
    setPaymentSplits(target.paymentSplits.map((s) => ({ ...s, cardCompany: card })));
    setCustomerName(target.customerName);
    setSelectedCmId(target.cmId);
    setRequestMemo(target.requestMemo || '');
    setActiveStep(2);
  }, [editingTxIdV2, transactions, todayStr]);

  // 대시보드에서 '불러오기' 항목을 선택한 경우 즉시 로드
  useEffect(() => {
    if (!pendingDraftIdV2) return;
    const found = draftsV2.find((d) => d.id === pendingDraftIdV2);
    if (found) {
      setEditingTxIdV2(null);
      setCurrentDraftId(found.id);
      setSelectedCard(found.cardCompany);
      setSelectedMethodType(found.paymentMethodType);
      setRequestDate(found.requestDate || todayStr);
      setApprovalDate(found.approvalDate || '');
      setPaymentSplits(found.paymentSplits || []);
      setCustomerName(found.customerName || '');
      setSelectedCmId(found.cmId || cmUsers[0]?.id || '');
      setRequestMemo(found.requestMemo || '');
      setActiveStep(found.cardCompany && found.paymentMethodType ? 2 : 1);
    }
    setPendingDraftIdV2(null);
  }, [pendingDraftIdV2, draftsV2, todayStr, cmUsers, setEditingTxIdV2, setPendingDraftIdV2]);

  // 선택된 카드사 + 결제방법에 맞는 요율표 필터링 (결제방법 순 · 금액 구간 오름차순 정렬)
  const matchingRateRows = useMemo(() => {
    if (!selectedCard || !selectedMethodType) return [];
    const seenIds = new Set<string>();
    const cardRows = rateTableRows.filter((r) => {
      if (r.cardCompany !== selectedCard) return false;
      if (seenIds.has(r.id)) return false;
      seenIds.add(r.id);
      return true;
    });

    let filtered: RateTableRowItem[];
    if (selectedMethodType === '일시불') {
      filtered = cardRows.filter((r) => r.paymentMethod === '일시불');
    } else if (selectedMethodType === '다이렉트') {
      filtered = cardRows.filter(
        (r) => r.paymentMethod === '다이렉트할부' || r.paymentMethod === '다이렉트'
      );
    } else if (selectedMethodType === '할부') {
      filtered = cardRows.filter((r) => r.paymentMethod === '할부');
    } else {
      filtered = cardRows;
    }

    const methodOrder: Record<string, number> = {
      일시불: 1,
      다이렉트할부: 2,
      다이렉트: 2,
      할부: 3,
    };

    return [...filtered].sort((a, b) => {
      if (methodOrder[a.paymentMethod] !== methodOrder[b.paymentMethod]) {
        return methodOrder[a.paymentMethod] - methodOrder[b.paymentMethod];
      }
      const catA = normalizeCategoryName(a.category);
      const catB = normalizeCategoryName(b.category);
      if (catA !== catB) {
        if (catA === '일반') return -1;
        if (catB === '일반') return 1;
        return catA.localeCompare(catB, 'ko');
      }
      const rangeA = parseAmountTierRange(a.amountTier);
      const rangeB = parseAmountTierRange(b.amountTier);
      return rangeA.minAmount - rangeB.minAmount;
    });
  }, [rateTableRows, selectedCard, selectedMethodType]);

  // 우측 요율표 내 구분(유형 옵션) 목록 및 필터링된 요율 행
  const rateTableCategories = useMemo(() => {
    const unique = Array.from(
      new Set(matchingRateRows.map((r) => normalizeCategoryName(r.category)))
    );
    return ['전체', ...unique];
  }, [matchingRateRows]);

  const displayedRateRows = useMemo(() => {
    if (rateTableCategoryFilter === '전체') return matchingRateRows;
    return matchingRateRows.filter(
      (r) => normalizeCategoryName(r.category) === rateTableCategoryFilter
    );
  }, [matchingRateRows, rateTableCategoryFilter]);

  const appliedRateIds = Object.values(selectedRateRowIds);
  const isRateListCollapsed = !showAllRates && appliedRateIds.length > 0;
  const visibleRateRows = isRateListCollapsed
    ? matchingRateRows.filter((r) => appliedRateIds.includes(r.id))
    : displayedRateRows;

  // 적용 중인 옵션을 누르면 적용 해제하고 다른 옵션을 펼침
  const handleUnapplyRateRow = (rowId: string) => {
    setSelectedRateRowIds((prev) =>
      Object.fromEntries(Object.entries(prev).filter(([, id]) => id !== rowId))
    );
    setShowAllRates(true);
  };

  // 결제 합계 및 예상 수수료 실시간 계산
  const totals = useMemo(() => calcSplitTotals(paymentSplits), [paymentSplits]);

  // 카드사별 결제방법 등록 건수 계산 (미등록 방법 비활성화 표기용)
  const cardMethodCounts = useMemo(() => {
    if (!selectedCard) {
      return { 일시불: 0, 다이렉트: 0, 할부: 0, 혼합: 0 };
    }
    const seenIds = new Set<string>();
    const cardRows = rateTableRows.filter((r) => {
      if (r.cardCompany !== selectedCard) return false;
      if (seenIds.has(r.id)) return false;
      seenIds.add(r.id);
      return true;
    });
    const lump = cardRows.filter((r) => r.paymentMethod === '일시불').length;
    const direct = cardRows.filter((r) => isMethodMatch(r.paymentMethod, '다이렉트')).length;
    const inst = cardRows.filter((r) => r.paymentMethod === '할부').length;
    const mixed = lump > 0 && (direct > 0 || inst > 0) ? lump + direct + inst : (direct > 0 || inst > 0 ? direct + inst : 0);
    return {
      일시불: lump,
      다이렉트: direct,
      할부: inst,
      혼합: mixed,
    };
  }, [rateTableRows, selectedCard]);

  // 1단계: 카드사 선택 핸들러
  const handleSelectCard = (card: SplitCardCompany) => {
    setSelectedCard(card);

    if (selectedMethodType) {
      // 이미 결제방법이 선택되어 있었다면 해당 카드사의 기본 요율로 갱신
      initializeSplitsForCardAndMethod(card, selectedMethodType);
      setActiveStep(2);
    } else {
      // 같은 화면 아래 결제방법으로 바로 이동 (Enter로 이어서 선택)
      setTimeout(() => methodGroupRef.current?.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus());
    }
  };

  // 카드사 + 결제방법 조합에 맞춰 결제 입력 행 초기화 (초기 금액대에 맞는 조건 자동 선택)
  const initializeSplitsForCardAndMethod = (
    card: SplitCardCompany,
    methodType: V2PaymentMethodType
  ) => {
    const defaultSingleAmount = 30000000;
    setRateTableCategoryFilter('전체');
    setShowAllRates(false);

    if (methodType === '일시불') {
      const matchedRow = findBestRateRowForAmount(
        rateTableRows,
        card,
        '일시불',
        defaultSingleAmount,
        '일반'
      );
      const split = createDefaultSplit(card, '일시불', matchedRow, defaultSingleAmount);
      setPaymentSplits([split]);
      setSelectedRateRowIds(matchedRow ? { 0: matchedRow.id } : {});
    } else if (methodType === '다이렉트') {
      const matchedRow = findBestRateRowForAmount(
        rateTableRows,
        card,
        '다이렉트할부',
        defaultSingleAmount,
        '일반',
        36
      );
      const split = createDefaultSplit(
        card,
        '다이렉트할부',
        matchedRow,
        defaultSingleAmount
      );
      setPaymentSplits([split]);
      setSelectedRateRowIds(matchedRow ? { 0: matchedRow.id } : {});
    } else if (methodType === '할부') {
      const matchedRow = findBestRateRowForAmount(
        rateTableRows,
        card,
        '할부',
        defaultSingleAmount,
        '일반',
        36
      );
      const split = createDefaultSplit(card, '할부', matchedRow, defaultSingleAmount);
      setPaymentSplits([split]);
      setSelectedRateRowIds(matchedRow ? { 0: matchedRow.id } : {});
    } else {
      // 혼합: 1행(일시불 1,500만) + 2행(다이렉트할부 또는 할부 2,000만)
      const firstAmount = 15000000;
      const secondAmount = 20000000;
      const lumpRow = findBestRateRowForAmount(
        rateTableRows,
        card,
        '일시불',
        firstAmount,
        '일반'
      );
      const split1 = createDefaultSplit(card, '일시불', lumpRow, firstAmount);

      const directRow = findBestRateRowForAmount(
        rateTableRows,
        card,
        '다이렉트할부',
        secondAmount,
        '일반',
        36
      );
      const instRow = findBestRateRowForAmount(
        rateTableRows,
        card,
        '할부',
        secondAmount,
        '일반',
        36
      );
      const secondMethod: SplitPaymentMethod = directRow ? '다이렉트할부' : '할부';
      const secondRow = directRow || instRow;
      const split2 = createDefaultSplit(card, secondMethod, secondRow, secondAmount);

      setPaymentSplits([split1, split2]);
      const nextMap: Record<number, string> = {};
      if (lumpRow) nextMap[0] = lumpRow.id;
      if (secondRow) nextMap[1] = secondRow.id;
      setSelectedRateRowIds(nextMap);
    }
  };

  // 2단계: 결제방법 선택 핸들러
  const handleSelectMethod = (methodType: V2PaymentMethodType) => {
    if (!selectedCard) {
      pushToast({ type: 'info', title: '먼저 카드사를 선택해 주세요.' });
      return;
    }
    setSelectedMethodType(methodType);
    initializeSplitsForCardAndMethod(selectedCard, methodType);
    setActiveStep(2);
  };

  // 2단계가 열리면 첫 입력칸(고객명, 이미 있으면 CM)으로 포커스
  useEffect(() => {
    if (activeStep !== 2) return;
    const target = document.getElementById(customerName.trim() ? 'v2-cm-select' : 'v2-customer-name');
    if (target && !(target as HTMLInputElement).disabled) target.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStep]);

  // 3단계: 결제 행 값 변경 헬퍼
  const updateSplit = (index: number, patch: Partial<PaymentSplitItem>) => {
    setPaymentSplits((prev) =>
      prev.map((item, idx) => (idx === index ? { ...item, ...patch } : item))
    );
  };

  // 3단계: 결제 금액 입력/변경 시 현재 선택된 구분(유형 옵션) 및 결제 금액대에 맞는 조건(요율표) 자동 선택 및 반영
  const handleSplitAmountChange = (index: number, nextAmount: number) => {
    const split = paymentSplits[index];
    if (!split) return;

    const card = selectedCard || split.cardCompany;
    const preferredCat = normalizeCategoryName(split.rateCategory);
    const matchedRow = findBestRateRowForAmount(
      rateTableRows,
      card,
      split.paymentMethod,
      nextAmount,
      preferredCat,
      split.installmentMonths
    );

    if (matchedRow) {
      const isLump = split.paymentMethod === '일시불';
      updateSplit(index, {
        amount: nextAmount,
        rateCategory: normalizeCategoryName(matchedRow.category) || preferredCat,
        cashbackRate: isLump ? matchedRow.cashbackRate : 0,
        interestRate: isLump ? 0 : matchedRow.interestRate,
        agCommissionRate: matchedRow.agCommissionRate,
        cmCommissionRate: matchedRow.cmCommissionRate,
      });
      setSelectedRateRowIds((prev) => ({ ...prev, [index]: matchedRow.id }));
    } else {
      updateSplit(index, { amount: nextAmount });
    }
  };

  // 3단계: 구분(일반, 저금리, 선입금 등) 옵션 선택 시 해당 구분 + 현재 결제 금액대/개월수에 맞는 요율 자동 매칭
  const handleSplitCategoryChange = (index: number, nextCategory: string) => {
    const split = paymentSplits[index];
    if (!split) return;

    const card = selectedCard || split.cardCompany;
    const normalizedNextCat = normalizeCategoryName(nextCategory);
    const matchedRow = findBestRateRowForAmount(
      rateTableRows,
      card,
      split.paymentMethod,
      split.amount,
      normalizedNextCat,
      split.installmentMonths
    );

    if (matchedRow) {
      const isLump = split.paymentMethod === '일시불';
      updateSplit(index, {
        rateCategory: normalizeCategoryName(matchedRow.category) || normalizedNextCat,
        cashbackRate: isLump ? matchedRow.cashbackRate : 0,
        interestRate: isLump ? 0 : matchedRow.interestRate,
        agCommissionRate: matchedRow.agCommissionRate,
        cmCommissionRate: matchedRow.cmCommissionRate,
      });
      setSelectedRateRowIds((prev) => ({ ...prev, [index]: matchedRow.id }));
    } else {
      updateSplit(index, { rateCategory: normalizedNextCat });
    }
  };

  // 3단계: 할부 개월수 버튼 클릭 시 해당 개월수 및 결제 금액대에 맞는 요율 자동 선택 및 반영
  const handleSplitMonthsChange = (index: number, nextMonths: number) => {
    const split = paymentSplits[index];
    if (!split) return;

    const card = selectedCard || split.cardCompany;
    const preferredCat = normalizeCategoryName(split.rateCategory);
    const matchedRow = findBestRateRowForAmount(
      rateTableRows,
      card,
      split.paymentMethod,
      split.amount,
      preferredCat,
      nextMonths
    );

    if (matchedRow) {
      const isLump = split.paymentMethod === '일시불';
      updateSplit(index, {
        installmentMonths: nextMonths,
        rateCategory: normalizeCategoryName(matchedRow.category) || preferredCat,
        cashbackRate: isLump ? matchedRow.cashbackRate : 0,
        interestRate: isLump ? 0 : matchedRow.interestRate,
        agCommissionRate: matchedRow.agCommissionRate,
        cmCommissionRate: matchedRow.cmCommissionRate,
      });
      setSelectedRateRowIds((prev) => ({ ...prev, [index]: matchedRow.id }));
    } else {
      updateSplit(index, { installmentMonths: nextMonths });
    }
  };

  // 3단계: 혼합 결제에서 2번째 행 결제방법(할부 <-> 다이렉트할부) 변경 시에도 현재 금액대 조건 자동 매칭
  const handleSplitSubMethodChange = (
    index: number,
    nextSubMethod: SplitPaymentMethod
  ) => {
    const split = paymentSplits[index];
    if (!split) return;

    const card = selectedCard || split.cardCompany;
    const preferredCat = normalizeCategoryName(split.rateCategory);
    const matchedRow = findBestRateRowForAmount(
      rateTableRows,
      card,
      nextSubMethod,
      split.amount,
      preferredCat,
      split.installmentMonths
    );

    const isLump = nextSubMethod === '일시불';
    if (matchedRow) {
      updateSplit(index, {
        paymentMethod: nextSubMethod,
        rateCategory: normalizeCategoryName(matchedRow.category) || preferredCat,
        cashbackRate: isLump ? matchedRow.cashbackRate : 0,
        interestRate: isLump ? 0 : matchedRow.interestRate,
        agCommissionRate: matchedRow.agCommissionRate,
        cmCommissionRate: matchedRow.cmCommissionRate,
      });
      setSelectedRateRowIds((prev) => ({ ...prev, [index]: matchedRow.id }));
    } else {
      updateSplit(index, { paymentMethod: nextSubMethod });
    }
  };

  // 3단계: 우측 간소화 요율표 행 클릭 -> 결제 정보에 자동 반영
  const handleApplyRateRow = (row: RateTableRowItem, targetSplitIndex?: number) => {
    const isLump = row.paymentMethod === '일시불';
    const rowCat = normalizeCategoryName(row.category);

    // 행에 할부 개월수 정보가 있는 경우 할부 개월수도 연동
    const monthsClean = (row.installmentMonths || '').replace(/개월/g, '').trim();
    const nums = monthsClean.match(/\d+/g)?.map(Number) || [];
    const targetMonths = nums.length > 0 ? nums[0] : undefined;

    if (selectedMethodType === '혼합') {
      const idx =
        targetSplitIndex !== undefined
          ? targetSplitIndex
          : row.paymentMethod === '일시불'
          ? 0
          : 1;
      updateSplit(idx, {
        paymentMethod: row.paymentMethod,
        rateCategory: rowCat,
        installmentMonths: !isLump && targetMonths ? targetMonths : undefined,
        cashbackRate: isLump ? row.cashbackRate : 0,
        interestRate: isLump ? 0 : row.interestRate,
        agCommissionRate: row.agCommissionRate,
        cmCommissionRate: row.cmCommissionRate,
      });
      setSelectedRateRowIds((prev) => ({ ...prev, [idx]: row.id }));
    } else {
      updateSplit(0, {
        paymentMethod: row.paymentMethod,
        rateCategory: rowCat,
        installmentMonths: !isLump && targetMonths ? targetMonths : undefined,
        cashbackRate: isLump ? row.cashbackRate : 0,
        interestRate: isLump ? 0 : row.interestRate,
        agCommissionRate: row.agCommissionRate,
        cmCommissionRate: row.cmCommissionRate,
      });
      setSelectedRateRowIds({ 0: row.id });
    }
  };

  // 예상 수수료 금액 직접 입력 시 요율(%) 역산 반영
  const handleDirectCommissionAmountChange = (
    index: number,
    target: 'AG' | 'CM',
    rawAmountStr: string
  ) => {
    const split = paymentSplits[index];
    if (!split || split.amount <= 0) return;
    const numericAmt = Number(rawAmountStr.replace(/[^0-9]/g, '')) || 0;
    const calculatedRate = Number(((numericAmt / split.amount) * 100).toFixed(2));
    if (target === 'AG') {
      updateSplit(index, { agCommissionRate: calculatedRate });
    } else {
      updateSplit(index, { cmCommissionRate: calculatedRate });
    }
  };

  // 전체 폼 초기화
  const handleResetForm = () => {
    setEditingTxIdV2(null);
    setCurrentDraftId(undefined);
    setSelectedCard(null);
    setSelectedMethodType(null);
    setRequestDate(todayStr);
    setApprovalDate('');
    setPaymentSplits([]);
    setSelectedRateRowIds({});
    setCustomerName('');
    setRequestMemo('');
    setActiveStep(1);
  };

  // 임시 저장
  const handleSaveDraft = () => {
    const cardLabel = selectedCard ? V2_CARD_DISPLAY_NAMES[selectedCard] : '카드사 미선택';
    const methodLabel = selectedMethodType || '결제방법 미선택';
    const custLabel = customerName.trim() || '고객명 미입력';
    const amtLabel =
      totals.totalAmount > 0
        ? `${Math.round(totals.totalAmount / 10000).toLocaleString()}만원`
        : '0원';

    const saved = saveDraftV2({
      id: currentDraftId,
      title: `[${cardLabel} · ${methodLabel}] ${custLabel} (${amtLabel})`,
      activeStep,
      cardCompany: selectedCard,
      paymentMethodType: selectedMethodType,
      requestDate,
      approvalDate,
      paymentSplits,
      customerName,
      cmId: selectedCmId,
      requestMemo,
    });
    setCurrentDraftId(saved.id);
  };

  // 임시저장 불러오기
  const handleLoadDraft = (draft: TransactionDraftV2) => {
    setEditingTxIdV2(null);
    setCurrentDraftId(draft.id);
    setSelectedCard(draft.cardCompany);
    setSelectedMethodType(draft.paymentMethodType);
    setRequestDate(draft.requestDate || todayStr);
    setApprovalDate(draft.approvalDate || '');
    setPaymentSplits(draft.paymentSplits || []);
    setCustomerName(draft.customerName || '');
    setSelectedCmId(draft.cmId || cmUsers[0]?.id || '');
    setRequestMemo(draft.requestMemo || '');
    setActiveStep(draft.cardCompany && draft.paymentMethodType ? 2 : 1);
    setIsDraftDrawerOpen(false);
    pushToast({
      type: 'info',
      title: '임시 저장 데이터를 불러왔습니다',
      description: draft.title,
    });
  };

  // 새 CM 등록 (이름·소속·사번 필수) → 저장되면 담당 CM으로 자동 선택
  const handleQuickAddCm = () => {
    const missing = [
      !newCm.name.trim() && '이름',
      !newCm.affiliation.trim() && '소속',
      !newCm.employeeId.trim() && '사번',
    ].filter(Boolean);
    if (missing.length > 0) {
      pushToast({ type: 'error', title: `CM ${missing.join(', ')}을(를) 입력해 주세요.` });
      return;
    }
    const loginId = `cm.${Date.now()}@autodealer.kr`;
    const res = saveUserAccount({
      loginId,
      name: newCm.name.trim(),
      role: 'CM',
      affiliation: newCm.affiliation.trim(),
      phone: newCm.phone.trim(),
      employeeId: newCm.employeeId.trim(),
      isBusiness: newCm.isBusiness,
      businessNumber: newCm.isBusiness ? newCm.idNumber : '',
      rrn: newCm.isBusiness ? '' : newCm.idNumber,
      bankName: newCm.bankName,
      bankAccount: newCm.bankAccount,
      isActive: true,
    });
    if (res.ok) {
      pendingCmLoginIdRef.current = loginId;
      setNewCm(EMPTY_NEW_CM);
      setIsQuickCmOpen(false);
    }
  };

  useEffect(() => {
    if (!pendingCmLoginIdRef.current) return;
    const created = cmUsers.find((u) => u.loginId === pendingCmLoginIdRef.current);
    if (created) {
      setSelectedCmId(created.id);
      pendingCmLoginIdRef.current = null;
    }
  }, [cmUsers]);

  const existingTx = editingTxIdV2 ? transactions.find((t) => t.id === editingTxIdV2) : undefined;
  const isAdmin = currentUser?.role === 'ADMIN';
  // AG는 이미 등록된 거래의 고객/CM 정보를 바꿀 수 없음
  const isCustomerLocked = !!existingTx && currentUser?.role === 'AG';
  // 승인일자는 관리자만, 카드 승인된 거래를 수정할 때 바꿀 수 있음
  const canEditApprovalDate = isAdmin && !!existingTx?.approvalDate;

  // 1) 입력 검증 → 최종 확인 팝업
  const handleSubmitTransaction = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCard || !selectedMethodType || paymentSplits.length === 0) {
      setActiveStep(1);
      pushToast({ type: 'error', title: '카드사와 결제 방법을 선택해 주세요.' });
      return;
    }
    if (paymentSplits.some((s) => !s.amount || s.amount <= 0)) {
      pushToast({ type: 'error', title: '결제 금액을 0원보다 크게 입력해 주세요.' });
      return;
    }
    if (!customerName.trim()) {
      pushToast({ type: 'error', title: '고객명을 입력해 주세요.' });
      document.getElementById('v2-customer-name')?.focus();
      return;
    }
    if (!selectedCmId) {
      pushToast({ type: 'error', title: '담당 CM을 선택해 주세요.' });
      document.getElementById('v2-cm-select')?.focus();
      return;
    }
    setIsConfirmOpen(true);
  };

  // 2) 팝업에서 확인 → 저장 → 대시보드로 이동 (완료 알림은 화면 위 토스트)
  const handleConfirmSave = () => {
    if (!selectedCard) return;
    const res = saveAgTransactionRequest({
      txId: editingTxIdV2 || undefined,
      customerName: customerName.trim(),
      requestDate,
      approvalDate: existingTx ? (canEditApprovalDate ? approvalDate : existingTx.approvalDate) : '',
      status: existingTx ? existingTx.status : 'WAITING',
      settlementStatus: existingTx ? existingTx.settlementStatus : '정산 대기',
      cmId: selectedCmId,
      paymentSplits: paymentSplits.map((s) => ({ ...s, cardCompany: selectedCard })),
      requestMemo: requestMemo.trim() || undefined,
    });
    setIsConfirmOpen(false);
    if (!res.ok) {
      pushToast({ type: 'error', title: '저장 실패', description: res.message });
      return;
    }
    if (currentDraftId) deleteDraftV2(currentDraftId);
    handleResetForm();
    navigate('/v2/dashboard');
  };

  const selectedCmObj = cmUsers.find((c) => c.id === selectedCmId);

  return (
    <div className="space-y-4">
      {/* 상단 헤더 & 임시저장 컨트롤 바 */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between bg-white rounded-xl border border-slate-200 px-4 py-3.5 shadow-2xs">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-extrabold tracking-tight text-slate-900">
              {editingTxIdV2 ? `거래 승인건 수정 (${editingTxIdV2})` : '거래 승인건 등록'}
            </h1>
            {currentDraftId && (
              <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
                임시저장 편집중
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            카드사와 결제 방법을 고르면 입력 화면이 열립니다. 방향키로 칸 이동, Enter로 선택·다음 칸.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleSaveDraft}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors"
          >
            <Save className="h-3.5 w-3.5 text-slate-500" />
            <span>임시 저장</span>
          </button>

          <button
            type="button"
            onClick={() => setIsDraftDrawerOpen((prev) => !prev)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors"
          >
            <FolderOpen className="h-3.5 w-3.5 text-slate-500" />
            <span>불러오기</span>
            <span className="rounded-full bg-slate-900 px-1.5 py-0.2 text-[11px] font-bold text-white tabular-nums">
              {draftsV2.length}
            </span>
          </button>

          {(selectedCard || editingTxIdV2 || customerName) && (
            <button
              type="button"
              onClick={handleResetForm}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-200 transition-colors"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>초기화</span>
            </button>
          )}
        </div>
      </div>

      {/* 임시저장 불러오기 패널 */}
      {isDraftDrawerOpen && (
        <div className="rounded-xl border border-slate-300 bg-white p-4 shadow-sm space-y-3">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
            <h2 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
              <FolderOpen className="h-4 w-4 text-slate-600" />
              임시 저장된 거래 목록 ({draftsV2.length}건)
            </h2>
            <button
              type="button"
              onClick={() => setIsDraftDrawerOpen(false)}
              className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {draftsV2.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-400">
              저장된 임시 거래 내역이 없습니다. 작성 중 상단의 [임시 저장] 버튼을 눌러 보관할 수 있습니다.
            </p>
          ) : (
            <div className="divide-y divide-slate-100 max-h-60 overflow-y-auto">
              {draftsV2.map((draft) => (
                <div
                  key={draft.id}
                  className="flex items-center justify-between gap-3 py-2.5 px-2 hover:bg-slate-50 rounded-lg"
                >
                  <button
                    type="button"
                    onClick={() => handleLoadDraft(draft)}
                    className="flex-1 text-left"
                  >
                    <p className="text-xs font-bold text-slate-900">{draft.title}</p>
                    <p className="text-[11px] text-slate-400 mt-0.5 font-mono">
                      저장일시: {draft.savedAt} · 진행 단계: {draft.activeStep}단계
                    </p>
                  </button>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleLoadDraft(draft)}
                      className="rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-slate-800"
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

      {/* 단계별 아코디언 폼 */}
      <form onSubmit={handleSubmitTransaction} className="space-y-3">
        {/* ================================================================= */}
        {/* STEP 1. 카드사 · 결제 방법 선택 (한 화면) */}
        {/* ================================================================= */}
        <section className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-2xs">
          <button
            type="button"
            onClick={() => setActiveStep(1)}
            className={`flex w-full items-center justify-between px-4 py-3.5 text-left transition-colors ${
              activeStep === 1 ? 'bg-slate-900 text-white' : 'bg-white hover:bg-slate-50'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-extrabold ${
                  activeStep === 1
                    ? 'bg-white text-slate-900'
                    : selectedCard && selectedMethodType
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-500'
                }`}
              >
                {selectedCard && selectedMethodType && activeStep !== 1 ? <Check className="h-3.5 w-3.5" /> : '1'}
              </span>
              <span className="text-sm font-bold">카드사 · 결제 방법 선택</span>
            </div>

            <div className="flex items-center gap-2">
              {selectedCard && (
                <span
                  className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-bold ${
                    activeStep === 1 ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-900'
                  }`}
                >
                  <img
                    src={V2_CARD_LOGO_URLS[selectedCard]}
                    alt=""
                    className="h-4 w-4 rounded-sm bg-white p-0.5 object-contain"
                  />
                  {V2_CARD_DISPLAY_NAMES[selectedCard]}
                </span>
              )}
              {selectedMethodType && (
                <span
                  className={`rounded-md px-2.5 py-1 text-xs font-bold ${
                    activeStep === 1 ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-900'
                  }`}
                >
                  {selectedMethodType}
                </span>
              )}
              {activeStep === 1 ? (
                <ChevronDown className="h-4 w-4 opacity-70" />
              ) : (
                <span className="text-xs font-semibold text-slate-400 flex items-center gap-0.5">
                  변경 <ChevronRight className="h-3.5 w-3.5" />
                </span>
              )}
            </div>
          </button>

          {activeStep === 1 && (
            <div className="space-y-6 border-t border-slate-100 p-4 sm:p-5">
              <div>
                <p className="mb-3 text-xs font-extrabold text-slate-800">카드사</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3">
                {SPLIT_CARD_COMPANIES.map((cardKey) => {
                  const colorMeta = CARD_COMPANY_COLORS[cardKey];
                  const displayName = V2_CARD_DISPLAY_NAMES[cardKey];
                  const logoUrl = V2_CARD_LOGO_URLS[cardKey];
                  const isSelected = selectedCard === cardKey;

                  return (
                    <button
                      key={cardKey}
                      type="button"
                      onClick={() => handleSelectCard(cardKey)}
                      className={`group relative flex flex-col justify-between rounded-2xl p-4 text-left transition-all min-h-[132px] border overflow-hidden ${
                        isSelected
                          ? 'border-slate-900 bg-slate-900 text-white shadow-md ring-2 ring-slate-900/20'
                          : 'border-slate-200 bg-gradient-to-br from-white via-white to-slate-50/90 text-slate-900 hover:border-slate-400 hover:shadow-xs'
                      }`}
                    >
                      {/* 카드 상단 브랜드 컬러 액센트 바 */}
                      <span
                        className="absolute top-0 left-0 right-0 h-1.5"
                        style={{ backgroundColor: colorMeta.mainHex }}
                      />

                      {/* 상단: 카드사 공식 로고 엠블럼 & 선택 체크 */}
                      <div className="flex items-start justify-between gap-2 pt-1">
                        {logoUrl ? (
                          <div
                            className={`flex h-10 w-10 items-center justify-center rounded-xl p-1.5 border transition-transform group-hover:scale-105 ${
                              isSelected
                                ? 'border-white/20 bg-white shadow-2xs'
                                : 'border-slate-200/80 bg-white shadow-2xs'
                            }`}
                          >
                            <img
                              src={logoUrl}
                              alt={`${displayName} 로고`}
                              className="h-full w-full object-contain"
                            />
                          </div>
                        ) : (
                          <div
                            className="flex h-10 w-10 items-center justify-center rounded-xl text-xs font-black tracking-tight shadow-2xs"
                            style={{
                              backgroundColor: colorMeta.softBgHex,
                              color: colorMeta.darkTextHex,
                              border: `1px solid ${colorMeta.softBorderHex}40`,
                            }}
                          >
                            {cardKey === '하나' ? '하나' : '제휴'}
                          </div>
                        )}

                        {isSelected ? (
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-400 text-slate-950 shadow-2xs">
                            <Check className="h-3 w-3 stroke-[3]" />
                          </span>
                        ) : (
                          <span className="text-[10px] font-mono font-bold tracking-widest text-slate-300">
                            AUTO
                          </span>
                        )}
                      </div>

                      {/* 중단: 실물 신용카드 스타일 IC 칩 */}
                      <div className="my-2.5 flex items-center justify-between">
                        <div
                          className={`h-5 w-7 rounded-sm border flex items-center justify-center ${
                            isSelected
                              ? 'border-amber-300/60 bg-amber-300/20'
                              : 'border-amber-400/60 bg-amber-100/70'
                          }`}
                        >
                          <CreditCard
                            className={`h-3 w-3 ${
                              isSelected ? 'text-amber-300' : 'text-amber-700'
                            }`}
                          />
                        </div>
                        <span
                          className={`text-[10px] font-mono tracking-widest ${
                            isSelected ? 'text-slate-400' : 'text-slate-300'
                          }`}
                        >
                          ••••
                        </span>
                      </div>

                      {/* 하단: 카드사명 */}
                      <div className="flex items-center justify-between gap-1.5 pt-1 border-t border-slate-200/50">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span
                            className="h-2 w-2 rounded-full shrink-0"
                            style={{ backgroundColor: colorMeta.mainHex }}
                          />
                          <span className="text-sm font-extrabold tracking-tight truncate">
                            {displayName}
                          </span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
              </div>

              <div ref={methodGroupRef}>
                <p className="mb-3 text-xs font-extrabold text-slate-800">
                  결제 방법
                  {!selectedCard && <span className="ml-1.5 font-medium text-slate-400">카드사를 먼저 선택하세요</span>}
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {V2_PAYMENT_METHODS.map((m) => {
                  const isSelected = selectedMethodType === m.key;
                  const count = cardMethodCounts[m.key] || 0;
                  const hasRates = count > 0;
                  return (
                    <button
                      key={m.key}
                      type="button"
                      disabled={!selectedCard}
                      onClick={() => handleSelectMethod(m.key)}
                      className={`flex flex-col justify-between rounded-xl border p-4 text-left transition-all min-h-[88px] disabled:cursor-not-allowed disabled:opacity-40 ${
                        !hasRates
                          ? isSelected
                            ? 'border-slate-500 bg-slate-700 text-slate-100 shadow-sm'
                            : 'border-slate-200 bg-slate-100/90 text-slate-400 hover:border-slate-300 hover:bg-slate-200/70'
                          : isSelected
                          ? 'border-slate-900 bg-slate-900 text-white shadow-sm'
                          : 'border-slate-200 bg-white text-slate-900 hover:border-slate-400 hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1.5">
                        <span className="text-base font-extrabold">{m.label}</span>
                        <div className="flex items-center gap-1.5">
                          {!hasRates ? (
                            <span className="rounded bg-slate-200/90 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">
                              요율 미등록
                            </span>
                          ) : (
                            <span
                              className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                                isSelected
                                  ? 'bg-slate-800 text-slate-300'
                                  : 'bg-slate-100 text-slate-600'
                              }`}
                            >
                              {count}건
                            </span>
                          )}
                          {isSelected && <Check className="h-4 w-4 stroke-[3]" />}
                        </div>
                      </div>
                      <p
                        className={`text-xs mt-2 ${
                          !hasRates
                            ? isSelected
                              ? 'text-slate-300'
                              : 'text-slate-400'
                            : isSelected
                            ? 'text-slate-300'
                            : 'text-slate-500'
                        }`}
                      >
                        {m.desc}
                      </p>
                    </button>
                  );
                })}
              </div>
              </div>
            </div>
          )}
        </section>

        {/* ================================================================= */}
        {/* STEP 2. 고객·CM 및 결제 정보 입력 + 우측 요율표 */}
        {/* ================================================================= */}
        <section className="rounded-xl border border-slate-200 bg-white overflow-clip shadow-2xs">
          <button
            type="button"
            onClick={() => {
              if (!selectedCard || !selectedMethodType) {
                setActiveStep(1);
                return;
              }
              setActiveStep(2);
            }}
            className={`flex w-full items-center justify-between px-4 py-3.5 text-left transition-colors ${
              activeStep === 2 ? 'bg-slate-900 text-white' : 'bg-white hover:bg-slate-50'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-extrabold ${
                  activeStep === 2
                    ? 'bg-white text-slate-900'
                    : totals.totalAmount > 0 && customerName.trim()
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-500'
                }`}
              >
                {totals.totalAmount > 0 && customerName.trim() && activeStep !== 2 ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  '2'
                )}
              </span>
              <span className="text-sm font-bold">고객 · CM 및 결제 정보 입력</span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {totals.totalAmount > 0 && (
                <span
                  className={`rounded-md px-2.5 py-1 text-xs font-bold tabular-nums ${
                    activeStep === 2
                      ? 'bg-slate-800 text-white'
                      : 'bg-slate-100 text-slate-900'
                  }`}
                >
                  총 {formatKRW(totals.totalAmount)} · CM {formatKRW(totals.totalCmCommission)} / AG{' '}
                  {formatKRW(totals.totalAgCommission)}
                </span>
              )}
              {(customerName.trim() || selectedCmObj) && (
                <span
                  className={`rounded-md px-2.5 py-1 text-xs font-bold ${
                    activeStep === 2
                      ? 'bg-slate-800 text-white'
                      : 'bg-slate-100 text-slate-900'
                  }`}
                >
                  {customerName.trim() ? `고객: ${customerName.trim()}` : '고객 미입력'} ·{' '}
                  {selectedCmObj ? `CM: ${selectedCmObj.name}` : 'CM 미선택'}
                </span>
              )}
              {activeStep === 2 ? (
                <ChevronDown className="h-4 w-4 opacity-70" />
              ) : (
                <span className="text-xs font-semibold text-slate-400 flex items-center gap-0.5">
                  열기 <ChevronRight className="h-3.5 w-3.5" />
                </span>
              )}
            </div>
          </button>

          {activeStep === 2 && selectedCard && selectedMethodType && (
            <div className="p-4 sm:p-5 border-t border-slate-100 space-y-5">
              {/* 고객 / 담당 CM (먼저 입력) */}
              <div className="space-y-4 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-extrabold text-slate-900">고객 / 담당 CM</span>
                  {isCustomerLocked && (
                    <span className="text-[11px] font-semibold text-slate-500">등록된 거래의 고객·CM 정보는 AG가 바꿀 수 없습니다</span>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* 고객명 입력 */}
                  <div>
                    <label
                      htmlFor="v2-customer-name"
                      className="block text-xs font-extrabold text-slate-800 mb-1.5"
                    >
                      고객명 <span className="text-rose-500">*</span>
                    </label>
                    <input
                      id="v2-customer-name"
                      type="text"
                      required
                      lang="ko"
                      disabled={isCustomerLocked}
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      placeholder="고객 성명 입력 (예: 홍길동)"
                      className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm font-bold text-slate-900 focus:border-slate-900 focus:outline-none disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
                    />
                  </div>

                  {/* 담당 CM 선택 */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label
                        htmlFor="v2-cm-select"
                        className="text-xs font-extrabold text-slate-800 flex items-center gap-1"
                      >
                        <UserCheck className="h-3.5 w-3.5 text-slate-600" />
                        담당 CM <span className="text-rose-500">*</span>
                      </label>
                      {!isCustomerLocked && (
                      <button
                        type="button"
                        data-nav-skip
                        onClick={() => setIsQuickCmOpen((prev) => !prev)}
                        className="inline-flex items-center gap-1 text-xs font-bold text-slate-600 hover:text-slate-900 underline"
                      >
                        <UserPlus className="h-3 w-3" />
                        {isQuickCmOpen ? '새 CM 등록 닫기' : '+ 새 CM 등록'}
                      </button>
                      )}
                    </div>

                    <CmCombobox
                      id="v2-cm-select"
                      cms={cmUsers}
                      value={selectedCmId}
                      onChange={setSelectedCmId}
                      disabled={isCustomerLocked}
                    />
                  </div>
                </div>

                {/* 새 CM 등록 폼 (설정의 CM 등록과 같은 항목) */}
                {isQuickCmOpen && (
                  <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-3.5">
                    <p className="text-xs font-bold text-slate-800">
                      새 CM을 저장하면 목록에 추가되고 담당 CM으로 바로 선택됩니다.
                    </p>
                    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
                      <div>
                        <label htmlFor="new-cm-name" className="mb-1 block text-[11px] font-bold text-slate-700">
                          CM 이름 <span className="text-rose-500">*</span>
                        </label>
                        <input
                          id="new-cm-name"
                          type="text"
                          lang="ko"
                          value={newCm.name}
                          onChange={(e) => setNewCm((c) => ({ ...c, name: e.target.value }))}
                          placeholder="예: 김민준"
                          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-900 focus:border-slate-900 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label htmlFor="new-cm-employeeId" className="mb-1 block text-[11px] font-bold text-slate-700">
                          사번 <span className="text-rose-500">*</span>
                        </label>
                        <input
                          id="new-cm-employeeId"
                          type="text"
                          lang="ko"
                          value={newCm.employeeId}
                          onChange={(e) => setNewCm((c) => ({ ...c, employeeId: e.target.value }))}
                          placeholder="예: CM-0012"
                          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-900 focus:border-slate-900 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label htmlFor="new-cm-affiliation" className="mb-1 block text-[11px] font-bold text-slate-700">
                          소속 / 대리점 <span className="text-rose-500">*</span>
                        </label>
                        <input
                          id="new-cm-affiliation"
                          type="text"
                          lang="ko"
                          value={newCm.affiliation}
                          onChange={(e) => setNewCm((c) => ({ ...c, affiliation: e.target.value }))}
                          placeholder="예: 현대자동차 서초지점"
                          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-900 focus:border-slate-900 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label htmlFor="new-cm-phone" className="mb-1 block text-[11px] font-bold text-slate-700">
                          연락처
                        </label>
                        <input
                          id="new-cm-phone"
                          type="text"
                          inputMode="numeric"
                          value={newCm.phone}
                          onChange={(e) => setNewCm((c) => ({ ...c, phone: e.target.value }))}
                          placeholder="예: 010-1234-5678"
                          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-900 focus:border-slate-900 focus:outline-none"
                        />
                      </div>
                      <div>
                        <span className="mb-1 block text-[11px] font-bold text-slate-700">사업자 여부</span>
                        <div role="radiogroup" aria-label="사업자 여부" className="grid grid-cols-2 rounded-lg border border-slate-300 bg-white p-0.5">
                          {[
                            { value: true, label: '사업자' },
                            { value: false, label: '개인 (비사업자)' },
                          ].map((opt) => (
                            <button
                              key={opt.label}
                              type="button"
                              role="radio"
                              aria-checked={newCm.isBusiness === opt.value}
                              onClick={() => setNewCm((c) => ({ ...c, isBusiness: opt.value }))}
                              className={`rounded-md px-2 py-1.5 text-xs font-bold transition-colors ${
                                newCm.isBusiness === opt.value ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
                              }`}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <label htmlFor="new-cm-idNumber" className="mb-1 block text-[11px] font-bold text-slate-700">
                          {newCm.isBusiness ? '사업자등록번호' : '주민등록번호'}
                        </label>
                        <input
                          id="new-cm-idNumber"
                          type="text"
                          inputMode="numeric"
                          value={newCm.idNumber}
                          onChange={(e) => setNewCm((c) => ({ ...c, idNumber: e.target.value }))}
                          placeholder={newCm.isBusiness ? '000-00-00000' : '000000-0000000'}
                          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-900 focus:border-slate-900 focus:outline-none font-mono"
                        />
                      </div>
                      <div>
                        <label htmlFor="new-cm-bankName" className="mb-1 block text-[11px] font-bold text-slate-700">
                          계좌 은행
                        </label>
                        <input
                          id="new-cm-bankName"
                          type="text"
                          lang="ko"
                          value={newCm.bankName}
                          onChange={(e) => setNewCm((c) => ({ ...c, bankName: e.target.value }))}
                          placeholder="예: 국민은행"
                          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-900 focus:border-slate-900 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label htmlFor="new-cm-bankAccount" className="mb-1 block text-[11px] font-bold text-slate-700">
                          계좌번호
                        </label>
                        <input
                          id="new-cm-bankAccount"
                          type="text"
                          inputMode="numeric"
                          value={newCm.bankAccount}
                          onChange={(e) => setNewCm((c) => ({ ...c, bankAccount: e.target.value }))}
                          placeholder="예: 123-456-789012"
                          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-900 focus:border-slate-900 focus:outline-none font-mono"
                        />
                      </div>
                    </div>
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setNewCm(EMPTY_NEW_CM);
                          setIsQuickCmOpen(false);
                        }}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100"
                      >
                        취소
                      </button>
                      <button
                        type="button"
                        onClick={handleQuickAddCm}
                        className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        CM 저장
                      </button>
                    </div>
                  </div>
                )}

              </div>

              <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-12 lg:items-stretch">
                {/* 좌측: 결제 정보 입력 영역 (7컬럼) */}
                <div className="lg:col-span-7 space-y-4">
                  {/* 기본 자동입력 및 일자 바 (회색 비활성화) */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 rounded-xl bg-slate-100/90 p-3 border border-slate-200">
                    <div>
                      <label
                        htmlFor="v2-request-date"
                        className="block text-[11px] font-semibold text-slate-500 mb-1"
                      >
                        작성일자 (자동)
                      </label>
                      <input
                        id="v2-request-date"
                        type="date"
                        value={requestDate}
                        disabled
                        readOnly
                        className="w-full rounded-lg border border-slate-200 bg-slate-200/70 px-2.5 py-1.5 text-xs font-bold text-slate-500 cursor-not-allowed"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="v2-approval-date"
                        className="block text-[11px] font-semibold text-slate-500 mb-1"
                      >
                        {canEditApprovalDate ? '승인일자 (관리자 수정)' : '승인일자 (승인 시 기록)'}
                      </label>
                      {canEditApprovalDate ? (
                        <input
                          id="v2-approval-date"
                          type="date"
                          value={approvalDate}
                          onChange={(e) => setApprovalDate(e.target.value)}
                          className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-900"
                        />
                      ) : (
                        <input
                          id="v2-approval-date"
                          type="text"
                          value={approvalDate}
                          placeholder="카드 승인 시 자동 기록"
                          disabled
                          readOnly
                          className="w-full rounded-lg border border-slate-200 bg-slate-200/70 px-2.5 py-1.5 text-xs font-bold text-slate-500 placeholder:text-slate-400 cursor-not-allowed"
                        />
                      )}
                    </div>
                    <div>
                      <span className="block text-[11px] font-semibold text-slate-500 mb-1">
                        카드사 (자동)
                      </span>
                      <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-200/70 px-2.5 py-1.5 text-xs font-extrabold text-slate-500 cursor-not-allowed select-none">
                        <span
                          className="h-2 w-2 rounded-full shrink-0 opacity-75"
                          style={{
                            backgroundColor: CARD_COMPANY_COLORS[selectedCard].mainHex,
                          }}
                        />
                        <span className="truncate">{V2_CARD_DISPLAY_NAMES[selectedCard]}</span>
                      </div>
                    </div>
                    <div>
                      <span className="block text-[11px] font-semibold text-slate-500 mb-1">
                        결제방법 (자동)
                      </span>
                      <div className="rounded-lg border border-slate-200 bg-slate-200/70 px-2.5 py-1.5 text-xs font-extrabold text-slate-500 cursor-not-allowed select-none">
                        {selectedMethodType}
                      </div>
                    </div>
                  </div>

                  {/* 결제 입력 행 (단일 또는 혼합) */}
                  <div className="space-y-3">
                    {paymentSplits.map((split, idx) => {
                      const isLumpSum = split.paymentMethod === '일시불';
                      const agExpectedAmt = Math.round(
                        ((Number(split.amount) || 0) * (Number(split.agCommissionRate) || 0)) /
                          100
                      );
                      const cmExpectedAmt = Math.round(
                        ((Number(split.amount) || 0) * (Number(split.cmCommissionRate) || 0)) /
                          100
                      );
                      const cbExpectedAmt = Math.round(
                        ((Number(split.amount) || 0) * (Number(split.cashbackRate) || 0)) /
                          100
                      );
                      const matchedRateRow =
                        rateTableRows.find((r) => r.id === selectedRateRowIds[idx]) ||
                        findBestRateRowForAmount(
                          rateTableRows,
                          selectedCard,
                          split.paymentMethod,
                          split.amount,
                          normalizeCategoryName(split.rateCategory),
                          split.installmentMonths
                        );
                      const methodRateRows = rateTableRows.filter(
                        (r) =>
                          r.cardCompany === selectedCard &&
                          isMethodMatch(r.paymentMethod, split.paymentMethod)
                      );
                      const availableCategories = Array.from(
                        new Set(
                          methodRateRows.map((r) => normalizeCategoryName(r.category))
                        )
                      );
                      if (availableCategories.length === 0) {
                        availableCategories.push('일반');
                      }
                      const activeCategory =
                        normalizeCategoryName(split.rateCategory) ||
                        normalizeCategoryName(matchedRateRow?.category) ||
                        availableCategories[0] ||
                        '일반';

                      return (
                        <div
                          key={split.id}
                          className="rounded-xl border border-slate-200 bg-white p-4 space-y-3.5"
                        >
                          {selectedMethodType === '혼합' && (
                            <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
                              <span className="text-xs font-extrabold text-slate-900">
                                {idx === 0
                                  ? '결제 #1 — 일시불 구간'
                                  : `결제 #${idx + 1} — 할부/다이렉트 구간`}
                              </span>
                              {idx > 0 && (
                                <div className="inline-flex rounded-lg bg-slate-100 p-0.5">
                                  {(['할부', '다이렉트할부'] as SplitPaymentMethod[]).map(
                                    (subMethod) => {
                                      const isSubDirect = subMethod === '다이렉트할부';
                                      const subCount = isSubDirect
                                        ? cardMethodCounts['다이렉트'] || 0
                                        : cardMethodCounts['할부'] || 0;
                                      const hasSubRates = subCount > 0;
                                      const isChosen = split.paymentMethod === subMethod;
                                      return (
                                        <button
                                          key={subMethod}
                                          type="button"
                                          onClick={() =>
                                            handleSplitSubMethodChange(idx, subMethod)
                                          }
                                          className={`rounded-md px-2.5 py-1 text-xs font-bold transition-colors ${
                                            !hasSubRates
                                              ? isChosen
                                                ? 'bg-slate-700 text-slate-100 shadow-sm'
                                                : 'text-slate-400 hover:text-slate-600 bg-slate-200/50'
                                              : isChosen
                                              ? 'bg-slate-900 text-white shadow-sm'
                                              : 'text-slate-600 hover:text-slate-900'
                                          }`}
                                        >
                                          {subMethod === '다이렉트할부' ? '다이렉트' : '할부'}
                                          {!hasSubRates && (
                                            <span className="ml-1 text-[10px] opacity-75 font-normal">
                                              (미등록)
                                            </span>
                                          )}
                                        </button>
                                      );
                                    }
                                  )}
                                </div>
                              )}
                            </div>
                          )}

                          {/* 0. 구분 (요율 유형 옵션: 일반, 저금리, 선입금 등) 선택 */}
                          <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-2.5">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="text-xs font-bold text-slate-700">
                                구분 (유형 옵션)
                              </span>
                              <div className="flex flex-wrap items-center gap-1.5">
                                {availableCategories.map((cat) => {
                                  const isActiveCat = activeCategory === cat;
                                  return (
                                    <button
                                      key={cat}
                                      type="button"
                                      onClick={() => handleSplitCategoryChange(idx, cat)}
                                      className={`rounded-lg px-2.5 py-1 text-xs font-bold border transition-all ${
                                        isActiveCat
                                          ? 'border-slate-900 bg-slate-900 text-white shadow-2xs'
                                          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-400 hover:text-slate-900'
                                      }`}
                                    >
                                      {cat}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          </div>

                          {/* 1. 결제 금액 입력 */}
                          <div>
                            <div className="flex items-baseline justify-between mb-1">
                              <label
                                htmlFor={`v2-amount-${split.id}`}
                                className="text-xs font-bold text-slate-800"
                              >
                                결제 금액 (원)
                              </label>
                              <span className="text-xs font-bold text-slate-500 tabular-nums">
                                {split.amount > 0
                                  ? `${(split.amount / 10000).toLocaleString()}만원`
                                  : '0원'}
                              </span>
                            </div>
                            <input
                              id={`v2-amount-${split.id}`}
                              type="text"
                              inputMode="numeric"
                              value={split.amount > 0 ? formatNumber(split.amount) : ''}
                              onChange={(e) => {
                                const raw = Number(e.target.value.replace(/[^0-9]/g, '')) || 0;
                                handleSplitAmountChange(idx, raw);
                              }}
                              placeholder="결제 금액 입력 (예: 30,000,000)"
                              className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-base font-extrabold text-slate-900 tabular-nums focus:border-slate-900 focus:outline-none"
                            />
                          </div>

                          {/* 2. 결제방법별 맞춤 조건 입력칸 (일시불 vs 할부/다이렉트) */}
                          {isLumpSum ? (
                            <div className="rounded-lg bg-slate-50 p-3 border border-slate-200/80">
                              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                <label
                                  htmlFor={`v2-cb-${split.id}`}
                                  className="text-xs font-bold text-slate-700"
                                >
                                  고객 캐시백 요율 (%)
                                </label>
                                <div className="flex items-center gap-3">
                                  <div className="flex items-center gap-1.5">
                                    <DecimalInput
                                      id={`v2-cb-${split.id}`}
                                      value={split.cashbackRate}
                                      onChange={(n) => updateSplit(idx, { cashbackRate: n })}
                                      className="w-24 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-right text-sm font-extrabold text-slate-900 tabular-nums"
                                    />
                                    <span className="text-xs font-bold text-slate-600">%</span>
                                  </div>
                                  <span className="text-xs font-semibold text-slate-500 tabular-nums">
                                    (예상 캐시백: {formatKRW(cbExpectedAmt)})
                                  </span>
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-lg bg-slate-50 p-3 border border-slate-200/80">
                              <div>
                                <label
                                  htmlFor={`v2-months-${split.id}`}
                                  className="block text-xs font-bold text-slate-700 mb-1.5"
                                >
                                  할부 개월수
                                </label>
                                <div className="flex flex-wrap items-center gap-1.5">
                                  {[12, 24, 36, 48, 60, 72].map((m) => (
                                    <button
                                      key={m}
                                      type="button"
                                      onClick={() => handleSplitMonthsChange(idx, m)}
                                      className={`rounded-md px-2.5 py-1 text-xs font-bold border transition-colors ${
                                        split.installmentMonths === m
                                          ? 'border-slate-900 bg-slate-900 text-white'
                                          : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
                                      }`}
                                    >
                                      {m}개월
                                    </button>
                                  ))}
                                </div>
                              </div>

                              <div>
                                <label
                                  htmlFor={`v2-interest-${split.id}`}
                                  className="block text-xs font-bold text-slate-700 mb-1.5"
                                >
                                  할부 금리 (%)
                                </label>
                                <div className="flex items-center gap-1.5">
                                  <DecimalInput
                                    id={`v2-interest-${split.id}`}
                                    value={split.interestRate}
                                    onChange={(n) => updateSplit(idx, { interestRate: n })}
                                    className="w-28 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-right text-sm font-extrabold text-slate-900 tabular-nums"
                                  />
                                  <span className="text-xs font-bold text-slate-600">%</span>
                                </div>
                              </div>
                            </div>
                          )}

                          {/* 3. CM · AG 수수료율과 예상금액 (직접 수정 가능) */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {/* CM 수수료 */}
                            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 space-y-2">
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-extrabold text-slate-900">
                                  CM 수수료
                                </span>
                                <div className="flex items-center gap-1">
                                  <DecimalInput
                                    aria-label="CM 수수료율(%)"
                                    value={split.cmCommissionRate}
                                    onChange={(n) => updateSplit(idx, { cmCommissionRate: n })}
                                    className="w-20 rounded-md border border-slate-300 bg-white px-2 py-1 text-right text-xs font-extrabold text-slate-900 tabular-nums"
                                  />
                                  <span className="text-xs font-bold text-slate-600">%</span>
                                </div>
                              </div>
                              <div className="flex items-center justify-between pt-1 border-t border-slate-200/80">
                                <span className="text-[11px] font-medium text-slate-500">
                                  예상 금액 (직접수정 가능)
                                </span>
                                <div className="flex items-center gap-1">
                                  <input
                                    type="text"
                                    inputMode="numeric"
                                    aria-label="CM 예상 수수료 금액"
                                    value={formatNumber(cmExpectedAmt)}
                                    onChange={(e) =>
                                      handleDirectCommissionAmountChange(
                                        idx,
                                        'CM',
                                        e.target.value
                                      )
                                    }
                                    className="w-28 rounded-md border border-slate-200 bg-white px-2 py-1 text-right text-sm font-black text-slate-900 tabular-nums"
                                  />
                                  <span className="text-xs font-bold text-slate-700">원</span>
                                </div>
                              </div>
                            </div>
                            {/* AG 수수료 */}
                            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 space-y-2">
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-extrabold text-slate-900">
                                  AG 수수료
                                </span>
                                <div className="flex items-center gap-1">
                                  <DecimalInput
                                    aria-label="AG 수수료율(%)"
                                    value={split.agCommissionRate}
                                    onChange={(n) => updateSplit(idx, { agCommissionRate: n })}
                                    className="w-20 rounded-md border border-slate-300 bg-white px-2 py-1 text-right text-xs font-extrabold text-slate-900 tabular-nums"
                                  />
                                  <span className="text-xs font-bold text-slate-600">%</span>
                                </div>
                              </div>
                              <div className="flex items-center justify-between pt-1 border-t border-slate-200/80">
                                <span className="text-[11px] font-medium text-slate-500">
                                  예상 금액 (직접수정 가능)
                                </span>
                                <div className="flex items-center gap-1">
                                  <input
                                    type="text"
                                    inputMode="numeric"
                                    aria-label="AG 예상 수수료 금액"
                                    value={formatNumber(agExpectedAmt)}
                                    onChange={(e) =>
                                      handleDirectCommissionAmountChange(
                                        idx,
                                        'AG',
                                        e.target.value
                                      )
                                    }
                                    className="w-28 rounded-md border border-slate-200 bg-white px-2 py-1 text-right text-sm font-black text-slate-900 tabular-nums"
                                  />
                                  <span className="text-xs font-bold text-slate-700">원</span>
                                </div>
                              </div>
                            </div>

                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* 혼합 결제일 때 합산 요약 바 */}
                  {selectedMethodType === '혼합' && (
                    <div className="rounded-xl bg-slate-900 p-3.5 text-white flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <span className="text-[11px] text-slate-400 block">혼합 결제 총액</span>
                        <span className="text-base font-extrabold tabular-nums">
                          {formatKRW(totals.totalAmount)}
                        </span>
                      </div>
                      <div className="flex items-center gap-5">
                        <div>
                          <span className="text-[11px] text-slate-400 block">
                            총 예상 CM 수수료 ({totals.effectiveCmRate}%)
                          </span>
                          <span className="text-sm font-extrabold tabular-nums">
                            {formatKRW(totals.totalCmCommission)}
                          </span>
                        </div>
                        <div>
                          <span className="text-[11px] text-slate-400 block">
                            총 예상 AG 수수료 ({totals.effectiveAgRate}%)
                          </span>
                          <span className="text-sm font-extrabold tabular-nums">
                            {formatKRW(totals.totalAgCommission)}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* 우측: 선택된 카드사 · 결제방법 맞춤 간소화 요율표 (5컬럼) */}
                <div className="lg:relative lg:col-span-5">
                <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-4 lg:absolute lg:inset-0">
                  <div className="flex items-center justify-between border-b border-slate-200 pb-2.5">
                    <div>
                      <h3 className="text-xs font-extrabold text-slate-900 flex items-center gap-1.5">
                        <Sparkles className="h-3.5 w-3.5 text-slate-700" />
                        {V2_CARD_DISPLAY_NAMES[selectedCard]} · {selectedMethodType} 요율표
                      </h3>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        결제 금액에 맞는 조건이 자동 적용됩니다. 적용 중인 조건을 누르면 해제되고 다른 조건이 보입니다.
                      </p>
                    </div>
                    <span className="rounded-md bg-white px-2 py-0.5 text-[11px] font-bold text-slate-600 border border-slate-200">
                      {isRateListCollapsed ? `적용 ${visibleRateRows.length} / ${matchingRateRows.length}개` : `${displayedRateRows.length}개 조건`}
                    </span>
                  </div>

                  {/* 우측 요율표 구분 필터 탭 */}
                  {!isRateListCollapsed && rateTableCategories.length > 2 && (
                    <div className="flex flex-wrap items-center gap-1">
                      {rateTableCategories.map((cat) => (
                        <button
                          key={cat}
                          type="button"
                          onClick={() => setRateTableCategoryFilter(cat)}
                          className={`rounded-md px-2 py-1 text-[11px] font-bold transition-colors ${
                            rateTableCategoryFilter === cat
                              ? 'bg-slate-900 text-white'
                              : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                          }`}
                        >
                          {cat}
                        </button>
                      ))}
                    </div>
                  )}

                  {displayedRateRows.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-slate-300 bg-white py-8 text-center text-xs text-slate-400">
                      해당 조건의 등록된 요율표가 없습니다. 좌측 입력란에 직접 요율을 입력해 주세요.
                    </div>
                  ) : (
                    <>
                    <div className="max-h-[380px] space-y-2 overflow-y-auto pr-0.5 lg:max-h-none lg:min-h-0 lg:flex-1">
                      {visibleRateRows.map((row) => {
                        const isSelectedRow = Object.values(selectedRateRowIds).includes(
                          row.id
                        );
                        const isRowLump = row.paymentMethod === '일시불';
                        const rowCategory = normalizeCategoryName(row.category);
                        const refAmt =
                          selectedMethodType === '혼합'
                            ? isRowLump
                              ? paymentSplits[0]?.amount || 0
                              : paymentSplits[1]?.amount || 0
                            : paymentSplits[0]?.amount || 0;
                        const estAg = Math.round((refAmt * row.agCommissionRate) / 100);
                        const estCm = Math.round((refAmt * row.cmCommissionRate) / 100);

                        return (
                          <button
                            key={row.id}
                            type="button"
                            onClick={() => {
                              if (isSelectedRow) {
                                handleUnapplyRateRow(row.id);
                              } else {
                                handleApplyRateRow(row);
                                setShowAllRates(false);
                              }
                            }}
                            title={isSelectedRow ? '눌러서 적용 해제하고 다른 옵션 보기' : '이 조건 적용'}
                            className={`w-full rounded-xl border p-3 text-left transition-all ${
                              isSelectedRow
                                ? 'border-slate-900 bg-slate-900 text-white shadow-xs'
                                : 'border-slate-200 bg-white text-slate-900 hover:border-slate-400'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span
                                  className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${
                                    isSelectedRow
                                      ? 'bg-slate-800 text-slate-200'
                                      : 'bg-slate-100 text-slate-700'
                                  }`}
                                >
                                  {row.paymentMethod === '다이렉트할부'
                                    ? '다이렉트'
                                    : row.paymentMethod}
                                </span>
                                <span
                                  className={`rounded px-1.5 py-0.5 text-[11px] font-bold border ${
                                    isSelectedRow
                                      ? 'border-slate-700 bg-slate-800 text-white'
                                      : rowCategory === '일반'
                                      ? 'border-slate-200 bg-slate-50 text-slate-600'
                                      : 'border-slate-900 bg-slate-900 text-white'
                                  }`}
                                >
                                  {rowCategory}
                                </span>
                                <span className="text-xs font-extrabold">
                                  {row.amountTier}
                                </span>
                                {isSelectedRow && (
                                  <span className="inline-flex items-center gap-0.5 rounded bg-white/15 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300">
                                    <Check className="h-2.5 w-2.5 stroke-[3]" />
                                    적용중 · 눌러서 해제
                                  </span>
                                )}
                              </div>
                              <span
                                className={`text-[11px] font-semibold shrink-0 ${
                                  isSelectedRow ? 'text-slate-300' : 'text-slate-500'
                                }`}
                              >
                                {row.installmentMonths}
                              </span>
                            </div>

                            <div className="mt-2 grid grid-cols-3 gap-1.5 rounded-lg bg-slate-50/10 pt-2 border-t border-slate-200/40 text-xs">
                              <div>
                                <span
                                  className={`block text-[10px] ${
                                    isSelectedRow ? 'text-slate-400' : 'text-slate-500'
                                  }`}
                                >
                                  {isRowLump ? '캐시백' : '할부금리'}
                                </span>
                                <span className="font-extrabold tabular-nums">
                                  {isRowLump
                                    ? `${row.cashbackRate}%`
                                    : `${row.interestRate}%`}
                                </span>
                              </div>
                              <div>
                                <span
                                  className={`block text-[10px] ${
                                    isSelectedRow ? 'text-slate-400' : 'text-slate-500'
                                  }`}
                                >
                                  CM 수수료율
                                </span>
                                <span className="font-extrabold tabular-nums">
                                  {row.cmCommissionRate}%
                                </span>
                                {refAmt > 0 && (
                                  <span
                                    className={`block text-[10px] tabular-nums ${
                                      isSelectedRow ? 'text-slate-300' : 'text-slate-500'
                                    }`}
                                  >
                                    {formatKRW(estCm)}
                                  </span>
                                )}
                              </div>
                              <div>
                                <span
                                  className={`block text-[10px] ${
                                    isSelectedRow ? 'text-slate-400' : 'text-slate-500'
                                  }`}
                                >
                                  AG 수수료율
                                </span>
                                <span className="font-extrabold tabular-nums">
                                  {row.agCommissionRate}%
                                </span>
                                {refAmt > 0 && (
                                  <span
                                    className={`block text-[10px] tabular-nums ${
                                      isSelectedRow ? 'text-slate-300' : 'text-slate-500'
                                    }`}
                                  >
                                    {formatKRW(estAg)}
                                  </span>
                                )}
                              </div>
                            </div>

                            {row.remark && (
                              <p
                                className={`mt-1.5 text-[11px] truncate ${
                                  isSelectedRow ? 'text-slate-300' : 'text-slate-500'
                                }`}
                              >
                                {row.remark}
                              </p>
                            )}
                          </button>
                        );
                      })}
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowAllRates((v) => !v)}
                      hidden={appliedRateIds.length === 0}
                      className="shrink-0 rounded-lg border border-slate-300 bg-white py-2 text-xs font-bold text-slate-700 hover:bg-slate-100"
                    >
                      {isRateListCollapsed ? `다른 조건 보기 (${matchingRateRows.length})` : '적용 중인 조건만 보기'}
                    </button>
                    </>
                  )}
                </div>
                </div>
              </div>

              {/* 비고 및 최종 저장 (contents: 하단 고정 바가 2단계 전체 높이 안에서 따라오도록) */}
              <div className="contents">
                {/* 비고 (선택) */}
                <div className="border-t border-slate-200 pt-5">
                  <label
                    htmlFor="v2-memo"
                    className="block text-xs font-extrabold text-slate-800 mb-1.5"
                  >
                    비고 <span className="font-normal text-slate-500">(선택 · 대시보드 카드에 노출)</span>
                  </label>
                  <input
                    id="v2-memo"
                    type="text"
                    lang="ko"
                    value={requestMemo}
                    onChange={(e) => setRequestMemo(e.target.value)}
                    placeholder="특이사항이나 차량 정보 등 비고 사항을 입력해 주세요 (선택)"
                    className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-xs font-medium text-slate-900 focus:border-slate-900 focus:outline-none"
                  />
                </div>

                {/* 최종 등록 요약 및 제출 버튼 */}
                <div className="sticky bottom-[4.75rem] z-20 mt-5 flex flex-col gap-3 rounded-xl border border-slate-300 bg-white/95 p-4 shadow-lg backdrop-blur-xs sm:flex-row sm:items-center sm:justify-between md:bottom-4">
                  <div className="space-y-0.5 text-xs">
                    <div className="font-extrabold text-slate-900">
                      {selectedCard ? V2_CARD_DISPLAY_NAMES[selectedCard] : '-'} ·{' '}
                      {selectedMethodType || '-'} · 총 {formatKRW(totals.totalAmount)}
                    </div>
                    <div className="text-slate-600 tabular-nums">
                      예상 CM 수수료:{' '}
                      <strong className="text-slate-900">
                        {formatKRW(totals.totalCmCommission)} ({totals.effectiveCmRate}%)
                      </strong>{' '}
                      · 예상 AG 수수료:{' '}
                      <strong className="text-slate-900">
                        {formatKRW(totals.totalAgCommission)} ({totals.effectiveAgRate}%)
                      </strong>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleSaveDraft}
                      className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-300 bg-white px-4 py-3 text-xs font-bold text-slate-700 hover:bg-slate-100 transition-colors"
                    >
                      <Save className="h-4 w-4" />
                      임시 저장
                    </button>
                    <button
                      type="submit"
                      className="inline-flex flex-1 sm:flex-initial items-center justify-center gap-2 rounded-xl bg-slate-900 px-6 py-3 text-sm font-extrabold text-white hover:bg-slate-800 shadow-xs transition-colors"
                    >
                      <Check className="h-4 w-4 stroke-[2.5]" />
                      {editingTxIdV2 ? '거래 승인건 수정 저장' : '거래 승인건 등록 완료'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>
      </form>

      {/* 저장 전 최종 확인 */}
      {isConfirmOpen && selectedCard && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={() => setIsConfirmOpen(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="거래 승인건 최종 확인"
            className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-slate-200 px-5 py-4">
              <h2 className="text-base font-extrabold text-slate-900">
                {editingTxIdV2 ? '수정 내용을 저장할까요?' : '이 내용으로 등록할까요?'}
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">저장하면 대시보드로 이동합니다.</p>
            </div>
            <dl className="max-h-[60vh] space-y-3 overflow-y-auto px-5 py-4 text-xs">
              <div className="grid grid-cols-[5.5rem_1fr] gap-y-2">
                <dt className="text-slate-500">카드사</dt>
                <dd className="flex items-center gap-1.5 font-extrabold text-slate-900">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: CARD_COMPANY_COLORS[selectedCard].mainHex }} />
                  {V2_CARD_DISPLAY_NAMES[selectedCard]}
                </dd>
                <dt className="text-slate-500">결제 방법</dt>
                <dd className="font-extrabold text-slate-900">{selectedMethodType}</dd>
                <dt className="text-slate-500">고객명</dt>
                <dd className="font-extrabold text-slate-900">{customerName.trim()}</dd>
                <dt className="text-slate-500">담당 CM</dt>
                <dd className="text-slate-900">
                  <strong className="font-extrabold">{selectedCmObj?.name}</strong>
                  {selectedCmObj && (
                    <span className="text-slate-500">
                      {' '}
                      · {[selectedCmObj.affiliation, selectedCmObj.employeeId, selectedCmObj.phone].filter(Boolean).join(' · ')}
                    </span>
                  )}
                </dd>
                {canEditApprovalDate && (
                  <>
                    <dt className="text-slate-500">승인일자</dt>
                    <dd className="font-mono font-bold text-slate-900">{approvalDate}</dd>
                  </>
                )}
              </div>
              <div className="space-y-1.5">
                {paymentSplits.map((sp, i) => (
                  <div key={sp.id} className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                    <div>
                      <p className="font-extrabold text-slate-900">
                        {paymentSplits.length > 1 && `#${i + 1} `}
                        {sp.paymentMethod === '다이렉트할부' ? '다이렉트' : sp.paymentMethod}
                        {sp.paymentMethod !== '일시불' && ` ${sp.installmentMonths}개월`} · {sp.rateCategory || '일반'}
                      </p>
                      <p className="text-slate-500">
                        {sp.paymentMethod === '일시불' ? `캐시백 ${sp.cashbackRate}%` : `금리 ${sp.interestRate}%`} · CM{' '}
                        {sp.cmCommissionRate}% · AG {sp.agCommissionRate}%
                      </p>
                    </div>
                    <span className="font-black tabular-nums text-slate-900">{formatKRW(sp.amount)}</span>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-3 gap-2 rounded-lg bg-slate-900 p-3 text-white tabular-nums">
                <div>
                  <span className="block text-[10px] text-slate-400">총 금액</span>
                  <span className="text-sm font-extrabold">{formatKRW(totals.totalAmount)}</span>
                </div>
                <div>
                  <span className="block text-[10px] text-slate-400">CM 수수료 ({totals.effectiveCmRate}%)</span>
                  <span className="text-sm font-extrabold">{formatKRW(totals.totalCmCommission)}</span>
                </div>
                <div>
                  <span className="block text-[10px] text-slate-400">AG 수수료 ({totals.effectiveAgRate}%)</span>
                  <span className="text-sm font-extrabold">{formatKRW(totals.totalAgCommission)}</span>
                </div>
              </div>
            </dl>
            <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3.5">
              <button
                type="button"
                onClick={() => setIsConfirmOpen(false)}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100"
              >
                다시 수정
              </button>
              <button
                type="button"
                autoFocus
                onClick={handleConfirmSave}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-5 py-2 text-xs font-extrabold text-white hover:bg-slate-800"
              >
                <Check className="h-4 w-4" />
                {editingTxIdV2 ? '수정 저장' : '등록 완료'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
