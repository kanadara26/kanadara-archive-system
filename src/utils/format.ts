import {
  AppliedPromotionSnapshot,
  CARD_COMPANIES,
  CARD_KINDS,
  CHANNEL_TYPES,
  CardCompany,
  CardKind,
  ChannelType,
  ConditionLifecycleStatus,
  DealCondition,
  IdentifierType,
  PAYMENT_METHODS,
  PaymentMethod,
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

export function formatManwonRange(minAmount: number, maxAmount?: number | null): string {
  const minMan = Math.round(minAmount / 10000).toLocaleString('ko-KR');
  if (!maxAmount || maxAmount <= 0) {
    return `${minMan}만원 이상`;
  }
  const maxMan = Math.round(maxAmount / 10000).toLocaleString('ko-KR');
  return `${minMan}만 ~ ${maxMan}만원`;
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

export function formatDateTime(isoOrStr?: string): string {
  if (!isoOrStr) return '-';
  if (isoOrStr.includes('T')) {
    const d = new Date(isoOrStr);
    if (Number.isNaN(d.getTime())) return isoOrStr;
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
  }
  return isoOrStr;
}

export function formatDateOnly(isoOrStr?: string): string {
  if (!isoOrStr) return '-';
  return formatDateTime(isoOrStr).slice(0, 10);
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

export function subtractOneDay(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return dateStr;
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - 1);
  const yyyy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function getConditionLifecycleStatus(
  cond: DealCondition,
  referenceDate: string
): ConditionLifecycleStatus {
  if (!cond.isActive) return 'DISABLED';
  if (cond.effectiveFrom > referenceDate) return 'SCHEDULED';
  if (cond.effectiveTo && cond.effectiveTo < referenceDate) return 'EXPIRED';
  return 'ACTIVE_NOW';
}

export function reconcileConditionGroupDates(list: DealCondition[]): DealCondition[] {
  const cloned = list.map((c) => ({ ...c }));
  const groups = new Map<string, DealCondition[]>();

  cloned.forEach((c) => {
    if (!c.isActive) return;
    const key = c.conditionGroupCode.trim();
    const arr = groups.get(key) ?? [];
    arr.push(c);
    groups.set(key, arr);
  });

  groups.forEach((arr) => {
    arr.sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom) || a.versionNo - b.versionNo);
    for (let i = 0; i < arr.length; i++) {
      const current = arr[i];
      const next = arr[i + 1];
      if (next) {
        current.effectiveTo = subtractOneDay(next.effectiveFrom);
      } else if (current.effectiveTo && current.effectiveTo < current.effectiveFrom) {
        current.effectiveTo = null;
      }
    }
  });

  return cloned;
}

export function maskCustomerNameInList(name: string): string {
  if (!name) return '-';
  if (name.length <= 1) return name;
  if (name.length === 2) return `${name[0]}*`;
  return `${name[0]}${'*'.repeat(name.length - 2)}${name[name.length - 1]}`;
}

export function validateAndMaskIdentifier(
  type: IdentifierType,
  rawInput: string
): {
  valid: boolean;
  error?: string;
  maskedIdentifier?: string;
  agVerifyIdentifier?: string;
} {
  const digits = rawInput.replace(/\D/g, '');
  if (type === 'CARD_NUMBER') {
    if (digits.length < 15 || digits.length > 16) {
      return {
        valid: false,
        error: '카드번호는 숫자 15~16자리로 입력해 주세요. (예: 9410-1234-5678-3821)',
      };
    }
    const first4 = digits.slice(0, 4);
    const mid2 = digits.slice(4, 6);
    const last4 = digits.slice(-4);
    return {
      valid: true,
      maskedIdentifier: `${first4}-****-****-${last4}`,
      agVerifyIdentifier: `${first4}-${mid2}**-****-${last4}`,
    };
  } else {
    if (digits.length !== 13) {
      return {
        valid: false,
        error: '주민등록번호는 생년월일 6자리와 뒷자리 7자리를 포함한 숫자 13자리로 입력해 주세요.',
      };
    }
    const front = digits.slice(0, 6);
    const genderDigit = digits.slice(6, 7);
    const regionDigit = digits.slice(7, 8);
    if (!['1', '2', '3', '4', '5', '6', '7', '8'].includes(genderDigit)) {
      return {
        valid: false,
        error: '주민등록번호 뒷자리 첫 번째 숫자(성별/내외국인 코드) 형식이 올바르지 않습니다.',
      };
    }
    return {
      valid: true,
      maskedIdentifier: `${front}-${genderDigit}******`,
      agVerifyIdentifier: `${front}-${genderDigit}${regionDigit}*****`,
    };
  }
}

export function formatRawIdentifierInput(type: IdentifierType, rawInput: string): string {
  const digits = rawInput.replace(/\D/g, '');
  if (type === 'CARD_NUMBER') {
    const trimmed = digits.slice(0, 16);
    const groups = trimmed.match(/.{1,4}/g);
    return groups ? groups.join('-') : '';
  } else {
    const trimmed = digits.slice(0, 13);
    if (trimmed.length <= 6) return trimmed;
    return `${trimmed.slice(0, 6)}-${trimmed.slice(6)}`;
  }
}

export function downloadCsvFile(filename: string, rows: string[][]): void {
  const escapeCell = (cell: string) => {
    const safe = String(cell ?? '').replace(/"/g, '""');
    return `"${safe}"`;
  };
  const csvBody = rows.map((row) => row.map(escapeCell).join(',')).join('\r\n');
  const blob = new Blob(['\uFEFF' + csvBody], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export interface ParsedSheetConditionRow {
  conditionGroupCode: string;
  versionNo: number;
  effectiveFrom: string;
  cardCompany: CardCompany;
  paymentMethod: PaymentMethod;
  channelType: ChannelType;
  cardKind: CardKind;
  installmentTerms: string;
  downPaymentRule: string;
  minAmount: number;
  maxAmount: number | null;
  title: string;
  customerCashbackRate: number;
  cmCommissionRate: number | null;
  description: string;
  isActive: boolean;
  sheetRowId?: string;
}

export function parseSheetTextToConditions(rawText: string): {
  ok: boolean;
  rows: ParsedSheetConditionRow[];
  errors: string[];
} {
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return { ok: false, rows: [], errors: ['붙여넣은 시트 데이터가 비어 있습니다.'] };
  }

  const rows: ParsedSheetConditionRow[] = [];
  const errors: string[] = [];

  lines.forEach((line, idx) => {
    const delimiter = line.includes('\t') ? '\t' : ',';
    const cols = line
      .split(delimiter)
      .map((c) => c.trim().replace(/^"(.*)"$/, '$1').replace(/""/g, '"'));

    if (
      idx === 0 &&
      (cols[0]?.includes('시트행') ||
        cols[1]?.includes('그룹코드') ||
        cols[3]?.includes('실행일'))
    ) {
      return;
    }

    if (cols.length < 14) {
      errors.push(`${idx + 1}행: 컬럼 수가 부족합니다 (최소 14열 필요, 현재 ${cols.length}열).`);
      return;
    }

    const [
      sheetRowId,
      conditionGroupCode,
      versionStr,
      effectiveFrom,
      cardCompanyRaw,
      paymentMethodRaw,
      channelTypeRaw,
      cardKindRaw,
      minAmountRaw,
      maxAmountRaw,
      downPaymentRule,
      installmentTerms,
      title,
      cashbackRaw,
      cmCommRaw,
      description,
    ] = cols;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) {
      errors.push(`${idx + 1}행: 실행일자(${effectiveFrom})는 YYYY-MM-DD 형식이어야 합니다.`);
      return;
    }

    const cardCompany = CARD_COMPANIES.find((c) => c === cardCompanyRaw);
    if (!cardCompany) {
      errors.push(`${idx + 1}행: 지원하지 않는 카드사명(${cardCompanyRaw})입니다.`);
      return;
    }

    const paymentMethod = PAYMENT_METHODS.find((m) => m === paymentMethodRaw);
    if (!paymentMethod) {
      errors.push(`${idx + 1}행: 지원하지 않는 거래방법(${paymentMethodRaw})입니다.`);
      return;
    }

    const channelType: ChannelType =
      CHANNEL_TYPES.find((ch) => ch === channelTypeRaw) ?? 'AG다이렉트';
    const cardKind: CardKind = CARD_KINDS.find((ck) => ck === cardKindRaw) ?? '개인 신용';

    const minAmount = Number((minAmountRaw || '0').replace(/[^\d]/g, '')) || 0;
    const maxClean = (maxAmountRaw || '').replace(/[^\d]/g, '');
    const maxAmount = maxClean ? Number(maxClean) : null;

    const customerCashbackRate = Number(cashbackRaw);
    if (Number.isNaN(customerCashbackRate)) {
      errors.push(`${idx + 1}행: 고객 캐시백율(${cashbackRaw})이 숫자가 아닙니다.`);
      return;
    }

    const cmCommissionRate =
      cmCommRaw && cmCommRaw.trim() !== '' && cmCommRaw.trim() !== '-'
        ? Number(cmCommRaw)
        : null;

    rows.push({
      sheetRowId: sheetRowId || undefined,
      conditionGroupCode:
        conditionGroupCode || `${cardCompany.slice(0, 2)}-${Date.now()}-${idx}`,
      versionNo: Number(versionStr) || 1,
      effectiveFrom,
      cardCompany,
      paymentMethod,
      channelType,
      cardKind,
      minAmount,
      maxAmount,
      downPaymentRule: downPaymentRule || '제한 없음',
      installmentTerms: installmentTerms || '일시불',
      title: title || `${cardCompany} ${paymentMethod} (${effectiveFrom} 실행)`,
      customerCashbackRate,
      cmCommissionRate:
        cmCommissionRate !== null && !Number.isNaN(cmCommissionRate) ? cmCommissionRate : null,
      description: description || `${effectiveFrom} 실행 시트 연동 조건`,
      isActive: true,
    });
  });

  return { ok: errors.length === 0 && rows.length > 0, rows, errors };
}

export function parseUsersFromTsv(rawTsv: string): {
  users: Array<{
    id: string;
    role: 'ADMIN' | 'AG' | 'CM';
    name: string;
    loginId: string;
    password?: string;
    affiliation: string;
    phone: string;
    businessNumber?: string;
    rrn?: string;
    employeeId?: string;
    isActive: boolean;
    createdAt?: string;
  }>;
} {
  const lines = rawTsv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const users: Array<{
    id: string;
    role: 'ADMIN' | 'AG' | 'CM';
    name: string;
    loginId: string;
    password?: string;
    affiliation: string;
    phone: string;
    businessNumber?: string;
    rrn?: string;
    employeeId?: string;
    isActive: boolean;
    createdAt?: string;
  }> = [];

  for (const line of lines) {
    const cols = line.split('\t');
    const first = (cols[0] || '').trim();
    if (first === '사용자ID' || first.toLowerCase() === 'id') continue;
    const id = first;
    const roleRaw = (cols[1] || '').trim().toUpperCase();
    const name = (cols[2] || '').trim();
    const loginId = (cols[3] || '').trim();
    if (!id || !name || !loginId) continue;
    const role = (roleRaw === 'ADMIN' ? 'ADMIN' : roleRaw === 'AG' ? 'AG' : 'CM') as 'ADMIN' | 'AG' | 'CM';
    const password = (cols[4] || 'password123').trim();
    const affiliation = (cols[5] || '').trim();
    const phone = (cols[6] || '').trim();
    const businessNumber = (cols[7] || '').trim() || undefined;
    const rrn = (cols[8] || '').trim() || undefined;
    const employeeId = (cols[9] || '').trim() || undefined;
    const activeStr = (cols[10] || '').trim().toUpperCase();
    const isActive = activeStr !== 'N' && activeStr !== 'FALSE' && activeStr !== '0';
    const createdAt = (cols[11] || '').trim() || undefined;

    users.push({
      id,
      role,
      name,
      loginId,
      password,
      affiliation,
      phone,
      businessNumber,
      rrn,
      employeeId,
      isActive,
      createdAt,
    });
  }

  return { users };
}

