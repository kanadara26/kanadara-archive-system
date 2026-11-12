export type UserRole = 'CM' | 'AG' | 'ADMIN';

export interface User {
  id: string;
  loginId: string;
  password: string;
  name: string;
  role: UserRole;
  affiliation: string;
  phone: string;
  // CM 등록 시 저장하는 고유 정보 (AG 거래승인 요청 시 그대로 자동 연동)
  rrn?: string; // 주민등록번호
  businessNumber?: string; // 사업자등록번호
  employeeId?: string; // 사번
  isBusiness?: boolean; // 사업자 여부 (true: 사업자등록번호 / false: 주민등록번호)
  bankName?: string; // 계좌 은행
  bankAccount?: string; // 계좌번호
  isActive: boolean;
  createdAt: string;
}

export interface CmProfileSnapshot {
  cmId: string;
  name: string;
  rrn: string;
  businessNumber: string;
  phone: string;
  affiliation: string;
  employeeId: string;
  isBusiness?: boolean;
  bankName?: string;
  bankAccount?: string;
}

export interface AgCmAssignment {
  agId: string;
  cmId: string;
  updatedAt: string;
  updatedBy: string;
}

// AG 거래승인 요청 결제정보용 카드사 (국민, 농협, 롯데, 신한, 우리, 하나, 제휴카드사(삼성))
export type SplitCardCompany =
  | '국민'
  | '농협'
  | '롯데'
  | '신한'
  | '우리'
  | '하나'
  | '제휴카드사(삼성)';

export const SPLIT_CARD_COMPANIES: SplitCardCompany[] = [
  '국민',
  '농협',
  '롯데',
  '신한',
  '우리',
  '하나',
  '제휴카드사(삼성)',
];

// 카드사별 메인 컬러 설정
// [국민 : #faba07 / 농협 : #1fb25a / 롯데 : #e70012 / 신한 : #0046ff / 우리 : #0c73b8 / 하나 : #009591 / 제휴카드사 : #172a88]
export interface CardCompanyColorMeta {
  mainHex: string;
  badgeTextHex: string;
  softBgHex: string;
  softBorderHex: string;
  darkTextHex: string;
  shortName: string;
}

export const CARD_COMPANY_COLORS: Record<SplitCardCompany, CardCompanyColorMeta> = {
  국민: {
    mainHex: '#faba07',
    badgeTextHex: '#1e293b',
    softBgHex: '#fef9e7',
    softBorderHex: '#faba07',
    darkTextHex: '#8a6500',
    shortName: '국민',
  },
  농협: {
    mainHex: '#1fb25a',
    badgeTextHex: '#ffffff',
    softBgHex: '#eefbf3',
    softBorderHex: '#1fb25a',
    darkTextHex: '#137a3d',
    shortName: '농협',
  },
  롯데: {
    mainHex: '#e70012',
    badgeTextHex: '#ffffff',
    softBgHex: '#fff0f1',
    softBorderHex: '#e70012',
    darkTextHex: '#b3000e',
    shortName: '롯데',
  },
  신한: {
    mainHex: '#0046ff',
    badgeTextHex: '#ffffff',
    softBgHex: '#eef4ff',
    softBorderHex: '#0046ff',
    darkTextHex: '#0037c8',
    shortName: '신한',
  },
  우리: {
    mainHex: '#0c73b8',
    badgeTextHex: '#ffffff',
    softBgHex: '#eef7fc',
    softBorderHex: '#0c73b8',
    darkTextHex: '#085588',
    shortName: '우리',
  },
  하나: {
    mainHex: '#009591',
    badgeTextHex: '#ffffff',
    softBgHex: '#edfaf9',
    softBorderHex: '#009591',
    darkTextHex: '#006b68',
    shortName: '하나',
  },
  '제휴카드사(삼성)': {
    mainHex: '#172a88',
    badgeTextHex: '#ffffff',
    softBgHex: '#eff2fb',
    softBorderHex: '#172a88',
    darkTextHex: '#172a88',
    shortName: '제휴카드사(삼성)',
  },
};

// AG 거래승인 요청 결제방법 (일시불, 할부, 다이렉트할부, 다이렉트)
export type SplitPaymentMethod = '일시불' | '할부' | '다이렉트할부' | '다이렉트';

export const SPLIT_PAYMENT_METHODS: SplitPaymentMethod[] = [
  '일시불',
  '할부',
  '다이렉트할부',
  '다이렉트',
];

