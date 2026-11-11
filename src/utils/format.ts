import {
  AppliedPromotionSnapshot,
  CardCompany,
  PaymentSplitItem,
  SplitCardCompany,
  Transaction,
} from '../types';

export function formatKRW(amount: number): string {
  return `${new Intl.NumberFormat('ko-KR').format(Math.round(amount))}원`;
}

export function formatSignedKRW(amount: number): string {
  const rounded = Math.round(amount);
  if (rounded > 0) {
    return `+${new Intl.NumberFormat('ko-KR').format(rounded)}원`;
  }
  if (rounded < 0) {
    return `-${new Intl.NumberFormat('ko-KR').format(Math.abs(rounded))}원`;
  }
  return '0원';
}

export function formatSignedRate(rate?: number | null): string {
  const num = Number(rate) || 0;
  if (num > 0) return `+${num}%`;
  if (num < 0) return `${num}%`;
  return '0%';
}

export function formatNumber(amount: number): string {
  return new Intl.NumberFormat('ko-KR').format(Math.round(amount));
}

export function mapSplitCardToCardCompany(sc: SplitCardCompany): CardCompany {
  switch (sc) {
    case '제휴카드사(삼성)':
      return '삼성카드';
    case '국민':
      return 'KB국민카드';
    case '농협':
      return 'NH농협카드';
    case '롯데':
      return '롯데카드';
    case '신한':
      return '신한카드';
    case '우리':
      return '우리카드';
    case '하나':
      return '하나카드';
    default:
      return '삼성카드';
  }
}

export function calcPromotionIncentives(
  splits: PaymentSplitItem[],
  promotions?: AppliedPromotionSnapshot[]
): {
  promoCashbackDeltaAmount: number;
  promoCashbackRateDelta: number;
  promoInterestRateDelta: number;
  promoAgRateDelta: number;
  promoCmRateDelta: number;
  promoAgIncentive: number;
  promoCmIncentive: number;
} {
  if (!promotions || promotions.length === 0) {
    return {
      promoCashbackDeltaAmount: 0,
      promoCashbackRateDelta: 0,
      promoInterestRateDelta: 0,
      promoAgRateDelta: 0,
      promoCmRateDelta: 0,
      promoAgIncentive: 0,
      promoCmIncentive: 0,
    };
  }

  const totalAmt = splits.reduce((sum, s) => sum + (Number(s.amount) || 0), 0);
  const lumpSumAmt = splits
    .filter((s) => s.paymentMethod === '일시불')
    .reduce((sum, s) => sum + (Number(s.amount) || 0), 0);

  let promoCashbackDeltaAmount = 0;
  let promoCashbackRateDelta = 0;
  let promoInterestRateDelta = 0;
  let promoAgRateDelta = 0;
  let promoCmRateDelta = 0;
  let promoAgIncentive = 0;
  let promoCmIncentive = 0;

  promotions.forEach((p) => {
    const matchedSplitAmt =
      p.paymentMethod === '통합'
        ? totalAmt
        : splits
            .filter((s) => s.paymentMethod === p.paymentMethod)
            .reduce((sum, s) => sum + (Number(s.amount) || 0), 0);
    const basisAmt = matchedSplitAmt > 0 ? matchedSplitAmt : totalAmt;

    const cbDelta = Number(p.cashbackRateDelta) || 0;
    const intDelta = Number(p.interestRateDelta) || 0;
    const agRateDelta = Number(p.agIncentiveRate) || 0;
    const cmRateDelta = Number(p.cmIncentiveRate) || 0;

    promoCashbackRateDelta = Number((promoCashbackRateDelta + cbDelta).toFixed(2));
    promoInterestRateDelta = Number((promoInterestRateDelta + intDelta).toFixed(2));
    promoAgRateDelta = Number((promoAgRateDelta + agRateDelta).toFixed(2));
    promoCmRateDelta = Number((promoCmRateDelta + cmRateDelta).toFixed(2));

    // 캐시백 변동 금액은 일시불 금액 기준으로 반영 (+ 또는 - 마이너스 반영)
    if (cbDelta !== 0) {
      const cbBasis = lumpSumAmt > 0 ? lumpSumAmt : basisAmt;
      promoCashbackDeltaAmount += Math.round((cbBasis * cbDelta) / 100);
    }

    // AG / CM 요율 변동(+% 또는 -%) 및 정액 가감 반영
    promoAgIncentive +=
      Math.round((basisAmt * agRateDelta) / 100) +
      Math.round(Number(p.agIncentiveAmount) || 0);
    promoCmIncentive +=
      Math.round((basisAmt * cmRateDelta) / 100) +
      Math.round(Number(p.cmIncentiveAmount) || 0);
  });

  return {
    promoCashbackDeltaAmount,
    promoCashbackRateDelta,
    promoInterestRateDelta,
    promoAgRateDelta,
    promoCmRateDelta,
    promoAgIncentive,
    promoCmIncentive,
  };
}

