import React, { useEffect, useMemo, useState } from 'react';
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

function findBestRateRowForAmount(
  rows: RateTableRowItem[],
  cardCompany: SplitCardCompany,
  paymentMethod: SplitPaymentMethod,
  amount: number,
  preferredCategory?: string
): RateTableRowItem | undefined {
  const baseRows = rows.filter(
    (r) => r.cardCompany === cardCompany && r.paymentMethod === paymentMethod
  );
  if (baseRows.length === 0) return undefined;

  const categoryFiltered =
    preferredCategory && preferredCategory !== '전체'
      ? baseRows.filter((r) => (r.category || '기본') === preferredCategory)
      : baseRows;

  const targetRows = categoryFiltered.length > 0 ? categoryFiltered : baseRows;

  const candidates = targetRows.map((row) => ({
    row,
    range: parseAmountTierRange(row.amountTier),
  }));

  if (amount > 0) {
    const directMatches = candidates.filter(
      ({ range }) =>
        amount >= range.minAmount &&
        (range.maxAmount === null || amount <= range.maxAmount)
    );

    if (directMatches.length > 0) {
      directMatches.sort((a, b) => {
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

    const sortedByMinAsc = [...candidates].sort(
      (a, b) => a.range.minAmount - b.range.minAmount
    );
    if (amount < sortedByMinAsc[0].range.minAmount) {
      return sortedByMinAsc[0].row;
    }
    return sortedByMinAsc[sortedByMinAsc.length - 1].row;
  }

  const sortedByMinAsc = [...candidates].sort(
    (a, b) => a.range.minAmount - b.range.minAmount
  );
  return sortedByMinAsc[0].row;
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
    rateCategory: rateRow?.category || '기본',
    amount: defaultAmount,
    installmentMonths: isLumpSum ? 1 : 36,
    cashbackRate: isLumpSum ? (rateRow ? rateRow.cashbackRate : 2.0) : 0,
    interestRate: isLumpSum ? 0 : rateRow ? rateRow.interestRate : 4.5,
    agCommissionRate: rateRow ? rateRow.agCommissionRate : isLumpSum ? 0.85 : 1.1,
    cmCommissionRate: rateRow ? rateRow.cmCommissionRate : isLumpSum ? 0.5 : 0.65,
  };
}

export const TransactionRegisterPageV2: React.FC = () => {
  const {
    users,
    transactions,
    rateTableRows,
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
  } = useApp();
  const navigate = useNavigate();

  const cmUsers = useMemo(
    () => users.filter((u) => u.role === 'CM' && u.isActive),
    [users]
  );

  const todayStr = useMemo(() => getTodayDateString(), []);

  // 현재 열려있는 아코디언 단계 (1: 카드사, 2: 결제방법, 3: 결제 및 고객/CM 정보 입력)
  const [activeStep, setActiveStep] = useState<1 | 2 | 3>(1);

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

  // 고객 / CM 정보 및 비고
  const [customerName, setCustomerName] = useState<string>('');
  const [selectedCmId, setSelectedCmId] = useState<string>(() => cmUsers[0]?.id || '');
  const [requestMemo, setRequestMemo] = useState<string>('');

  // 임시저장 목록 모달 및 현재 불러온 드래프트 ID
  const [currentDraftId, setCurrentDraftId] = useState<string | undefined>(undefined);
  const [isDraftDrawerOpen, setIsDraftDrawerOpen] = useState<boolean>(false);

  // 간편 CM 즉시 추가 토글
  const [isQuickCmOpen, setIsQuickCmOpen] = useState<boolean>(false);
  const [quickCmName, setQuickCmName] = useState<string>('');
  const [quickCmAffiliation, setQuickCmAffiliation] = useState<string>('');
  const [quickCmPhone, setQuickCmPhone] = useState<string>('');

  // 등록 완료 후 안내 배너
  const [lastRegisteredTxId, setLastRegisteredTxId] = useState<string | null>(null);

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
    setActiveStep(3);
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
      setActiveStep((Math.min(3, found.activeStep || 1) as 1 | 2 | 3));
    }
    setPendingDraftIdV2(null);
  }, [pendingDraftIdV2, draftsV2, todayStr, cmUsers, setEditingTxIdV2, setPendingDraftIdV2]);

  // 선택된 카드사 + 결제방법에 맞는 요율표 필터링 (결제방법 순 · 금액 구간 오름차순 정렬)
  const matchingRateRows = useMemo(() => {
    if (!selectedCard || !selectedMethodType) return [];
    const cardRows = rateTableRows.filter((r) => r.cardCompany === selectedCard);

    let filtered: RateTableRowItem[];
    if (selectedMethodType === '일시불') {
      filtered = cardRows.filter((r) => r.paymentMethod === '일시불');
    } else if (selectedMethodType === '다이렉트') {
      filtered = cardRows.filter((r) => r.paymentMethod === '다이렉트할부');
    } else if (selectedMethodType === '할부') {
      filtered = cardRows.filter((r) => r.paymentMethod === '할부');
    } else {
      filtered = cardRows;
    }

    const methodOrder: Record<SplitPaymentMethod, number> = {
      일시불: 1,
      다이렉트할부: 2,
      할부: 3,
    };

    return [...filtered].sort((a, b) => {
      if (methodOrder[a.paymentMethod] !== methodOrder[b.paymentMethod]) {
        return methodOrder[a.paymentMethod] - methodOrder[b.paymentMethod];
      }
      const catA = a.category || '기본';
      const catB = b.category || '기본';
      if (catA !== catB) {
        if (catA === '기본') return -1;
        if (catB === '기본') return 1;
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
      new Set(matchingRateRows.map((r) => (r.category || '기본').trim() || '기본'))
    );
    return ['전체', ...unique];
  }, [matchingRateRows]);

  const displayedRateRows = useMemo(() => {
    if (rateTableCategoryFilter === '전체') return matchingRateRows;
    return matchingRateRows.filter(
      (r) => (r.category || '기본') === rateTableCategoryFilter
    );
  }, [matchingRateRows, rateTableCategoryFilter]);

  // 결제 합계 및 예상 수수료 실시간 계산
  const totals = useMemo(() => calcSplitTotals(paymentSplits), [paymentSplits]);

  // 1단계: 카드사 선택 핸들러
  const handleSelectCard = (card: SplitCardCompany) => {
    setSelectedCard(card);
    setLastRegisteredTxId(null);

    if (selectedMethodType) {
      // 이미 결제방법이 선택되어 있었다면 해당 카드사의 기본 요율로 갱신
      initializeSplitsForCardAndMethod(card, selectedMethodType);
      setActiveStep(3);
    } else {
      setActiveStep(2);
    }
  };

  // 카드사 + 결제방법 조합에 맞춰 결제 입력 행 초기화 (초기 금액대에 맞는 조건 자동 선택)
  const initializeSplitsForCardAndMethod = (
    card: SplitCardCompany,
    methodType: V2PaymentMethodType
  ) => {
    const defaultSingleAmount = 30000000;
    setRateTableCategoryFilter('전체');

    if (methodType === '일시불') {
      const matchedRow = findBestRateRowForAmount(
        rateTableRows,
        card,
        '일시불',
        defaultSingleAmount,
        '기본'
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
        '기본'
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
        '기본'
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
        '기본'
      );
      const split1 = createDefaultSplit(card, '일시불', lumpRow, firstAmount);

      const directRow = findBestRateRowForAmount(
        rateTableRows,
        card,
        '다이렉트할부',
        secondAmount,
        '기본'
      );
      const instRow = findBestRateRowForAmount(
        rateTableRows,
        card,
        '할부',
        secondAmount,
        '기본'
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
    const card = selectedCard || '국민';
    if (!selectedCard) setSelectedCard(card);
    setSelectedMethodType(methodType);
    initializeSplitsForCardAndMethod(card, methodType);
    setActiveStep(3);
  };

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
    const preferredCat = split.rateCategory || '기본';
    const matchedRow = findBestRateRowForAmount(
      rateTableRows,
      card,
      split.paymentMethod,
      nextAmount,
      preferredCat
    );

    if (matchedRow) {
      const isLump = split.paymentMethod === '일시불';
      updateSplit(index, {
        amount: nextAmount,
        rateCategory: matchedRow.category || preferredCat,
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

  // 3단계: 구분(저금리, 선입금, 신용한도 등) 옵션 선택 시 해당 구분 + 현재 결제 금액대에 맞는 요율 자동 매칭
  const handleSplitCategoryChange = (index: number, nextCategory: string) => {
    const split = paymentSplits[index];
    if (!split) return;

    const card = selectedCard || split.cardCompany;
    const matchedRow = findBestRateRowForAmount(
      rateTableRows,
      card,
      split.paymentMethod,
      split.amount,
      nextCategory
    );

    if (matchedRow) {
      const isLump = split.paymentMethod === '일시불';
      updateSplit(index, {
        rateCategory: matchedRow.category || nextCategory,
        cashbackRate: isLump ? matchedRow.cashbackRate : 0,
        interestRate: isLump ? 0 : matchedRow.interestRate,
        agCommissionRate: matchedRow.agCommissionRate,
        cmCommissionRate: matchedRow.cmCommissionRate,
      });
      setSelectedRateRowIds((prev) => ({ ...prev, [index]: matchedRow.id }));
    } else {
      updateSplit(index, { rateCategory: nextCategory });
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
    const matchedRow = findBestRateRowForAmount(
      rateTableRows,
      card,
      nextSubMethod,
      split.amount,
      split.rateCategory || '기본'
    );

    const isLump = nextSubMethod === '일시불';
    if (matchedRow) {
      updateSplit(index, {
        paymentMethod: nextSubMethod,
        rateCategory: matchedRow.category || '기본',
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
    if (selectedMethodType === '혼합') {
      const idx =
        targetSplitIndex !== undefined
          ? targetSplitIndex
          : row.paymentMethod === '일시불'
          ? 0
          : 1;
      const isLump = row.paymentMethod === '일시불';
      updateSplit(idx, {
        paymentMethod: row.paymentMethod,
        rateCategory: row.category || '기본',
        cashbackRate: isLump ? row.cashbackRate : 0,
        interestRate: isLump ? 0 : row.interestRate,
        agCommissionRate: row.agCommissionRate,
        cmCommissionRate: row.cmCommissionRate,
      });
      setSelectedRateRowIds((prev) => ({ ...prev, [idx]: row.id }));
    } else {
      const isLump = row.paymentMethod === '일시불';
      updateSplit(0, {
        paymentMethod: row.paymentMethod,
        rateCategory: row.category || '기본',
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
    setActiveStep((Math.min(3, draft.activeStep || 1) as 1 | 2 | 3));
    setIsDraftDrawerOpen(false);
    pushToast({
      type: 'info',
      title: '임시 저장 데이터를 불러왔습니다',
      description: draft.title,
    });
  };

  // 간편 CM 등록
  const handleQuickAddCm = () => {
    if (!quickCmName.trim()) {
      pushToast({ type: 'error', title: 'CM 이름을 입력해 주세요.' });
      return;
    }
    const res = saveUserAccount({
      loginId: `cm.${Date.now()}@autodealer.kr`,
      name: quickCmName.trim(),
      role: 'CM',
      affiliation: quickCmAffiliation.trim() || '제휴 대리점',
      phone: quickCmPhone.trim() || '010-0000-0000',
      isActive: true,
    });
    if (res.ok) {
      setQuickCmName('');
      setQuickCmAffiliation('');
      setQuickCmPhone('');
      setIsQuickCmOpen(false);
    }
  };

  // 최종 거래 승인건 등록 제출
  const handleSubmitTransaction = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCard) {
      setActiveStep(1);
      pushToast({ type: 'error', title: '1단계에서 카드사를 선택해 주세요.' });
      return;
    }
    if (!selectedMethodType || paymentSplits.length === 0) {
      setActiveStep(2);
      pushToast({ type: 'error', title: '2단계에서 결제 방법을 선택해 주세요.' });
      return;
    }
    if (paymentSplits.some((s) => !s.amount || s.amount <= 0)) {
      setActiveStep(3);
      pushToast({ type: 'error', title: '결제 금액을 0원보다 크게 입력해 주세요.' });
      return;
    }
    if (!customerName.trim()) {
      setActiveStep(3);
      pushToast({ type: 'error', title: '고객명을 입력해 주세요.' });
      return;
    }
    if (!selectedCmId) {
      setActiveStep(3);
      pushToast({ type: 'error', title: '담당 CM을 선택해 주세요.' });
      return;
    }

    const existingTx = editingTxIdV2
      ? transactions.find((t) => t.id === editingTxIdV2)
      : undefined;

    const res = saveAgTransactionRequest({
      txId: editingTxIdV2 || undefined,
      customerName: customerName.trim(),
      requestDate,
      approvalDate: existingTx ? existingTx.approvalDate : '',
      status: existingTx ? existingTx.status : 'WAITING',
      settlementStatus: existingTx ? existingTx.settlementStatus : '정산 대기',
      cmId: selectedCmId,
      paymentSplits: paymentSplits.map((s) => ({
        ...s,
        cardCompany: selectedCard,
      })),
      requestMemo: requestMemo.trim() || undefined,
    });

    if (res.ok) {
      if (currentDraftId) {
        deleteDraftV2(currentDraftId);
      }
      const savedId = res.transactionId || editingTxIdV2 || '신규';
      handleResetForm();
      setLastRegisteredTxId(savedId);
    } else {
      pushToast({ type: 'error', title: '등록 실패', description: res.message });
    }
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
            단계별로 선택하면 다음 입력 단계가 자동으로 열립니다.
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

      {/* 등록 완료 알림 배너 */}
      {lastRegisteredTxId && (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-xl border border-slate-900 bg-slate-900 px-4 py-3.5 text-white">
          <div className="flex items-center gap-2.5">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500 text-slate-950">
              <Check className="h-4 w-4 stroke-[3]" />
            </div>
            <div>
              <p className="text-sm font-bold">
                거래 승인건({lastRegisteredTxId})이 정상 등록되었습니다.
              </p>
              <p className="text-xs text-slate-300">
                이어서 새 거래를 등록하거나 월별 수수료 정산 페이지에서 내역을 확인할 수 있습니다.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => navigate('/v2/dashboard')}
              className="rounded-lg bg-white px-3 py-1.5 text-xs font-bold text-slate-900 hover:bg-slate-100"
            >
              대시보드 확인
            </button>
            <button
              type="button"
              onClick={() => navigate('/v2/settlements')}
              className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-700"
            >
              월별 정산 보기
            </button>
            <button
              type="button"
              onClick={() => setLastRegisteredTxId(null)}
              className="rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800"
            >
              닫기
            </button>
          </div>
        </div>
      )}

      {/* 단계별 아코디언 폼 */}
      <form onSubmit={handleSubmitTransaction} className="space-y-3">
        {/* ================================================================= */}
        {/* STEP 1. 카드사 선택 */}
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
                    : selectedCard
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-500'
                }`}
              >
                {selectedCard && activeStep !== 1 ? <Check className="h-3.5 w-3.5" /> : '1'}
              </span>
              <span className="text-sm font-bold">카드사 선택</span>
            </div>

            <div className="flex items-center gap-2">
              {selectedCard && (
                <span
                  className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-bold ${
                    activeStep === 1
                      ? 'bg-slate-800 text-white'
                      : 'bg-slate-100 text-slate-900'
                  }`}
                >
                  <img
                    src={V2_CARD_LOGO_URLS[selectedCard]}
                    alt={V2_CARD_DISPLAY_NAMES[selectedCard]}
                    className="h-4 w-4 rounded-sm bg-white p-0.5 object-contain"
                  />
                  {V2_CARD_DISPLAY_NAMES[selectedCard]}
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
            <div className="p-4 sm:p-5 border-t border-slate-100">
              <p className="text-xs text-slate-500 mb-3.5">
                결제 진행할 카드사를 선택하세요. 선택 즉시 다음 단계로 이동합니다.
              </p>
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
          )}
        </section>

        {/* ================================================================= */}
        {/* STEP 2. 결제 방법 선택 */}
        {/* ================================================================= */}
        <section className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-2xs">
          <button
            type="button"
            onClick={() => {
              if (!selectedCard) {
                setActiveStep(1);
                pushToast({ type: 'info', title: '먼저 카드사를 선택해 주세요.' });
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
                    : selectedMethodType
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-500'
                }`}
              >
                {selectedMethodType && activeStep !== 2 ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  '2'
                )}
              </span>
              <span className="text-sm font-bold">결제 방법 선택</span>
            </div>

            <div className="flex items-center gap-2">
              {selectedMethodType && (
                <span
                  className={`rounded-md px-2.5 py-1 text-xs font-bold ${
                    activeStep === 2
                      ? 'bg-slate-800 text-white'
                      : 'bg-slate-100 text-slate-900'
                  }`}
                >
                  {selectedMethodType}
                </span>
              )}
              {activeStep === 2 ? (
                <ChevronDown className="h-4 w-4 opacity-70" />
              ) : (
                <span className="text-xs font-semibold text-slate-400 flex items-center gap-0.5">
                  변경 <ChevronRight className="h-3.5 w-3.5" />
                </span>
              )}
            </div>
          </button>

          {activeStep === 2 && (
            <div className="p-4 sm:p-5 border-t border-slate-100">
              <p className="text-xs text-slate-500 mb-3">
                4가지 결제 방법 중 하나를 선택하세요.
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {V2_PAYMENT_METHODS.map((m) => {
                  const isSelected = selectedMethodType === m.key;
                  return (
                    <button
                      key={m.key}
                      type="button"
                      onClick={() => handleSelectMethod(m.key)}
                      className={`flex flex-col justify-between rounded-xl border p-4 text-left transition-all min-h-[88px] ${
                        isSelected
                          ? 'border-slate-900 bg-slate-900 text-white shadow-sm'
                          : 'border-slate-200 bg-white text-slate-900 hover:border-slate-400 hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-base font-extrabold">{m.label}</span>
                        {isSelected && <Check className="h-4 w-4 stroke-[3]" />}
                      </div>
                      <p
                        className={`text-xs mt-2 ${
                          isSelected ? 'text-slate-300' : 'text-slate-500'
                        }`}
                      >
                        {m.desc}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </section>

        {/* ================================================================= */}
        {/* STEP 3. 결제 정보 입력 + 우측 간소화된 요율표 */}
        {/* ================================================================= */}
        <section className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-2xs">
          <button
            type="button"
            onClick={() => {
              if (!selectedCard) {
                setActiveStep(1);
                return;
              }
              if (!selectedMethodType) {
                setActiveStep(2);
                return;
              }
              setActiveStep(3);
            }}
            className={`flex w-full items-center justify-between px-4 py-3.5 text-left transition-colors ${
              activeStep === 3 ? 'bg-slate-900 text-white' : 'bg-white hover:bg-slate-50'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-extrabold ${
                  activeStep === 3
                    ? 'bg-white text-slate-900'
                    : totals.totalAmount > 0 && customerName.trim()
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-500'
                }`}
              >
                {totals.totalAmount > 0 && customerName.trim() && activeStep !== 3 ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  '3'
                )}
              </span>
              <span className="text-sm font-bold">결제 정보 입력</span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {totals.totalAmount > 0 && (
                <span
                  className={`rounded-md px-2.5 py-1 text-xs font-bold tabular-nums ${
                    activeStep === 3
                      ? 'bg-slate-800 text-white'
                      : 'bg-slate-100 text-slate-900'
                  }`}
                >
                  총 {formatKRW(totals.totalAmount)} · AG {formatKRW(totals.totalAgCommission)} / CM{' '}
                  {formatKRW(totals.totalCmCommission)}
                </span>
              )}
              {(customerName.trim() || selectedCmObj) && (
                <span
                  className={`rounded-md px-2.5 py-1 text-xs font-bold ${
                    activeStep === 3
                      ? 'bg-slate-800 text-white'
                      : 'bg-slate-100 text-slate-900'
                  }`}
                >
                  {customerName.trim() ? `고객: ${customerName.trim()}` : '고객 미입력'} ·{' '}
                  {selectedCmObj ? `CM: ${selectedCmObj.name}` : 'CM 미선택'}
                </span>
              )}
              {activeStep === 3 ? (
                <ChevronDown className="h-4 w-4 opacity-70" />
              ) : (
                <span className="text-xs font-semibold text-slate-400 flex items-center gap-0.5">
                  열기 <ChevronRight className="h-3.5 w-3.5" />
                </span>
              )}
            </div>
          </button>

          {activeStep === 3 && selectedCard && selectedMethodType && (
            <div className="p-4 sm:p-5 border-t border-slate-100 space-y-5">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
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
                        승인일자 (승인 시 기록)
                      </label>
                      <input
                        id="v2-approval-date"
                        type="text"
                        value={approvalDate}
                        placeholder="카드 승인 시 자동 기록"
                        disabled
                        readOnly
                        className="w-full rounded-lg border border-slate-200 bg-slate-200/70 px-2.5 py-1.5 text-xs font-bold text-slate-500 placeholder:text-slate-400 cursor-not-allowed"
                      />
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
                      const matchedRateRow = rateTableRows.find(
                        (r) => r.id === selectedRateRowIds[idx]
                      );
                      const methodRateRows = rateTableRows.filter(
                        (r) =>
                          r.cardCompany === selectedCard &&
                          r.paymentMethod === split.paymentMethod
                      );
                      const availableCategories = Array.from(
                        new Set(
                          methodRateRows.map((r) => (r.category || '기본').trim() || '기본')
                        )
                      );
                      if (availableCategories.length === 0) {
                        availableCategories.push('기본');
                      }
                      const activeCategory =
                        split.rateCategory ||
                        matchedRateRow?.category ||
                        availableCategories[0] ||
                        '기본';

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
                                    (subMethod) => (
                                      <button
                                        key={subMethod}
                                        type="button"
                                        onClick={() =>
                                          handleSplitSubMethodChange(idx, subMethod)
                                        }
                                        className={`rounded-md px-2.5 py-1 text-xs font-bold transition-colors ${
                                          split.paymentMethod === subMethod
                                            ? 'bg-slate-900 text-white'
                                            : 'text-slate-600 hover:text-slate-900'
                                        }`}
                                      >
                                        {subMethod === '다이렉트할부' ? '다이렉트' : '할부'}
                                      </button>
                                    )
                                  )}
                                </div>
                              )}
                            </div>
                          )}

                          {/* 0. 구분 (요율 유형 옵션: 기본, 저금리, 선입금 등) 선택 */}
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

                            {/* 결제 금액대에 맞춰 자동 선택된 조건 표시 배너 */}
                            {matchedRateRow && (
                              <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <span className="inline-flex shrink-0 items-center gap-1 rounded bg-slate-900 px-1.5 py-0.5 text-[10px] font-bold text-white">
                                    <Sparkles className="h-2.5 w-2.5" />
                                    금액대 자동 선택
                                  </span>
                                  <span className="inline-flex shrink-0 items-center rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-700">
                                    {matchedRateRow.category || '기본'}
                                  </span>
                                  <span className="font-extrabold text-slate-900 truncate">
                                    {matchedRateRow.amountTier}
                                  </span>
                                  {matchedRateRow.remark && (
                                    <span className="text-slate-500 truncate hidden sm:inline">
                                      · {matchedRateRow.remark}
                                    </span>
                                  )}
                                </div>
                                <span className="font-mono text-[11px] font-bold text-slate-700 shrink-0">
                                  {isLumpSum
                                    ? `캐시백 ${matchedRateRow.cashbackRate}%`
                                    : `금리 ${matchedRateRow.interestRate}%`}{' '}
                                  · AG {matchedRateRow.agCommissionRate}% · CM{' '}
                                  {matchedRateRow.cmCommissionRate}%
                                </span>
                              </div>
                            )}
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
                                    <input
                                      id={`v2-cb-${split.id}`}
                                      type="number"
                                      step="0.01"
                                      min="0"
                                      max="10"
                                      value={split.cashbackRate}
                                      onChange={(e) =>
                                        updateSplit(idx, {
                                          cashbackRate: parseFloat(e.target.value) || 0,
                                        })
                                      }
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
                                  {[12, 24, 36, 48, 60].map((m) => (
                                    <button
                                      key={m}
                                      type="button"
                                      onClick={() =>
                                        updateSplit(idx, { installmentMonths: m })
                                      }
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
                                  <input
                                    id={`v2-interest-${split.id}`}
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    max="20"
                                    value={split.interestRate}
                                    onChange={(e) =>
                                      updateSplit(idx, {
                                        interestRate: parseFloat(e.target.value) || 0,
                                      })
                                    }
                                    className="w-28 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-right text-sm font-extrabold text-slate-900 tabular-nums"
                                  />
                                  <span className="text-xs font-bold text-slate-600">%</span>
                                </div>
                              </div>
                            </div>
                          )}

                          {/* 3. AG 수수료율·예상금액 & CM 수수료율·예상금액 (직접 수정 가능) */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {/* AG 수수료 */}
                            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 space-y-2">
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-extrabold text-slate-900">
                                  AG 수수료
                                </span>
                                <div className="flex items-center gap-1">
                                  <input
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    max="15"
                                    aria-label="AG 수수료율(%)"
                                    value={split.agCommissionRate}
                                    onChange={(e) =>
                                      updateSplit(idx, {
                                        agCommissionRate: parseFloat(e.target.value) || 0,
                                      })
                                    }
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

                            {/* CM 수수료 */}
                            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 space-y-2">
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-extrabold text-slate-900">
                                  CM 수수료
                                </span>
                                <div className="flex items-center gap-1">
                                  <input
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    max="15"
                                    aria-label="CM 수수료율(%)"
                                    value={split.cmCommissionRate}
                                    onChange={(e) =>
                                      updateSplit(idx, {
                                        cmCommissionRate: parseFloat(e.target.value) || 0,
                                      })
                                    }
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
                            총 예상 AG 수수료 ({totals.effectiveAgRate}%)
                          </span>
                          <span className="text-sm font-extrabold tabular-nums">
                            {formatKRW(totals.totalAgCommission)}
                          </span>
                        </div>
                        <div>
                          <span className="text-[11px] text-slate-400 block">
                            총 예상 CM 수수료 ({totals.effectiveCmRate}%)
                          </span>
                          <span className="text-sm font-extrabold tabular-nums">
                            {formatKRW(totals.totalCmCommission)}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* 우측: 선택된 카드사 · 결제방법 맞춤 간소화 요율표 (5컬럼) */}
                <div className="lg:col-span-5 rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-3">
                  <div className="flex items-center justify-between border-b border-slate-200 pb-2.5">
                    <div>
                      <h3 className="text-xs font-extrabold text-slate-900 flex items-center gap-1.5">
                        <Sparkles className="h-3.5 w-3.5 text-slate-700" />
                        {V2_CARD_DISPLAY_NAMES[selectedCard]} · {selectedMethodType} 요율표
                      </h3>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        결제 금액 및 구분(기본/저금리 등)에 맞춰 자동 선택되며 클릭해 변경할 수 있습니다.
                      </p>
                    </div>
                    <span className="rounded-md bg-white px-2 py-0.5 text-[11px] font-bold text-slate-600 border border-slate-200">
                      {displayedRateRows.length}개 조건
                    </span>
                  </div>

                  {/* 우측 요율표 구분 필터 탭 */}
                  {rateTableCategories.length > 2 && (
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
                    <div className="space-y-2 max-h-[380px] overflow-y-auto pr-0.5">
                      {displayedRateRows.map((row) => {
                        const isSelectedRow = Object.values(selectedRateRowIds).includes(
                          row.id
                        );
                        const isRowLump = row.paymentMethod === '일시불';
                        const rowCategory = row.category || '기본';
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
                            onClick={() => handleApplyRateRow(row)}
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
                                      : rowCategory === '기본'
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
                                    적용중
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
                  )}
                </div>
              </div>

              {/* ============================================================= */}
              {/* 고객 / CM 정보 및 비고 입력 (결제 정보 입력에 통합) */}
              {/* ============================================================= */}
              <div className="pt-5 border-t border-slate-200 space-y-5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-extrabold text-slate-900">
                    고객 / CM 정보 및 비고 입력
                  </span>
                  <span className="text-xs text-slate-500">
                    대시보드 카드에도 비고 내용이 함께 표시됩니다.
                  </span>
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
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      placeholder="고객 성명 입력 (예: 홍길동)"
                      className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm font-bold text-slate-900 focus:border-slate-900 focus:outline-none"
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
                        담당 CM 선택 (설정 등록 CM) <span className="text-rose-500">*</span>
                      </label>
                      <button
                        type="button"
                        onClick={() => setIsQuickCmOpen((prev) => !prev)}
                        className="inline-flex items-center gap-1 text-xs font-bold text-slate-600 hover:text-slate-900 underline"
                      >
                        <UserPlus className="h-3 w-3" />
                        {isQuickCmOpen ? '직접 추가 닫기' : '+ 새 CM 간편 등록'}
                      </button>
                    </div>

                    <select
                      id="v2-cm-select"
                      value={selectedCmId}
                      onChange={(e) => setSelectedCmId(e.target.value)}
                      className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm font-bold text-slate-900 focus:border-slate-900 focus:outline-none"
                    >
                      {cmUsers.map((cm) => (
                        <option key={cm.id} value={cm.id}>
                          {cm.name} ({cm.affiliation} · {cm.phone})
                        </option>
                      ))}
                    </select>

                    {/* 빠른 선택 칩 */}
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {cmUsers.map((cm) => (
                        <button
                          key={cm.id}
                          type="button"
                          onClick={() => setSelectedCmId(cm.id)}
                          className={`rounded-lg px-2.5 py-1 text-xs font-bold border transition-colors ${
                            selectedCmId === cm.id
                              ? 'border-slate-900 bg-slate-900 text-white'
                              : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
                          }`}
                        >
                          {cm.name}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* 즉석 CM 추가 인라인 폼 */}
                {isQuickCmOpen && (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 space-y-3">
                    <p className="text-xs font-bold text-slate-800">
                      새 CM 정보를 저장하면 목록에 즉시 추가됩니다.
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                      <input
                        type="text"
                        value={quickCmName}
                        onChange={(e) => setQuickCmName(e.target.value)}
                        placeholder="CM 이름 (필수)"
                        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold"
                      />
                      <input
                        type="text"
                        value={quickCmAffiliation}
                        onChange={(e) => setQuickCmAffiliation(e.target.value)}
                        placeholder="소속/대리점 (예: 현대 서초지점)"
                        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
                      />
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={quickCmPhone}
                          onChange={(e) => setQuickCmPhone(e.target.value)}
                          placeholder="연락처 (선택)"
                          className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
                        />
                        <button
                          type="button"
                          onClick={handleQuickAddCm}
                          className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white hover:bg-slate-800 shrink-0"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          저장
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* 비고 (선택) */}
                <div>
                  <label
                    htmlFor="v2-memo"
                    className="block text-xs font-extrabold text-slate-800 mb-1.5"
                  >
                    비고 <span className="font-normal text-slate-500">(선택 · 대시보드 카드에 노출)</span>
                  </label>
                  <input
                    id="v2-memo"
                    type="text"
                    value={requestMemo}
                    onChange={(e) => setRequestMemo(e.target.value)}
                    placeholder="특이사항이나 차량 정보 등 비고 사항을 입력해 주세요 (선택)"
                    className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-xs font-medium text-slate-900 focus:border-slate-900 focus:outline-none"
                  />
                </div>

                {/* 최종 등록 요약 및 제출 버튼 */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-xl bg-slate-50 p-4 border border-slate-200">
                  <div className="space-y-0.5 text-xs">
                    <div className="font-extrabold text-slate-900">
                      {selectedCard ? V2_CARD_DISPLAY_NAMES[selectedCard] : '-'} ·{' '}
                      {selectedMethodType || '-'} · 총 {formatKRW(totals.totalAmount)}
                    </div>
                    <div className="text-slate-600 tabular-nums">
                      예상 AG 수수료:{' '}
                      <strong className="text-slate-900">
                        {formatKRW(totals.totalAgCommission)} ({totals.effectiveAgRate}%)
                      </strong>{' '}
                      · 예상 CM 수수료:{' '}
                      <strong className="text-slate-900">
                        {formatKRW(totals.totalCmCommission)} ({totals.effectiveCmRate}%)
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
    </div>
  );
};