// 요율표/조건 구분(유형 옵션) 기본 추천 목록 (시트에서 자유롭게 커스텀 구분명 입력 가능)
export const DEFAULT_RATE_CATEGORIES: string[] = [
  '일반',
  '저금리',
  '고금리(고수수료)',
  '선입금(가상계좌)',
  '신용한도',
  '중도상환면제',
  '신규발급특판',
];

// 분할 결제 항목 (+ 버튼으로 일시불+할부 등 복합 분할 입력 및 별도 조건 입력 지원)
export interface PaymentSplitItem {
  id: string;
  cardCompany: SplitCardCompany;
  paymentMethod: SplitPaymentMethod;
  rateCategory?: string; // 구분 (예: '일반', '저금리', '선입금(가상계좌)', '신용한도', '특판' 등)
  amount: number; // 결제 금액 (원)
  installmentMonths: number; // 할부개월 (일시불 시 1달 고정)
  cashbackRate: number; // 고객 캐시백율 (%, 일시불일 시에만 지급, 할부 시 0)
  interestRate: number; // 할부 금리 (%, 할부/다이렉트할부일 때만 적용, 일시불 시 0)
  agCommissionRate: number; // AG측 수수료율 (%)
  cmCommissionRate: number; // CM측 수수료율 (%)
  customConditionNote?: string; // 별도 조건 메모
}

// 요율표 - 이미지 형식 항목 (Admin이 추가/관리)
export interface RateTableImageItem {
  id: string;
  title: string;
  cardCompanyTag: string;
  effectiveDate: string;
  imageUrl: string;
  note: string;
  uploadedBy: string;
  uploadedAt: string;
}

// 요율표 - 데이터 표 형식 항목 (Admin이 추가/수정/관리)
export interface RateTableRowItem {
  id: string;
  cardCompany: SplitCardCompany;
  paymentMethod: SplitPaymentMethod;
  category?: string; // 구분 (예: '일반', '저금리', '선입금(가상계좌)', '신용한도', '중도상환면제' 등)
  amountTier: string;
  installmentMonths: string;
  cashbackRate: number; // 일시불 캐시백 (%)
  interestRate: number; // 할부 금리 (%)
  agCommissionRate: number; // AG 수수료율 (%) — CM에게는 비노출
  cmCommissionRate: number; // CM 수수료율 (%)
  effectiveDate: string;
  remark: string;
}

// 카드사 별 프로모션 결제방법 (일시불, 할부, 다이렉트할부, 통합)
export type PromotionPaymentMethod = '일시불' | '할부' | '다이렉트할부' | '통합';

export const PROMOTION_PAYMENT_METHODS: PromotionPaymentMethod[] = [
  '일시불',
  '할부',
  '다이렉트할부',
  '통합',
];

// 카드사 별 프로모션 항목 (기간, 결제방법, 금액조건, 요율 가감[캐시백/금리/AG/CM ±% 마이너스 반영 가능], 인센티브 금액, 불릿포인트 조건 설명)
export interface CardPromotionItem {
  id: string;
  cardCompany: SplitCardCompany;
  title: string;
  startDate: string; // 시작일 (YYYY-MM-DD)
  endDate: string | null; // 마감일 (YYYY-MM-DD, 없을 시 null -> '계속 진행')
  paymentMethod: PromotionPaymentMethod; // 일시불, 할부, 다이렉트할부, 통합
  minAmount: number; // 금액조건 최소금액 (원)
  maxAmount: number | null; // 금액조건 최대금액 (원, 제한 없을 시 null)
  amountConditionLabel: string; // 금액조건 금액대 지정 라벨 (예: '3,000만원 이상 ~ 5,000만원 미만')
  cashbackRateDelta?: number; // 기존 캐시백 요율 가감 (% : + 또는 - 마이너스 반영 가능, 기본 0)
  interestRateDelta?: number; // 기존 할부 금리 가감 (% : + 또는 - 마이너스 반영 가능, 기본 0)
  agIncentiveRate: number; // 인센티브/조정 요율 - AG요율 (% : + 또는 - 마이너스 반영 가능)
  cmIncentiveRate: number; // 인센티브/조정 요율 - CM요율 (% : + 또는 - 마이너스 반영 가능)
  agIncentiveAmount: number; // 인센티브 금액 - 금액조건 별 AG 추가/차감 정액(원)
  cmIncentiveAmount: number; // 인센티브 금액 - 금액조건 별 CM 추가/차감 정액(원)
  promotionConditionText: string; // 프로모션 조건 (불릿포인트 식 장문 텍스트 설명)
  isActive: boolean;
  updatedAt: string;
}