export function calcSplitTotals(
  splits: PaymentSplitItem[],
  appliedPromotions?: AppliedPromotionSnapshot[]
): {
  totalAmount: number;
  lumpSumAmount: number;
  installmentAmount: number;
  baseCashbackAmount: number;
  promoCashbackDeltaAmount: number;
  totalCashbackAmount: number;
  baseAgCommission: number;
  baseCmCommission: number;
  promoCashbackRateDelta: number;
  promoInterestRateDelta: number;
  promoAgRateDelta: number;
  promoCmRateDelta: number;
  promoAgIncentive: number;
  promoCmIncentive: number;
  totalAgCommission: number;
  totalCmCommission: number;
  effectiveCashbackRate: number;
  effectiveInterestRate: number;
  effectiveAgRate: number;
  effectiveCmRate: number;
  weightedCashbackRate: number;
  weightedAgRate: number;
  weightedCmRate: number;
} {
  let totalAmount = 0;
  let lumpSumAmount = 0;
  let installmentAmount = 0;
  let baseCashbackAmount = 0;
  let weightedInterestNumer = 0;
  let baseAgCommission = 0;
  let baseCmCommission = 0;

  splits.forEach((s) => {
    const amt = Number(s.amount) || 0;
    totalAmount += amt;
    if (s.paymentMethod === '일시불') {
      lumpSumAmount += amt;
      baseCashbackAmount += Math.round((amt * (Number(s.cashbackRate) || 0)) / 100);
    } else {
      installmentAmount += amt;
      weightedInterestNumer += amt * (Number(s.interestRate) || 0);
    }
    baseAgCommission += Math.round((amt * (Number(s.agCommissionRate) || 0)) / 100);
    baseCmCommission += Math.round((amt * (Number(s.cmCommissionRate) || 0)) / 100);
  });

  const {
    promoCashbackDeltaAmount,
    promoCashbackRateDelta,
    promoInterestRateDelta,
    promoAgRateDelta,
    promoCmRateDelta,
    promoAgIncentive,
    promoCmIncentive,
  } = calcPromotionIncentives(splits, appliedPromotions);

  const totalCashbackAmount = Math.max(0, baseCashbackAmount + promoCashbackDeltaAmount);
  const totalAgCommission = baseAgCommission + promoAgIncentive;
  const totalCmCommission = baseCmCommission + promoCmIncentive;

  const baseInterestRate =
    installmentAmount > 0
      ? Math.round((weightedInterestNumer / installmentAmount) * 100) / 100
      : 0;
  const effectiveInterestRate =
    installmentAmount > 0
      ? Math.max(0, Number((baseInterestRate + promoInterestRateDelta).toFixed(2)))
      : 0;

  const effectiveCashbackRate =
    totalAmount > 0 ? Math.round((totalCashbackAmount / totalAmount) * 10000) / 100 : 0;
  const effectiveAgRate =
    totalAmount > 0 ? Math.round((totalAgCommission / totalAmount) * 10000) / 100 : 0;
  const effectiveCmRate =
    totalAmount > 0 ? Math.round((totalCmCommission / totalAmount) * 10000) / 100 : 0;

  return {
    totalAmount,
    lumpSumAmount,
    installmentAmount,
    baseCashbackAmount,
    promoCashbackDeltaAmount,
    totalCashbackAmount,
    baseAgCommission,
    baseCmCommission,
    promoCashbackRateDelta,
    promoInterestRateDelta,
    promoAgRateDelta,
    promoCmRateDelta,
    promoAgIncentive,
    promoCmIncentive,
    totalAgCommission,
    totalCmCommission,
    effectiveCashbackRate,
    effectiveInterestRate,
    effectiveAgRate,
    effectiveCmRate,
    weightedCashbackRate: effectiveCashbackRate,
    weightedAgRate: effectiveAgRate,
    weightedCmRate: effectiveCmRate,
  };
}