// 거래 승인요청 등록 시 선택·적용된 프로모션 스냅샷
export interface AppliedPromotionSnapshot {
  promotionId: string;
  cardCompany: SplitCardCompany;
  title: string;
  startDate: string;
  endDate: string | null;
  paymentMethod: PromotionPaymentMethod;
  minAmount: number;
  maxAmount: number | null;
  amountConditionLabel: string;
  cashbackRateDelta?: number; // 기존 캐시백 요율 가감 (% : + 또는 - 마이너스 반영 가능)
  interestRateDelta?: number; // 기존 할부 금리 가감 (% : + 또는 - 마이너스 반영 가능)
  agIncentiveRate: number; // 기존 AG 요율 가감 (% : + 또는 - 마이너스 반영 가능)
  cmIncentiveRate: number; // 기존 CM 요율 가감 (% : + 또는 - 마이너스 반영 가능)
  agIncentiveAmount: number;
  cmIncentiveAmount: number;
  promotionConditionText: string;
}

export type CardCompany =
  | '삼성카드'
  | '현대카드'
  | '신한카드'
  | 'KB국민카드'
  | '우리카드'
  | '하나카드'
  | '롯데카드'
  | 'NH농협카드';

export type PaymentMethod =
  | '일시불 오토캐시백'
  | '선입금(가상계좌) 캐시백'
  | '신차 카드할부'
  | '법인카드 일시불'
  | '일시불+할부 복합결제';

export type ChannelType = 'AG다이렉트' | '카드사다이렉트' | '일반제휴' | '특판제휴';

export type CardKind =
  | '개인 신용'
  | '개인 체크·선입금'
  | '신규발급 전용'
  | '기명 법인'
  | '무기명 법인';

export type ConditionLifecycleStatus = 'ACTIVE_NOW' | 'SCHEDULED' | 'EXPIRED' | 'DISABLED';

export interface DealCondition {
  id: string;
  conditionGroupCode: string;
  versionNo: number;
  effectiveFrom: string;
  effectiveTo: string | null;
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
  agCommissionRate?: number;
  cmCommissionRate: number | null;
  description: string;
  isActive: boolean;
  sheetRowId?: string;
  lastSyncedAt?: string;
  updatedAt: string;
}

// 6단계 거래 상태 (요청대기 / 심사중 / 승인 / 반려 / 전표제출필요 / 거래완료)
export type ApprovalStatus =
  | 'WAITING'
  | 'REVIEWING'
  | 'APPROVED'
  | 'REJECTED'
  | 'SLIP_REQUIRED'
  | 'COMPLETED';

export const APPROVAL_STATUS_LIST: ApprovalStatus[] = [
  'WAITING',
  'REVIEWING',
  'APPROVED',
  'REJECTED',
  'SLIP_REQUIRED',
  'COMPLETED',
];

export type IdentifierType = 'CARD_NUMBER' | 'RRN';

export type CardApplicationStatus = 'NOT_APPLIED' | 'APPLIED' | 'DOC_REQUESTED';

export interface CardApplicationRecord {
  status: CardApplicationStatus;
  appliedAt?: string;
  handlerName?: string;
  referenceNo?: string;
  memo?: string;
}

export interface SlipSubmission {
  id: string;
  submittedBy: string;
  submittedByName: string;
  submittedAt: string;
  approvalNumber: string;
  approvedDate: string;
  approvedAmount: number;
  merchantName: string;
  fileName: string;
  fileSizeLabel: string;
  memo?: string;
}

export type SheetSyncStatus = 'NOT_SUBMITTED' | 'SYNCED' | 'FAILED';

export interface SheetRetryLog {
  id: string;
  attemptedAt: string;
  actorName: string;
  result: 'SUCCESS' | 'FAILED';
  message: string;
  externalRowId?: string;
}

export interface SheetSyncRecord {
  status: SheetSyncStatus;
  externalRowId?: string;
  sheetTabName?: string;
  lastAttemptAt?: string;
  attemptCount: number;
  errorCode?: string;
  errorReason?: string;
  idempotencyKey?: string;
  retryHistory: SheetRetryLog[];
}

export interface StatusHistoryItem {
  id: string;
  changedAt: string;
  actorId: string;
  actorName: string;
  actorRole: UserRole;
  previousStatus: ApprovalStatus | null;
  newStatus: ApprovalStatus;
  actionType:
    | 'REQUEST_CREATED'
    | 'REVIEW_STARTED'
    | 'CARD_APPLIED'
    | 'APPROVED'
    | 'REJECTED'
    | 'SLIP_REQUIRED_SET'
    | 'COMPLETED_SET'
    | 'SLIP_SUBMITTED'
    | 'SHEET_RETRIED'
    | 'COMMISSION_FIXED'
    | 'SPLITS_UPDATED';
  actionLabel: string;
  reasonOrNote?: string;
}

export interface ConditionSnapshot {
  conditionId: string;
  conditionGroupCode?: string;
  versionNo?: number;
  effectiveFrom?: string;
  channelType?: ChannelType;
  cardKind?: CardKind;
  installmentTerms?: string;
  downPaymentRule?: string;
  title: string;
  customerCashbackRate: number;
  agCommissionRate?: number;
  cmCommissionRate: number | null;
  description: string;
  appliedBasisNote?: string;
}

// 정산 완료(카드사 정산 안내)와 지급 완료(CM 실지급)는 따로 일어나므로 둘 다 켜질 수 있음 → '정산·지급 완료'
export type SettlementProgressStatus = '정산 대기' | '정산 완료' | '지급 완료(CM)' | '정산·지급 완료';

export type SettlementFlags = { settled: boolean; paid: boolean };

export function settlementFlagsOf(st?: SettlementProgressStatus): SettlementFlags {
  const s = st || '정산 대기';
  return {
    settled: s === '정산 완료' || s === '정산·지급 완료',
    paid: s === '지급 완료(CM)' || s === '정산·지급 완료',
  };
}

export function settlementFromFlags(f: SettlementFlags): SettlementProgressStatus {
  if (f.settled && f.paid) return '정산·지급 완료';
  if (f.settled) return '정산 완료';
  if (f.paid) return '지급 완료(CM)';
  return '정산 대기';
}

/** 진행상황/정산상황 변경 요청. settlement는 지정한 플래그만 바꿈 */
export interface StatusPatch {
  status?: ApprovalStatus;
  settlement?: Partial<SettlementFlags>;
}

// 되돌리기(진행 단계 하향 또는 정산 플래그 해제) 판단용 순위
const PROGRESS_RANK: Record<'WAITING' | 'APPROVED' | 'REJECTED', number> = {
  WAITING: 0,
  REJECTED: 1,
  APPROVED: 2,
};

/** 패치를 적용한 결과와, 그게 이전 단계로 되돌리는 변경인지 */
export function applyStatusPatch(
  tx: Pick<Transaction, 'status' | 'settlementStatus'>,
  patch: StatusPatch
): { status: ApprovalStatus; settlementStatus: SettlementProgressStatus; isRollback: boolean; changed: boolean } {
  const prevFlags = settlementFlagsOf(tx.settlementStatus);
  const status = patch.status ?? tx.status;
  const prevNorm = normalizeV2ProgressStatus(tx.status);
  const nextNorm = normalizeV2ProgressStatus(status);
  let flags: SettlementFlags = { ...prevFlags, ...patch.settlement };
  // 카드 승인으로 넘어가면 정산상황은 정산 대기부터 시작
  // 요청 대기로 되돌리면 정산상황도 정산 대기로 초기화
  if (nextNorm !== prevNorm && (nextNorm === 'APPROVED' || nextNorm === 'WAITING')) {
    flags = { settled: false, paid: false };
  }
  const isRollback =
    (patch.status !== undefined && PROGRESS_RANK[nextNorm] < PROGRESS_RANK[prevNorm]) ||
    (patch.settlement !== undefined &&
      ((prevFlags.settled && !flags.settled) || (prevFlags.paid && !flags.paid)));
  const settlementStatus = settlementFromFlags(flags);
  return {
    status,
    settlementStatus,
    isRollback,
    changed: nextNorm !== prevNorm || settlementStatus !== (tx.settlementStatus || '정산 대기'),
  };
}

export interface RollbackRequest {
  requestedAt: string;
  requestedById: string;
  requestedByName: string;
  reason: string;
  patch: StatusPatch;
  summary: string; // 예: '진행상황: 카드 승인 → 요청 대기'
}