/**
 * CM 수수료 금액 산출 (분할 결제 CM 수수료 + 적용된 프로모션 CM 인센티브 합산)
 */
export function calcExpectedCommission(tx: Transaction): number {
  const { promoCmIncentive } = calcPromotionIncentives(
    tx.paymentSplits || [],
    tx.appliedPromotions
  );
  if (tx.paymentSplits && tx.paymentSplits.length > 0) {
    const splitCm = tx.paymentSplits.reduce(
      (sum, s) =>
        sum +
        Math.round(((Number(s.amount) || 0) * (Number(s.cmCommissionRate) || 0)) / 100),
      0
    );
    return splitCm + promoCmIncentive;
  }
  const rate = tx.conditionSnapshot.cmCommissionRate;
  if (rate === null || rate === undefined) return promoCmIncentive;
  const base = tx.slip?.approvedAmount ?? tx.amount;
  return Math.round((base * rate) / 100) + promoCmIncentive;
}

/**
 * AG 수수료 금액 산출 (분할 결제 AG 수수료 + 적용된 프로모션 AG 인센티브 합산)
 */
export function calcExpectedAgCommission(tx: Transaction): number {
  const { promoAgIncentive } = calcPromotionIncentives(
    tx.paymentSplits || [],
    tx.appliedPromotions
  );
  if (tx.paymentSplits && tx.paymentSplits.length > 0) {
    const splitAg = tx.paymentSplits.reduce(
      (sum, s) =>
        sum +
        Math.round(((Number(s.amount) || 0) * (Number(s.agCommissionRate) || 0)) / 100),
      0
    );
    return splitAg + promoAgIncentive;
  }
  const rate = tx.conditionSnapshot.agCommissionRate ?? 0.35;
  const base = tx.slip?.approvedAmount ?? tx.amount;
  return Math.round((base * rate) / 100) + promoAgIncentive;
}

/**
 * 고객 캐시백 금액 산출 (일시불 분할 건만 캐시백 지급)
 */
export function calcExpectedCashback(tx: Transaction): number {
  const { promoCashbackDeltaAmount } = calcPromotionIncentives(
    tx.paymentSplits || [],
    tx.appliedPromotions
  );
  if (tx.paymentSplits && tx.paymentSplits.length > 0) {
    const baseCb = tx.paymentSplits.reduce((sum, s) => {
      if (s.paymentMethod !== '일시불') return sum;
      return sum + Math.round(((Number(s.amount) || 0) * (Number(s.cashbackRate) || 0)) / 100);
    }, 0);
    return Math.max(0, baseCb + promoCashbackDeltaAmount);
  }
  const base = tx.slip?.approvedAmount ?? tx.amount;
  return Math.max(
    0,
    Math.round((base * (tx.conditionSnapshot.customerCashbackRate || 0)) / 100) +
      promoCashbackDeltaAmount
  );
}

export function nowFormatted(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