export const SETTLEMENT_PROGRESS_STATUS_LIST: SettlementProgressStatus[] = [
  '정산 대기',
  '정산 완료',
  '지급 완료(CM)',
];

export const SETTLEMENT_PROGRESS_STATUS_META: Record<
  SettlementProgressStatus,
  { label: string; badgeClass: string; dotClass: string }
> = {
  '정산 대기': {
    label: '정산 대기',
    badgeClass: 'bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-300',
    dotClass: 'bg-slate-400',
  },
  '정산 완료': {
    label: '정산 완료',
    badgeClass: 'bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-600/25',
    dotClass: 'bg-sky-500',
  },
  '지급 완료(CM)': {
    label: '지급 완료(CM)',
    badgeClass: 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/25',
    dotClass: 'bg-emerald-500',
  },
  '정산·지급 완료': {
    label: '정산·지급 완료',
    badgeClass: 'bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-600/40',
    dotClass: 'bg-emerald-600',
  },
};

export interface Transaction {
  id: string;
  cmId: string;
  agId: string;
  customerName: string;
  requestDate: string; // 요청일자 (YYYY-MM-DD)
  approvalDate: string; // 승인일자 / 상태변경일 (YYYY-MM-DD, 미승인 시 공백 '')
  cmProfile: CmProfileSnapshot; // CM 등록 데이터 자동 연동 스냅샷
  paymentSplits: PaymentSplitItem[]; // 분할 결제 상세 (+ 버튼으로 분할 입력, 동일 카드사 고정)
  appliedPromotions?: AppliedPromotionSnapshot[]; // 거래 승인요청 단계에서 선택 적용한 카드사 프로모션 목록
  vehicleInfo: string;
  identifierType: IdentifierType;
  maskedIdentifier: string;
  agVerifyIdentifier: string;
  cardCompany: CardCompany;
  paymentMethod: PaymentMethod;
  amount: number;
  conditionSnapshot: ConditionSnapshot;
  requestMemo?: string; // 비고 (기존 메모)
  status: ApprovalStatus; // 진행상황
  settlementStatus?: SettlementProgressStatus; // 정산상황 (정산 대기 / 정산 완료 / 지급 완료(CM))
  rejectionReason?: string;
  rollbackRequest?: RollbackRequest; // AG가 신청한 되돌리기 (ADMIN 승인 대기)
  cardApplication: CardApplicationRecord;
  slip?: SlipSubmission;
  sheetSync: SheetSyncRecord;
  history: StatusHistoryItem[];
  createdAt: string;
  updatedAt: string;
}

export interface ConditionSheetSyncLog {
  id: string;
  syncedAt: string;
  actorName: string;
  sourceLabel: string;
  addedCount: number;
  updatedCount: number;
  summary: string;
}

export const CARD_COMPANIES: CardCompany[] = [
  '삼성카드',
  '현대카드',
  '신한카드',
  'KB국민카드',
  '우리카드',
  '하나카드',
  '롯데카드',
  'NH농협카드',
];

export const PAYMENT_METHODS: PaymentMethod[] = [
  '일시불 오토캐시백',
  '선입금(가상계좌) 캐시백',
  '신차 카드할부',
  '법인카드 일시불',
  '일시불+할부 복합결제',
];

export const CHANNEL_TYPES: ChannelType[] = [
  'AG다이렉트',
  '카드사다이렉트',
  '일반제휴',
  '특판제휴',
];

export const CARD_KINDS: CardKind[] = [
  '개인 신용',
  '개인 체크·선입금',
  '신규발급 전용',
  '기명 법인',
  '무기명 법인',
];

export const APPROVAL_STATUS_META: Record<
  ApprovalStatus,
  { label: string; badgeClass: string; dotClass: string; description: string }
> = {
  WAITING: {
    label: '요청 대기',
    badgeClass: 'bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-600/25',
    dotClass: 'bg-amber-500',
    description: 'AG가 거래 승인 요청을 등록하여 카드사 심사 대기 중인 상태',
  },
  REVIEWING: {
    label: '요청 대기',
    badgeClass: 'bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-600/25',
    dotClass: 'bg-amber-500',
    description: '카드사 한도 및 할부·일시불 조건을 심사 중인 상태',
  },
  APPROVED: {
    label: '카드 승인',
    badgeClass: 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/25',
    dotClass: 'bg-emerald-500',
    description: '카드사 거래 승인이 완료된 상태',
  },
  REJECTED: {
    label: '반려',
    badgeClass: 'bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-600/25',
    dotClass: 'bg-rose-500',
    description: '한도 부족·조건 불일치 등의 사유로 반려된 상태',
  },
  SLIP_REQUIRED: {
    label: '카드 승인',
    badgeClass: 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/25',
    dotClass: 'bg-emerald-500',
    description: '승인 후 결제가 진행되어 매출전표 확인 및 제출이 필요한 상태',
  },
  COMPLETED: {
    label: '카드 승인',
    badgeClass: 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/25',
    dotClass: 'bg-emerald-500',
    description: '전표 확인 및 시트 반영까지 모두 마무리된 거래완료 상태',
  },
};

export const V2_PROGRESS_STATUS_LIST: ('WAITING' | 'APPROVED' | 'REJECTED')[] = [
  'WAITING',
  'APPROVED',
  'REJECTED',
];

export function normalizeV2ProgressStatus(
  status: ApprovalStatus
): 'WAITING' | 'APPROVED' | 'REJECTED' {
  if (status === 'REJECTED') return 'REJECTED';
  if (status === 'APPROVED' || status === 'SLIP_REQUIRED' || status === 'COMPLETED') {
    return 'APPROVED';
  }
  return 'WAITING';
}

export const ROLE_META: Record<
  UserRole,
  { label: string; shortLabel: string; badgeClass: string }
> = {
  CM: {
    label: 'CM (카마스터)',
    shortLabel: 'CM',
    badgeClass: 'bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-600/20',
  },
  AG: {
    label: 'AG (본사·에이전트)',
    shortLabel: 'AG',
    badgeClass: 'bg-indigo-50 text-indigo-700 ring-1 ring-inset ring-indigo-600/20',
  },
  ADMIN: {
    label: '운영 관리자',
    shortLabel: '관리자',
    badgeClass: 'bg-purple-50 text-purple-700 ring-1 ring-inset ring-purple-600/20',
  },
};

// ============================================================================
// Ver 2 (AG 간소화 모드) 전용 타입 및 상수
// ============================================================================
export const V2_CARD_DISPLAY_NAMES: Record<SplitCardCompany, string> = {
  국민: '국민카드',
  농협: '농협카드',
  롯데: '롯데카드',
  신한: '신한카드',
  우리: '우리카드',
  하나: '하나카드',
  '제휴카드사(삼성)': '제휴카드',
};

export const CARD_LOGO_URLS: Record<string, string> = {
  국민: '/logos/kb.png',
  농협: '/logos/nh.png',
  롯데: '/logos/lotte.png',
  신한: '/logos/shinhan.png',
  우리: '/logos/woori.png',
  하나: '/logos/hana.png',
  삼성: '/logos/samsung.png',
  '제휴카드사(삼성)': '/logos/samsung.png',
};

export const V2_CARD_LOGO_URLS: Record<SplitCardCompany, string> = {
  국민: '/logos/kb.png',
  농협: '/logos/nh.png',
  롯데: '/logos/lotte.png',
  신한: '/logos/shinhan.png',
  우리: '/logos/woori.png',
  하나: '/logos/hana.png',
  '제휴카드사(삼성)': '/logos/samsung.png',
};

export type V2PaymentMethodType = '일시불' | '혼합' | '다이렉트' | '할부';

export const V2_PAYMENT_METHODS: {
  key: V2PaymentMethodType;
  label: string;
  desc: string;
}[] = [
  { key: '일시불', label: '일시불', desc: '1개월 일시불 오토캐시백 결제' },
  { key: '혼합', label: '혼합', desc: '일시불 + 할부/다이렉트 복합 결제' },
  { key: '다이렉트', label: '다이렉트', desc: '모바일 약정 다이렉트 할부 결제' },
  { key: '할부', label: '할부', desc: '일반 신차 카드할부 결제' },
];

export interface TransactionDraftV2 {
  id: string;
  savedAt: string;
  title: string;
  activeStep: 1 | 2 | 3 | 4;
  cardCompany: SplitCardCompany | null;
  paymentMethodType: V2PaymentMethodType | null;
  requestDate: string;
  approvalDate: string;
  paymentSplits: PaymentSplitItem[];
  appliedPromotions?: AppliedPromotionSnapshot[];
  customerName: string;
  cmId: string;
  requestMemo: string;
}

