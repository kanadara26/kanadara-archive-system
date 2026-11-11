import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  AgCmAssignment,
  AppliedPromotionSnapshot,
  APPROVAL_STATUS_META,
  ApprovalStatus,
  CardApplicationRecord,
  CardCompany,
  CardKind,
  CardPromotionItem,
  ChannelType,
  CmProfileSnapshot,
  ConditionSheetSyncLog,
  ConditionSnapshot,
  DealCondition,
  IdentifierType,
  normalizeV2ProgressStatus,
  PaymentMethod,
  PaymentSplitItem,
  RateTableImageItem,
  RateTableRowItem,
  SettlementProgressStatus,
  Transaction,
  TransactionDraftV2,
  User,
  UserRole,
} from '../types';
import {
  INITIAL_ASSIGNMENTS,
  INITIAL_CARD_PROMOTIONS,
  INITIAL_CONDITIONS,
  INITIAL_CONDITION_SYNC_LOGS,
  INITIAL_RATE_TABLE_IMAGES,
  INITIAL_RATE_TABLE_ROWS,
  INITIAL_TRANSACTIONS,
  INITIAL_USERS,
} from '../data/mockData';
import {
  calcSplitTotals,
  getConditionLifecycleStatus,
  mapSplitCardToCardCompany,
  nowFormatted,
  ParsedSheetConditionRow,
  parseUsersFromTsv,
  reconcileConditionGroupDates,
  validateAndMaskIdentifier,
} from '../utils/format';
import {
  GOOGLE_MASTER_SPREADSHEET_ID,
  GOOGLE_MASTER_SPREADSHEET_TITLE,
  GOOGLE_SHEET_TABS,
  buildMasterBatchOps,
  parsePromotionsFromTsv,
  parseRateTableFromTsv,
  parseTransactionsFrom2D,
  parseUsersFrom2D,
  rows2DToTsv,
} from '../constants/googleSheetConfig';

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info';
  title: string;
  description?: string;
}

export interface RegisterTransactionInput {
  customerName: string;
  vehicleInfo: string;
  identifierType: IdentifierType;
  rawIdentifier: string;
  cardCompany: CardCompany;
  paymentMethod: PaymentMethod;
  conditionId: string;
  amount: number;
  requestMemo?: string;
}

export interface SaveAgTransactionInput {
  txId?: string;
  customerName: string;
  requestDate: string;
  status: ApprovalStatus;
  settlementStatus?: SettlementProgressStatus;
  approvalDate: string;
  cmId: string;
  paymentSplits: PaymentSplitItem[];
  appliedPromotions?: AppliedPromotionSnapshot[];
  vehicleInfo?: string;
  requestMemo?: string;
  rejectionReason?: string;
}

export interface SubmitSlipInput {
  approvalNumber: string;
  approvedDate: string;
  approvedAmount: number;
  merchantName: string;
  fileName: string;
  fileSizeLabel: string;
  memo?: string;
  simulateResult?: 'SUCCESS' | 'AUTH_EXPIRED' | 'API_TIMEOUT';
}

export interface SaveUserInput {
  id?: string;
  loginId: string;
  password?: string;
  name: string;
  role: UserRole;
  affiliation: string;
  phone: string;
  rrn?: string;
  businessNumber?: string;
  employeeId?: string;
  isActive: boolean;
}

export interface SaveConditionInput {
  id?: string;
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
  cmCommissionRate: number | null;
  description: string;
  isActive: boolean;
}

interface ActionResult {
  ok: boolean;
  message: string;
  transactionId?: string;
}

interface AppContextValue {
  currentUser: User | null;
  users: User[];
  assignments: AgCmAssignment[];
  conditions: DealCondition[];
  conditionSyncLogs: ConditionSheetSyncLog[];
  transactions: Transaction[];
  rateTableImages: RateTableImageItem[];
  rateTableRows: RateTableRowItem[];
  cardPromotions: CardPromotionItem[];
  isRateTableSplitOpen: boolean;
  setRateTableSplitOpen: (open: boolean) => void;
  toggleRateTableSplit: () => void;
  systemReferenceDate: string; // 'YYYY-MM-DD' 기준일 (실행일자 판별 및 거래승인 기준일)
  setSystemReferenceDate: (date: string) => void;
  toasts: ToastMessage[];
  pushToast: (toast: Omit<ToastMessage, 'id'>) => void;
  dismissToast: (id: string) => void;

  // Auth
  login: (loginId: string, password: string) => Promise<ActionResult>;
  isAuthReady: boolean;
  quickSwitchUser: (userId: string) => void;
  logout: () => Promise<void>;

  // Access & relation helpers
  getUserById: (id: string) => User | undefined;
  getAssignedAgForCm: (cmId: string) => User | undefined;
  getAssignedCmsForAg: (agId: string) => User[];
  canAccessTransaction: (tx: Transaction, user?: User | null) => boolean;
  canManageApprovalOf: (tx: Transaction, user?: User | null) => boolean;
  accessibleTransactions: Transaction[];
  getEffectiveConditionForGroup: (
    conditionGroupCode?: string,
    targetDate?: string
  ) => DealCondition | undefined;
  getScheduledNextConditionForGroup: (
    conditionGroupCode?: string,
    targetDate?: string
  ) => DealCondition | undefined;

  // AG Transaction Request & Status Management
  saveAgTransactionRequest: (input: SaveAgTransactionInput) => ActionResult;
  quickChangeTransactionStatus: (
    txId: string,
    newStatus: ApprovalStatus,
    approvalDateOverride?: string,
    reasonOrNote?: string
  ) => ActionResult;
  quickChangeTransactionSettlementStatus: (
    txId: string,
    newSettlementStatus: SettlementProgressStatus
  ) => ActionResult;
  bulkUpdateTransactionsV2: (
    txIds: string[],
    patch: {
      status?: ApprovalStatus;
      settlementStatus?: SettlementProgressStatus;
    }
  ) => ActionResult;

  // Legacy / Detail actions
  registerTransaction: (input: RegisterTransactionInput) => ActionResult;
  submitSlip: (txId: string, input: SubmitSlipInput) => ActionResult;
  startReview: (txId: string) => ActionResult;
  recordCardApplication: (txId: string, record: CardApplicationRecord) => ActionResult;
  decideApproval: (
    txId: string,
    decision: 'APPROVED' | 'REJECTED',
    reasonOrNote: string,
    approvalDateOverride?: string
  ) => ActionResult;

  // Google Sheets retry & commission fix
  retrySheetSync: (txId: string) => ActionResult;
  fixTransactionCommissionRate: (
    txId: string,
    commissionRate: number,
    note?: string
  ) => ActionResult;

  // Rate Table (이미지 / 데이터 표) & Card Promotions Admin management
  addRateTableImage: (
    input: Omit<RateTableImageItem, 'id' | 'uploadedBy' | 'uploadedAt'>
  ) => ActionResult;
  deleteRateTableImage: (id: string) => ActionResult;
  saveRateTableRow: (
    input: Omit<RateTableRowItem, 'id'> & { id?: string }
  ) => ActionResult;
  deleteRateTableRow: (id: string) => ActionResult;
  saveCardPromotion: (
    input: Omit<CardPromotionItem, 'id' | 'updatedAt'> & { id?: string }
  ) => ActionResult;
  deleteCardPromotion: (id: string) => ActionResult;

  // Admin / Operations & Condition Sheet Sync actions
  saveUserAccount: (input: SaveUserInput) => ActionResult;
  deleteUserAccount: (userId: string) => ActionResult;
  saveAgAssignments: (agId: string, cmIds: string[]) => ActionResult;
  saveDealCondition: (input: SaveConditionInput) => ActionResult;
  toggleConditionActive: (conditionId: string) => ActionResult;
  syncConditionsFromSheet: (
    rows: ParsedSheetConditionRow[],
    sourceLabel: string
  ) => ActionResult;

  // Google Sheet Master (05_요율표_마스터 / 06_프로모션_마스터 / 07_거래내역_통합마스터 / 08_분할결제_상세행_DB) 연동
  lastMasterSheetSyncedAt: string;
  isSyncingMasterSheet: boolean;
  isSheetReady: boolean;
  pushAllMasterTabsToGoogleSheet: (
    scopeLabel?: string,
    explicitUsers?: User[],
    explicitTransactions?: Transaction[],
    explicitRateRows?: RateTableRowItem[],
    explicitPromotions?: CardPromotionItem[]
  ) => Promise<ActionResult>;
  pullRateAndPromotionsFromGoogleSheet: (silent?: boolean) => Promise<ActionResult>;
  importRateTableRowsFromSheetTsv: (
    rawTsv: string,
    mode: 'MERGE' | 'REPLACE'
  ) => ActionResult;
  importPromotionsFromSheetTsv: (
    rawTsv: string,
    mode: 'MERGE' | 'REPLACE'
  ) => ActionResult;

  // Ver 2 (AG 간소화 모드) 전용 상태 및 액션
  appVersion: 'v1' | 'v2';
  setAppVersion: (ver: 'v1' | 'v2') => void;
  draftsV2: TransactionDraftV2[];
  saveDraftV2: (
    draft: Omit<TransactionDraftV2, 'id' | 'savedAt'> & { id?: string }
  ) => TransactionDraftV2;
  deleteDraftV2: (id: string) => void;
  editingTxIdV2: string | null;
  setEditingTxIdV2: (id: string | null) => void;
  pendingDraftIdV2: string | null;
  setPendingDraftIdV2: (id: string | null) => void;
  deleteTransaction: (txId: string) => ActionResult;

  resetDemoData: () => void;
}

const DEFAULT_REFERENCE_DATE = '2026-11-02';

const STORAGE_KEYS = {
  CURRENT_USER_ID: 'kanadara_v6_session_user_id',
  USERS: 'kanadara_v6_users',
  ASSIGNMENTS: 'kanadara_v6_assignments',
  CONDITIONS: 'kanadara_v5_conditions',
  CONDITION_SYNC_LOGS: 'kanadara_v5_condition_sync_logs',
  TRANSACTIONS: 'kanadara_v6_transactions',
  RATE_IMAGES: 'kanadara_v5_rate_images',
  RATE_ROWS: 'kanadara_v5_rate_rows',
  CARD_PROMOS: 'kanadara_v5_card_promos',
  REF_DATE: 'kanadara_v5_ref_date',
  APP_VERSION: 'kanadara_v5_app_version',
  DRAFTS_V2: 'kanadara_v6_drafts_v2',
};

// 이전 버전의 더미 데이터가 남아있는 경우 자동 정리
try {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.removeItem('kanadara_v5_transactions');
    window.localStorage.removeItem('kanadara_v5_drafts_v2');
    window.localStorage.removeItem('kanadara_v5_assignments');
    window.localStorage.removeItem('kanadara_v5_users');
    window.localStorage.removeItem('kanadara_gsheets_webhook_url');
    window.localStorage.removeItem(STORAGE_KEYS.USERS);
  }
} catch {}

const AppContext = createContext<AppContextValue | undefined>(undefined);

function loadStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function getTodayDateStr(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function normalizeStoredTransactions(list: Transaction[]): Transaction[] {
  return list.map((tx) => {
    const rawStatus = tx.status;
    const normalizedStatus = normalizeV2ProgressStatus(rawStatus);
    const settlementStatus: SettlementProgressStatus =
      tx.settlementStatus ||
      (rawStatus === 'COMPLETED' ? '지급 완료(CM)' : '정산 대기');
    const approvalDate =
      normalizedStatus === 'APPROVED' ? tx.approvalDate || tx.requestDate : '';
    return {
      ...tx,
      status: normalizedStatus,
      settlementStatus,
      approvalDate,
    };
  });
}

function buildCmSnapshotFromUser(cmUser: User): CmProfileSnapshot {
  return {
    cmId: cmUser.id,
    name: cmUser.name,
    rrn: cmUser.rrn || '880101-1234567',
    businessNumber: cmUser.businessNumber || '214-88-00192',
    phone: cmUser.phone || '010-0000-0000',
    affiliation: cmUser.affiliation || '제휴 대리점',
    employeeId: cmUser.employeeId || 'CM-0001',
  };
}

const DUMMY_CLEAN_FLAG = 'kanadara_v2_clean_dummy_20261110';
if (typeof window !== 'undefined') {
  try {
    if (!localStorage.getItem(DUMMY_CLEAN_FLAG)) {
      localStorage.removeItem(STORAGE_KEYS.TRANSACTIONS);
      localStorage.removeItem(STORAGE_KEYS.USERS);
      localStorage.removeItem(STORAGE_KEYS.ASSIGNMENTS);
      localStorage.removeItem(STORAGE_KEYS.RATE_ROWS);
      localStorage.setItem(DUMMY_CLEAN_FLAG, 'true');
    }
  } catch {
    // ignore
  }
}

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [appVersion, setAppVersionState] = useState<'v1' | 'v2'>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.APP_VERSION);
    return saved === 'v1' ? 'v1' : 'v2';
  });
  // 계정 목록은 로그인 후 시트(서버)에서만 받아오며 브라우저에 저장하지 않음 (비밀번호 제외)
  const [users, setUsers] = useState<User[]>(INITIAL_USERS);
  const [assignments, setAssignments] = useState<AgCmAssignment[]>(() =>
    loadStorage(STORAGE_KEYS.ASSIGNMENTS, INITIAL_ASSIGNMENTS)
  );
  const [conditions, setConditions] = useState<DealCondition[]>(() =>
    reconcileConditionGroupDates(loadStorage(STORAGE_KEYS.CONDITIONS, INITIAL_CONDITIONS))
  );
  const [conditionSyncLogs, setConditionSyncLogs] = useState<ConditionSheetSyncLog[]>(() =>
    loadStorage(STORAGE_KEYS.CONDITION_SYNC_LOGS, INITIAL_CONDITION_SYNC_LOGS)
  );
  const [transactions, setTransactions] = useState<Transaction[]>(() =>
    normalizeStoredTransactions(
      loadStorage(STORAGE_KEYS.TRANSACTIONS, INITIAL_TRANSACTIONS)
    )
  );
  const [rateTableImages, setRateTableImages] = useState<RateTableImageItem[]>(() =>
    loadStorage(STORAGE_KEYS.RATE_IMAGES, INITIAL_RATE_TABLE_IMAGES)
  );
  const [rateTableRows, setRateTableRows] = useState<RateTableRowItem[]>(() => {
    // 요율표는 구글 시트가 단일 진실 공급원(Single Source of Truth)이므로,
    // 과거 더미 데이터가 잔존하는 브라우저 localStorage를 완전히 초기화하고
    // 시트 기반 최신 141개 데이터(INITIAL_RATE_TABLE_ROWS)로 즉시 로드합니다.
    try {
      localStorage.removeItem(STORAGE_KEYS.RATE_ROWS);
      localStorage.removeItem('kanadara_v5_rate_rows');
    } catch {
      // ignore
    }
    return INITIAL_RATE_TABLE_ROWS;
  });
  const [cardPromotions, setCardPromotions] = useState<CardPromotionItem[]>(() =>
    loadStorage(STORAGE_KEYS.CARD_PROMOS, INITIAL_CARD_PROMOTIONS)
  );
  const [draftsV2, setDraftsV2] = useState<TransactionDraftV2[]>(() =>
    loadStorage(STORAGE_KEYS.DRAFTS_V2, [])
  );
  const [editingTxIdV2, setEditingTxIdV2] = useState<string | null>(null);
  const [pendingDraftIdV2, setPendingDraftIdV2] = useState<string | null>(null);
  const [isRateTableSplitOpen, setRateTableSplitOpen] = useState<boolean>(false);
  const [systemReferenceDate, setSystemReferenceDateState] = useState<string>(
    () => localStorage.getItem(STORAGE_KEYS.REF_DATE) || DEFAULT_REFERENCE_DATE
  );
  const [currentUserId, setCurrentUserId] = useState<string | null>(() => {
    return sessionStorage.getItem(STORAGE_KEYS.CURRENT_USER_ID) || null;
  });
  const [lastMasterSheetSyncedAt, setLastMasterSheetSyncedAt] = useState<string>(
    () => localStorage.getItem('kanadara_v5_master_sheet_synced_at') || '2026-11-04 12:18'
  );
  const [isSyncingMasterSheet, setIsSyncingMasterSheet] = useState<boolean>(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  // 시트를 정상적으로 읽어온 뒤에만 시트 쓰기를 허용 (빈/구형 브라우저 상태로 시트를 덮어쓰는 사고 방지)
  const [isSheetReady, setIsSheetReady] = useState<boolean>(false);
  // 서버 세션 기준 실제 로그인 계정 (화면상 계정 전환과 별개)
  const [sessionUser, setSessionUser] = useState<{ id: string; role: string } | null>(null);
  const [isAuthReady, setIsAuthReady] = useState<boolean>(false);
  const lastPushedKeyRef = useRef<string>('');

  // 구글 시트 → 웹앱 전체 로드. 실패하면 예외를 던지고 isSheetReady는 그대로 둔다.
  const loadFromSheet = async (): Promise<{ rates: number; promos: number; txs: number; users: number }> => {
    const res = await fetch('/api/gsheets/pull');
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) {
      throw Object.assign(new Error(json?.error || `시트 읽기 실패 (HTTP ${res.status})`), {
        status: res.status,
      });
    }
    const me = json.me as { id: string; role: string };
    const tabs = json.data as Record<string, unknown[][]>;

    const txResult = parseTransactionsFrom2D(tabs[GOOGLE_SHEET_TABS.TRANSACTION_MASTER.title] || []);
    if (txResult.legacyRowCount > 0) {
      throw new Error(
        `07_거래내역 탭에 웹앱원본데이터(JSON)가 없는 거래 ${txResult.legacyRowCount}건이 있어 복원할 수 없습니다. 시트 데이터를 지키기 위해 자동 저장을 중지합니다.`
      );
    }
    const sheetRates = parseRateTableFromTsv(rows2DToTsv(tabs[GOOGLE_SHEET_TABS.RATE_TABLE_MASTER.title])).rows;
    const sheetPromos = parsePromotionsFromTsv(rows2DToTsv(tabs[GOOGLE_SHEET_TABS.PROMOTION_MASTER.title])).promotions;
    const sheetUsers = parseUsersFrom2D(
      (tabs[GOOGLE_SHEET_TABS.USER_CM_MASTER.title] || []) as (string | number)[][]
    );

    // 거래는 시트가 원본. 시트에 없는 이 브라우저 전용 거래는 지우지 않고 백업만 남긴다.
    const sheetTxIds = new Set(txResult.transactions.map((t) => t.id));
    const localOnly = transactions.filter((t) => !sheetTxIds.has(t.id));
    if (localOnly.length > 0) {
      localStorage.setItem(`kanadara_local_only_tx_backup_${Date.now()}`, JSON.stringify(localOnly));
    }

    const nextRates = sheetRates.length > 0 ? sheetRates : rateTableRows;
    const nextPromos = sheetPromos.length > 0 ? sheetPromos : cardPromotions;
    const nextUsers = sheetUsers.length > 0 ? sheetUsers : users;
    const nextTxs = normalizeStoredTransactions(txResult.transactions);

    setRateTableRows(nextRates);
    setCardPromotions(nextPromos);
    setUsers(nextUsers);
    setTransactions(nextTxs);
    setSessionUser(me);
    // ADMIN만 화면상 다른 계정으로 전환해 둔 상태를 유지할 수 있음
    setCurrentUserId((prev) => (me.role === 'ADMIN' && prev ? prev : me.id));
    lastPushedKeyRef.current = JSON.stringify(
      buildMasterBatchOps(nextRates, nextPromos, nextTxs, nextUsers)
    );
    setIsSheetReady(true);
    return { rates: nextRates.length, promos: nextPromos.length, txs: nextTxs.length, users: nextUsers.length };
  };

  const pushBatchToSheet = async (batchOps: ReturnType<typeof buildMasterBatchOps>) => {
    const res = await fetch('/api/gsheets/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ batchOps }),
    });
    const json = await res.json().catch(() => null);
    if (res.status === 401) {
      setIsSheetReady(false);
      setCurrentUserId(null);
    }
    if (!res.ok || !json?.ok) {
      throw new Error(json?.error || `시트 저장 실패 (HTTP ${res.status})`);
    }
    lastPushedKeyRef.current = JSON.stringify(batchOps);
  };

  useEffect(() => {
    loadFromSheet()
      .catch((err) => {
        if ((err as { status?: number }).status === 401) {
          setCurrentUserId(null);
          return;
        }
        pushToast({
        type: 'error',
        title: '구글 시트 연결 실패 — 시트 저장 중지됨',
          description: err instanceof Error ? err.message : String(err),
        });
      })
      .finally(() => setIsAuthReady(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.DRAFTS_V2, JSON.stringify(draftsV2));
  }, [draftsV2]);


  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.ASSIGNMENTS, JSON.stringify(assignments));
  }, [assignments]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.CONDITIONS, JSON.stringify(conditions));
  }, [conditions]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.CONDITION_SYNC_LOGS, JSON.stringify(conditionSyncLogs));
  }, [conditionSyncLogs]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.TRANSACTIONS, JSON.stringify(transactions));
  }, [transactions]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.RATE_IMAGES, JSON.stringify(rateTableImages));
  }, [rateTableImages]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.CARD_PROMOS, JSON.stringify(cardPromotions));
  }, [cardPromotions]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.REF_DATE, systemReferenceDate);
  }, [systemReferenceDate]);

  useEffect(() => {
    if (currentUserId) {
      sessionStorage.setItem(STORAGE_KEYS.CURRENT_USER_ID, currentUserId);
    } else {
      sessionStorage.removeItem(STORAGE_KEYS.CURRENT_USER_ID);
    }
  }, [currentUserId]);

  const currentUser = useMemo(() => {
    if (!currentUserId) return null;
    const found = users.find((u) => u.id === currentUserId && u.isActive) ?? null;
    if (!found) return null;
    if (appVersion === 'v2' && found.role === 'CM') {
      return (
        users.find((u) => u.role === 'AG' && u.isActive) ||
        users.find((u) => u.role === 'ADMIN' && u.isActive) ||
        found
      );
    }
    return found;
  }, [users, currentUserId, appVersion]);

  const setAppVersion = (ver: 'v1' | 'v2') => {
    setAppVersionState(ver);
    if (ver === 'v2' && currentUser && currentUser.role === 'CM') {
      const agUser = users.find((u) => u.role === 'AG' && u.isActive);
      if (agUser) {
        setCurrentUserId(agUser.id);
      }
    }
  };

  const pushToast = (toast: Omit<ToastMessage, 'id'>) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setToasts((prev) => [...prev, { ...toast, id }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4400);
  };

  const dismissToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const toggleRateTableSplit = () => {
    setRateTableSplitOpen((prev) => !prev);
  };

  const setSystemReferenceDate = (date: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    setSystemReferenceDateState(date);
    pushToast({
      type: 'info',
      title: `기준일자 변경: ${date}`,
      description: '해당 일자를 기준으로 카드사별 실행 조건(적용중/실행예정/종료)이 자동 전환되었습니다.',
    });
  };

  const getUserById = (id: string) => users.find((u) => u.id === id);

  const getAssignedAgForCm = (cmId: string): User | undefined => {
    const rel = assignments.find((a) => a.cmId === cmId);
    if (!rel) return undefined;
    return users.find((u) => u.id === rel.agId && u.role === 'AG');
  };

  const getAssignedCmsForAg = (agId: string): User[] => {
    const cmIds = new Set(assignments.filter((a) => a.agId === agId).map((a) => a.cmId));
    return users.filter((u) => u.role === 'CM' && cmIds.has(u.id));
  };

  const canAccessTransaction = (tx: Transaction, user: User | null = currentUser): boolean => {
    if (!user || !user.isActive) return false;
    if (user.role === 'ADMIN') return true;
    if (user.role === 'CM') return tx.cmId === user.id;
    if (user.role === 'AG') {
      return (
        tx.agId === user.id ||
        assignments.some((a) => a.agId === user.id && a.cmId === tx.cmId)
      );
    }
    return false;
  };

  const canManageApprovalOf = (tx: Transaction, user: User | null = currentUser): boolean => {
    if (!user || !user.isActive) return false;
    if (user.role === 'ADMIN') return true;
    if (user.role === 'AG') {
      return (
        tx.agId === user.id ||
        assignments.some((a) => a.agId === user.id && a.cmId === tx.cmId)
      );
    }
    return false;
  };

  const accessibleTransactions = useMemo(() => {
    if (!currentUser) return [];
    return transactions
      .filter((tx) => canAccessTransaction(tx, currentUser))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [transactions, currentUser, assignments]);

  const getEffectiveConditionForGroup = (
    conditionGroupCode?: string,
    targetDate: string = systemReferenceDate
  ): DealCondition | undefined => {
    if (!conditionGroupCode) return undefined;
    return conditions
      .filter(
        (c) =>
          c.conditionGroupCode === conditionGroupCode &&
          getConditionLifecycleStatus(c, targetDate) === 'ACTIVE_NOW'
      )
      .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
  };

  const getScheduledNextConditionForGroup = (
    conditionGroupCode?: string,
    targetDate: string = systemReferenceDate
  ): DealCondition | undefined => {
    if (!conditionGroupCode) return undefined;
    return conditions
      .filter(
        (c) =>
          c.conditionGroupCode === conditionGroupCode &&
          getConditionLifecycleStatus(c, targetDate) === 'SCHEDULED'
      )
      .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))[0];
  };

  const login = async (loginId: string, password: string): Promise<ActionResult> => {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loginId: loginId.trim(), password }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        return { ok: false, message: json?.error || `로그인 실패 (HTTP ${res.status})` };
      }
      setCurrentUserId(null); // 이전 화면 전환 상태 초기화 → 로그인한 본인 계정으로
      await loadFromSheet();
      pushToast({
        type: 'success',
        title: `${json.user.name}님 환영합니다`,
        description: `${json.user.role} 권한으로 접속했습니다.`,
      });
      return { ok: true, message: '로그인 성공' };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : '로그인 중 오류가 발생했습니다.' };
    }
  };

  const quickSwitchUser = (userId: string) => {
    if (sessionUser?.role !== 'ADMIN') {
      pushToast({ type: 'error', title: '계정 전환 불가', description: '관리자(ADMIN)만 화면 계정 전환을 할 수 있습니다.' });
      return;
    }
    const target = users.find((u) => u.id === userId && u.isActive);
    if (!target) {
      pushToast({
        type: 'error',
        title: '계정 전환 불가',
        description: '비활성화되었거나 존재하지 않는 계정입니다.',
      });
      return;
    }
    setCurrentUserId(target.id);
    pushToast({
      type: 'info',
      title: `역할 전환: ${target.name} (${target.role})`,
      description: `${target.affiliation} 화면 및 접근 권한이 즉시 적용되었습니다.`,
    });
  };

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    sessionStorage.removeItem(STORAGE_KEYS.CURRENT_USER_ID);
    // 메모리에 남은 다른 계정의 데이터까지 비우기 위해 새로 로드
    window.location.assign('/login');
  };

  // [신규 핵심] AG의 거래승인 요청 등록 및 수정 (거래정보 + CM 등록 데이터 자동 연동 + 분할 결제정보)
  const saveAgTransactionRequest = (input: SaveAgTransactionInput): ActionResult => {
    if (!currentUser || (currentUser.role !== 'AG' && currentUser.role !== 'ADMIN')) {
      return {
        ok: false,
        message: 'AG(에이전시 담당자) 또는 관리자만 거래 승인 요청을 등록·수정할 수 있습니다.',
      };
    }

    if (!input.customerName.trim()) {
      return { ok: false, message: '거래정보의 고객이름을 입력해 주세요.' };
    }

    const cmUser = users.find((u) => u.id === input.cmId && u.role === 'CM');
    if (!cmUser) {
      return { ok: false, message: '연동할 담당 CM을 선택해 주세요.' };
    }

    if (!input.paymentSplits || input.paymentSplits.length === 0) {
      return { ok: false, message: '최소 1개 이상의 결제정보 행을 입력해 주세요.' };
    }

    for (let i = 0; i < input.paymentSplits.length; i++) {
      const split = input.paymentSplits[i];
      if (!Number.isFinite(split.amount) || split.amount <= 0) {
        return {
          ok: false,
          message: `결제정보 #${i + 1} 행의 결제 금액을 0원보다 크게 입력해 주세요.`,
        };
      }
    }

    // [요구사항 #1] 결제 분할 추가 시 1번째 결제의 카드사로 고정 (다른 카드사로 교차 분할결제 불가)
    const lockedCardCompany = input.paymentSplits[0].cardCompany;

    // 결제방법 규칙 정규화: 일시불일 시 할부개월 1달 고정 + 금리 0% / 할부·다이렉트할부 시 캐시백 0%
    const normalizedSplits: PaymentSplitItem[] = input.paymentSplits.map((s, idx) => {
      const isLumpSum = s.paymentMethod === '일시불';
      return {
        id: s.id || `split-${Date.now()}-${idx}`,
        cardCompany: lockedCardCompany,
        paymentMethod: s.paymentMethod,
        rateCategory: s.rateCategory?.trim() || '기본',
        amount: Math.round(s.amount),
        installmentMonths: isLumpSum ? 1 : Math.max(2, Math.round(s.installmentMonths || 12)),
        cashbackRate: isLumpSum ? Number((s.cashbackRate || 0).toFixed(2)) : 0,
        interestRate: isLumpSum ? 0 : Number((s.interestRate || 0).toFixed(2)),
        agCommissionRate: Number((s.agCommissionRate || 0).toFixed(2)),
        cmCommissionRate: Number((s.cmCommissionRate || 0).toFixed(2)),
        customConditionNote: s.customConditionNote?.trim() || undefined,
      };
    });

    // 적용된 프로모션도 선택한 고정 카드사와 일치하는 것만 유지
    const normalizedPromotions: AppliedPromotionSnapshot[] = (
      input.appliedPromotions || []
    ).filter((p) => p.cardCompany === lockedCardCompany);

    const totals = calcSplitTotals(normalizedSplits, normalizedPromotions);
    const primarySplit = normalizedSplits[0];
    const mappedCardCompany = mapSplitCardToCardCompany(primarySplit.cardCompany);
    const mappedPaymentMethod: PaymentMethod =
      normalizedSplits.length > 1
        ? '일시불+할부 복합결제'
        : primarySplit.paymentMethod === '일시불'
        ? '일시불 오토캐시백'
        : '신차 카드할부';

    const promoSuffix =
      normalizedPromotions.length > 0
        ? ` + 프로모션 ${normalizedPromotions.length}건 적용`
        : '';

    const primaryCatBadge =
      primarySplit.rateCategory && primarySplit.rateCategory !== '기본'
        ? ` [${primarySplit.rateCategory}]`
        : '';

    const splitSummaryTitle =
      normalizedSplits.length === 1
        ? `${primarySplit.cardCompany} ${primarySplit.paymentMethod}${primaryCatBadge} (${
            primarySplit.paymentMethod === '일시불'
              ? `1달 · 캐시백 ${primarySplit.cashbackRate}%`
              : `${primarySplit.installmentMonths}개월 · 금리 ${primarySplit.interestRate}%`
          })${promoSuffix}`
        : `${primarySplit.cardCompany} 총 ${normalizedSplits.length}건 분할결제 (${normalizedSplits
            .map(
              (s) =>
                `${s.paymentMethod}${
                  s.rateCategory && s.rateCategory !== '기본' ? `[${s.rateCategory}]` : ''
                } ${(s.amount / 10000).toLocaleString()}만`
            )
            .join(' + ')})${promoSuffix}`;

    const cmSnapshot = buildCmSnapshotFromUser(cmUser);
    const assignedAg = getAssignedAgForCm(cmUser.id);
    const resolvedAgId =
      currentUser.role === 'AG'
        ? currentUser.id
        : assignedAg?.id || users.find((u) => u.role === 'AG')?.id || 'usr-ag-1';

    const reqDate = input.requestDate || getTodayDateStr();
    const isApprovedStatus = normalizeV2ProgressStatus(input.status) === 'APPROVED';
    const appDate = isApprovedStatus
      ? input.approvalDate || getTodayDateStr()
      : '';
    const nowTime = nowFormatted().slice(11, 16);
    const timestamp = `${appDate || reqDate} ${nowTime}`;
    const statusLabel = APPROVAL_STATUS_META[input.status].label;

    const snapshot: ConditionSnapshot = {
      conditionId: `ag-split-${Date.now()}`,
      channelType: normalizedSplits.some((s) => s.paymentMethod === '다이렉트할부')
        ? 'AG다이렉트'
        : '일반제휴',
      cardKind: '개인 신용',
      installmentTerms: normalizedSplits
        .map((s) => (s.paymentMethod === '일시불' ? '1달(일시불)' : `${s.installmentMonths}개월`))
        .join(' / '),
      downPaymentRule:
        normalizedSplits.length > 1
          ? `${lockedCardCompany} 고정 ${normalizedSplits.length}건 분할결제`
          : '단일 결제',
      title: splitSummaryTitle,
      customerCashbackRate: totals.weightedCashbackRate,
      agCommissionRate: totals.weightedAgRate,
      cmCommissionRate: totals.weightedCmRate,
      description: normalizedSplits
        .map(
          (s, i) =>
            `[${i + 1}] ${s.cardCompany} ${s.paymentMethod} ${(s.amount / 10000).toLocaleString()}만원 (${
              s.paymentMethod === '일시불'
                ? `1달, 캐시백 ${s.cashbackRate}%`
                : `${s.installmentMonths}개월, 금리 ${s.interestRate}%`
            }, AG ${s.agCommissionRate}%, CM ${s.cmCommissionRate}%)${
              s.customConditionNote ? ` - ${s.customConditionNote}` : ''
            }`
        )
        .join(' | '),
      appliedBasisNote: `요청일자 ${reqDate}${appDate ? ` / 승인일자 ${appDate}` : ' / 승인 대기'} 기준 AG 직접 입력`,
    };

    if (input.txId) {
      const existing = transactions.find((t) => t.id === input.txId);
      if (!existing) {
        return { ok: false, message: '수정할 거래 내역을 찾을 수 없습니다.' };
      }

      const resolvedAppDate =
        normalizeV2ProgressStatus(input.status) === 'APPROVED'
          ? input.approvalDate || existing.approvalDate || getTodayDateStr()
          : '';

      setTransactions((prev) =>
        prev.map((item) =>
          item.id !== input.txId
            ? item
            : {
                ...item,
                cmId: cmUser.id,
                agId: resolvedAgId,
                customerName: input.customerName.trim(),
                requestDate: reqDate,
                approvalDate: resolvedAppDate,
                cmProfile: cmSnapshot,
                paymentSplits: normalizedSplits,
                appliedPromotions: normalizedPromotions,
                vehicleInfo: input.vehicleInfo?.trim() || item.vehicleInfo || '신차 오토캐시백 진행건',
                cardCompany: mappedCardCompany,
                paymentMethod: mappedPaymentMethod,
                amount: totals.totalAmount,
                conditionSnapshot: snapshot,
                requestMemo: input.requestMemo?.trim() || undefined,
                status: input.status,
                settlementStatus:
                  input.settlementStatus || item.settlementStatus || '정산 대기',
                rejectionReason:
                  input.status === 'REJECTED'
                    ? input.rejectionReason?.trim() || '심사 기준 미충족 반려'
                    : undefined,
                updatedAt: timestamp,
                history: [
                  ...item.history,
                  {
                    id: `hist-${Date.now()}`,
                    changedAt: timestamp,
                    actorId: currentUser.id,
                    actorName: currentUser.name,
                    actorRole: currentUser.role,
                    previousStatus: item.status,
                    newStatus: input.status,
                    actionType: 'SPLITS_UPDATED',
                    actionLabel: `거래 승인요청 수정 (${statusLabel})`,
                    reasonOrNote: `${splitSummaryTitle} · 총 ${(
                      totals.totalAmount / 10000
                    ).toLocaleString()}만원`,
                  },
                ],
              }
        )
      );

      pushToast({
        type: 'success',
        title: `거래(${input.txId}) 정보가 업데이트되었습니다`,
        description: `고객: ${input.customerName.trim()} · 진행상황: ${statusLabel}`,
      });
      return {
        ok: true,
        message: '거래 승인요청 정보가 수정되었습니다.',
        transactionId: input.txId,
      };
    }

    const yyyymm = reqDate.slice(0, 7).replace('-', '');
    const seq = String(transactions.length + 1).padStart(4, '0');
    const newId = `TRX-${yyyymm}-${seq}`;

    const newTx: Transaction = {
      id: newId,
      cmId: cmUser.id,
      agId: resolvedAgId,
      customerName: input.customerName.trim(),
      requestDate: reqDate,
      approvalDate: appDate,
      cmProfile: cmSnapshot,
      paymentSplits: normalizedSplits,
      appliedPromotions: normalizedPromotions,
      vehicleInfo: input.vehicleInfo?.trim() || `${primarySplit.cardCompany} 오토캐시백·할부 진행건`,
      identifierType: 'RRN',
      maskedIdentifier: cmSnapshot.rrn
        ? `${cmSnapshot.rrn.slice(0, 8)}******`
        : '900101-1******',
      agVerifyIdentifier: cmSnapshot.rrn
        ? `${cmSnapshot.rrn.slice(0, 9)}*****`
        : '900101-12*****',
      cardCompany: mappedCardCompany,
      paymentMethod: mappedPaymentMethod,
      amount: totals.totalAmount,
      conditionSnapshot: snapshot,
      requestMemo: input.requestMemo?.trim() || undefined,
      status: input.status,
      settlementStatus: input.settlementStatus || '정산 대기',
      rejectionReason:
        input.status === 'REJECTED'
          ? input.rejectionReason?.trim() || '심사 기준 미충족 반려'
          : undefined,
      cardApplication: {
        status: input.status === 'WAITING' ? 'NOT_APPLIED' : 'APPLIED',
        appliedAt: timestamp,
        handlerName: currentUser.name,
      },
      sheetSync: { status: 'NOT_SUBMITTED', attemptCount: 0, retryHistory: [] },
      history: [
        {
          id: `hist-${Date.now()}`,
          changedAt: `${reqDate} ${nowTime}`,
          actorId: currentUser.id,
          actorName: currentUser.name,
          actorRole: currentUser.role,
          previousStatus: null,
          newStatus: input.status,
          actionType: 'REQUEST_CREATED',
          actionLabel: `AG 거래 승인요청 등록 (${statusLabel})`,
          reasonOrNote: `CM(${cmSnapshot.name} / ${cmSnapshot.affiliation}) 연동 · ${splitSummaryTitle} · 총 ${(
            totals.totalAmount / 10000
          ).toLocaleString()}만원`,
        },
      ],
      createdAt: `${reqDate} ${nowTime}`,
      updatedAt: timestamp,
    };

    setTransactions((prev) => [newTx, ...prev]);
    pushToast({
      type: 'success',
      title: 'AG 거래 승인요청이 등록되었습니다',
      description: `${newId} (${input.customerName.trim()} 고객 / 담당 CM: ${cmSnapshot.name}) 건이 등록되었습니다.`,
    });

    return { ok: true, message: '거래 승인요청이 등록되었습니다.', transactionId: newId };
  };

  // [신규] 진행상황 변경 (카드 승인 변경 시 해당 일자를 승인일자로 자동 기록, 그 외는 공백)
  const quickChangeTransactionStatus = (
    txId: string,
    newStatus: ApprovalStatus,
    approvalDateOverride?: string,
    reasonOrNote?: string
  ): ActionResult => {
    const tx = transactions.find((t) => t.id === txId);
    if (!tx) return { ok: false, message: '존재하지 않는 거래입니다.' };
    if (!canManageApprovalOf(tx)) {
      return { ok: false, message: '담당 AG 또는 관리자만 거래 상태를 변경할 수 있습니다.' };
    }

    const todayStr = getTodayDateStr();
    const isNowApproved = normalizeV2ProgressStatus(newStatus) === 'APPROVED';
    const nextApprovalDate = isNowApproved
      ? approvalDateOverride || todayStr
      : '';
    const now = `${todayStr} ${nowFormatted().slice(11, 16)}`;
    const statusLabel = APPROVAL_STATUS_META[newStatus].label;

    setTransactions((prev) =>
      prev.map((item) =>
        item.id !== txId
          ? item
          : {
              ...item,
              status: newStatus,
              approvalDate: nextApprovalDate,
              rejectionReason:
                newStatus === 'REJECTED'
                  ? reasonOrNote?.trim() || item.rejectionReason || '심사 기준 미충족 반려'
                  : item.rejectionReason,
              updatedAt: now,
              history: [
                ...item.history,
                {
                  id: `hist-${Date.now()}`,
                  changedAt: now,
                  actorId: currentUser!.id,
                  actorName: currentUser!.name,
                  actorRole: currentUser!.role,
                  previousStatus: item.status,
                  newStatus,
                  actionType:
                    newStatus === 'APPROVED'
                      ? 'APPROVED'
                      : newStatus === 'REJECTED'
                      ? 'REJECTED'
                      : newStatus === 'SLIP_REQUIRED'
                      ? 'SLIP_REQUIRED_SET'
                      : newStatus === 'COMPLETED'
                      ? 'COMPLETED_SET'
                      : 'REVIEW_STARTED',
                  actionLabel: `진행상황 변경: ${statusLabel}`,
                  reasonOrNote:
                    reasonOrNote?.trim() ||
                    (isNowApproved
                      ? `카드 승인일(${nextApprovalDate}) 자동 기록`
                      : `[${statusLabel}] 상태로 변경`),
                },
              ],
            }
      )
    );

    pushToast({
      type: 'success',
      title: `진행상황 변경: ${statusLabel}`,
      description: isNowApproved
        ? `${tx.id} (${tx.customerName} 고객) · 승인일자가 ${nextApprovalDate}로 기록되었습니다.`
        : `${tx.id} (${tx.customerName} 고객) · 진행상황이 [${statusLabel}]로 변경되었습니다.`,
    });
    return { ok: true, message: `상태가 ${statusLabel}(으)로 변경되었습니다.` };
  };

  // [신규] 정산상황 변경 (정산 대기 / 정산 완료 / 지급 완료(CM))
  const quickChangeTransactionSettlementStatus = (
    txId: string,
    newSettlementStatus: SettlementProgressStatus
  ): ActionResult => {
    const tx = transactions.find((t) => t.id === txId);
    if (!tx) return { ok: false, message: '존재하지 않는 거래입니다.' };
    if (!canManageApprovalOf(tx)) {
      return { ok: false, message: '담당 AG 또는 관리자만 정산상황을 변경할 수 있습니다.' };
    }

    const todayStr = getTodayDateStr();
    const now = `${todayStr} ${nowFormatted().slice(11, 16)}`;

    setTransactions((prev) =>
      prev.map((item) =>
        item.id !== txId
          ? item
          : {
              ...item,
              settlementStatus: newSettlementStatus,
              updatedAt: now,
              history: [
                ...item.history,
                {
                  id: `hist-stl-${Date.now()}`,
                  changedAt: now,
                  actorId: currentUser!.id,
                  actorName: currentUser!.name,
                  actorRole: currentUser!.role,
                  previousStatus: item.status,
                  newStatus: item.status,
                  actionType: 'COMMISSION_FIXED',
                  actionLabel: `정산상황 변경: ${newSettlementStatus}`,
                  reasonOrNote: `정산상황을 [${newSettlementStatus}]로 변경`,
                },
              ],
            }
      )
    );

    pushToast({
      type: 'success',
      title: `정산상황 변경: ${newSettlementStatus}`,
      description: `${tx.id} (${tx.customerName} 고객) 정산상황이 업데이트되었습니다.`,
    });
    return { ok: true, message: `정산상황이 ${newSettlementStatus}(으)로 변경되었습니다.` };
  };

  // [신규] 대시보드 다중 선택 일괄 변경 (진행상황 및 정산상황)
  const bulkUpdateTransactionsV2 = (
    txIds: string[],
    patch: {
      status?: ApprovalStatus;
      settlementStatus?: SettlementProgressStatus;
    }
  ): ActionResult => {
    if (!currentUser) {
      return { ok: false, message: '로그인이 필요합니다.' };
    }
    if (txIds.length === 0) {
      return { ok: false, message: '선택된 거래 승인건이 없습니다.' };
    }
    if (!patch.status && !patch.settlementStatus) {
      return { ok: false, message: '변경할 진행상황 또는 정산상황을 선택해 주세요.' };
    }

    const idSet = new Set(txIds);
    const todayStr = getTodayDateStr();
    const now = `${todayStr} ${nowFormatted().slice(11, 16)}`;

    const changeDescParts: string[] = [];
    if (patch.status) {
      changeDescParts.push(`진행상황: ${APPROVAL_STATUS_META[patch.status].label}`);
    }
    if (patch.settlementStatus) {
      changeDescParts.push(`정산상황: ${patch.settlementStatus}`);
    }
    const summaryLabel = changeDescParts.join(' · ');

    setTransactions((prev) =>
      prev.map((item) => {
        if (!idSet.has(item.id)) return item;
        const nextStatus = patch.status ?? item.status;
        const nextSettlement =
          patch.settlementStatus ?? item.settlementStatus ?? '정산 대기';
        const nextApprovalDate = patch.status
          ? normalizeV2ProgressStatus(patch.status) === 'APPROVED'
            ? item.approvalDate || todayStr
            : ''
          : item.approvalDate;

        return {
          ...item,
          status: nextStatus,
          settlementStatus: nextSettlement,
          approvalDate: nextApprovalDate,
          updatedAt: now,
          history: [
            ...item.history,
            {
              id: `hist-bulk-${Date.now()}-${item.id}`,
              changedAt: now,
              actorId: currentUser.id,
              actorName: currentUser.name,
              actorRole: currentUser.role,
              previousStatus: item.status,
              newStatus: nextStatus,
              actionType: nextStatus === 'APPROVED' ? 'APPROVED' : 'SPLITS_UPDATED',
              actionLabel: `일괄 변경 (${summaryLabel})`,
              reasonOrNote: `${txIds.length}건 다중 선택 일괄 적용`,
            },
          ],
        };
      })
    );

    pushToast({
      type: 'success',
      title: `${txIds.length}건 일괄 적용 완료`,
      description: summaryLabel,
    });
    return { ok: true, message: `${txIds.length}건이 일괄 변경되었습니다.` };
  };

  // 레거시 호환용 함수
  const registerTransaction = (input: RegisterTransactionInput): ActionResult => {
    if (!currentUser) {
      return { ok: false, message: '로그인이 필요합니다.' };
    }
    const idCheck = validateAndMaskIdentifier(input.identifierType, input.rawIdentifier);
    const cond = conditions.find((c) => c.id === input.conditionId) || conditions[0];
    const cmUser =
      currentUser.role === 'CM'
        ? currentUser
        : users.find((u) => u.role === 'CM') || INITIAL_USERS[3];

    return saveAgTransactionRequest({
      customerName: input.customerName,
      requestDate: systemReferenceDate,
      status: 'WAITING',
      approvalDate: systemReferenceDate,
      cmId: cmUser.id,
      vehicleInfo: input.vehicleInfo || idCheck.maskedIdentifier,
      requestMemo: input.requestMemo,
      paymentSplits: [
        {
          id: `split-${Date.now()}`,
          cardCompany: '제휴카드사(삼성)',
          paymentMethod: '일시불',
          amount: input.amount,
          installmentMonths: 1,
          cashbackRate: cond?.customerCashbackRate ?? 2.0,
          interestRate: 0,
          agCommissionRate: 0.9,
          cmCommissionRate: cond?.cmCommissionRate ?? 0.5,
        },
      ],
    });
  };

  // 3.1.1 승인 요청 검토 시작
  const startReview = (txId: string): ActionResult => {
    return quickChangeTransactionStatus(
      txId,
      'REVIEWING',
      systemReferenceDate,
      '담당 AG 요청 접수 및 카드사 승인 조건 심사 시작'
    );
  };

  // 3.1.2 카드사 신청 내역 기록
  const recordCardApplication = (txId: string, record: CardApplicationRecord): ActionResult => {
    const tx = transactions.find((t) => t.id === txId);
    if (!tx) return { ok: false, message: '존재하지 않는 거래입니다.' };
    if (!canManageApprovalOf(tx)) {
      return { ok: false, message: '담당 AG만 카드사 신청 내역을 기록할 수 있습니다.' };
    }

    const now = `${systemReferenceDate} ${nowFormatted().slice(11, 16)}`;
    const statusText =
      record.status === 'APPLIED'
        ? '카드사 신청완료'
        : record.status === 'DOC_REQUESTED'
        ? '보완서류 요청'
        : '미신청';

    setTransactions((prev) =>
      prev.map((item) =>
        item.id !== txId
          ? item
          : {
              ...item,
              cardApplication: {
                status: record.status,
                appliedAt: record.appliedAt || now,
                handlerName: record.handlerName?.trim() || currentUser!.name,
                referenceNo: record.referenceNo?.trim() || undefined,
                memo: record.memo?.trim() || undefined,
              },
              updatedAt: now,
              history: [
                ...item.history,
                {
                  id: `hist-${Date.now()}`,
                  changedAt: now,
                  actorId: currentUser!.id,
                  actorName: currentUser!.name,
                  actorRole: currentUser!.role,
                  previousStatus: item.status,
                  newStatus: item.status,
                  actionType: 'CARD_APPLIED',
                  actionLabel: '카드사 신청 내역 기록',
                  reasonOrNote: `[${statusText}] 담당: ${
                    record.handlerName?.trim() || currentUser!.name
                  }${record.referenceNo ? ` · 접수번호: ${record.referenceNo}` : ''}${
                    record.memo ? ` · ${record.memo}` : ''
                  }`,
                },
              ],
            }
      )
    );

    pushToast({
      type: 'success',
      title: '카드사 신청 내역 저장 완료',
      description: `${tx.cardCompany} 신청 진행 정보가 업데이트되었습니다.`,
    });
    return { ok: true, message: '카드사 신청 내역이 저장되었습니다.' };
  };

  // 3.1.3 승인 또는 반려 결과 등록 — 승인일자(approvalDate) 기준 실행 조건 자동 매칭 반영!
  const decideApproval = (
    txId: string,
    decision: 'APPROVED' | 'REJECTED',
    reasonOrNote: string,
    approvalDateOverride?: string
  ): ActionResult => {
    const tx = transactions.find((t) => t.id === txId);
    if (!tx) return { ok: false, message: '존재하지 않는 거래입니다.' };
    if (!canManageApprovalOf(tx)) {
      return { ok: false, message: '담당 AG만 승인 또는 반려 결과를 등록할 수 있습니다.' };
    }

    const trimmedReason = reasonOrNote.trim();
    if (decision === 'REJECTED' && !trimmedReason) {
      return { ok: false, message: '반려 처리 시 CM에게 전달할 반려 사유를 필수로 입력해야 합니다.' };
    }

    const approvalDate = approvalDateOverride || systemReferenceDate;
    const now = `${approvalDate} ${nowFormatted().slice(11, 16)}`;

    let updatedSnapshot = tx.conditionSnapshot;
    let conditionTransitionLog = '';

    if (decision === 'APPROVED' && tx.conditionSnapshot.conditionGroupCode) {
      const effectiveOnApproval = getEffectiveConditionForGroup(
        tx.conditionSnapshot.conditionGroupCode,
        approvalDate
      );
      if (
        effectiveOnApproval &&
        effectiveOnApproval.id !== tx.conditionSnapshot.conditionId
      ) {
        conditionTransitionLog = ` [승인일(${approvalDate}) 실행일자 기준 조건 자동 전환: v${tx.conditionSnapshot.versionNo ?? 1}(${tx.conditionSnapshot.customerCashbackRate}%) → v${effectiveOnApproval.versionNo}(${effectiveOnApproval.customerCashbackRate}%, 실행일 ${effectiveOnApproval.effectiveFrom})]`;
        updatedSnapshot = {
          ...tx.conditionSnapshot,
          conditionId: effectiveOnApproval.id,
          conditionGroupCode: effectiveOnApproval.conditionGroupCode,
          versionNo: effectiveOnApproval.versionNo,
          effectiveFrom: effectiveOnApproval.effectiveFrom,
          channelType: effectiveOnApproval.channelType,
          cardKind: effectiveOnApproval.cardKind,
          installmentTerms: effectiveOnApproval.installmentTerms,
          downPaymentRule: effectiveOnApproval.downPaymentRule,
          title: effectiveOnApproval.title,
          customerCashbackRate: effectiveOnApproval.customerCashbackRate,
          cmCommissionRate: effectiveOnApproval.cmCommissionRate,
          description: effectiveOnApproval.description,
          appliedBasisNote: `승인일(${approvalDate}) 기준 실행 조건 v${effectiveOnApproval.versionNo} (실행일 ${effectiveOnApproval.effectiveFrom}) 확정 적용됨`,
        };
      } else {
        updatedSnapshot = {
          ...tx.conditionSnapshot,
          appliedBasisNote: `승인일(${approvalDate}) 기준 현행 실행 조건 유지 확정됨`,
        };
      }
    }

    setTransactions((prev) =>
      prev.map((item) =>
        item.id !== txId
          ? item
          : {
              ...item,
              status: decision,
              approvalDate,
              conditionSnapshot: updatedSnapshot,
              rejectionReason: decision === 'REJECTED' ? trimmedReason : undefined,
              updatedAt: now,
              history: [
                ...item.history,
                {
                  id: `hist-${Date.now()}`,
                  changedAt: now,
                  actorId: currentUser!.id,
                  actorName: currentUser!.name,
                  actorRole: currentUser!.role,
                  previousStatus: item.status,
                  newStatus: decision,
                  actionType: decision === 'APPROVED' ? 'APPROVED' : 'REJECTED',
                  actionLabel: decision === 'APPROVED' ? '승인 확정' : '반려 처리',
                  reasonOrNote:
                    decision === 'APPROVED'
                      ? `${trimmedReason || '카드사 승인 완료 확정 — 고객 결제 후 전표 제출 가능'}${conditionTransitionLog}`
                      : trimmedReason,
                },
              ],
            }
      )
    );

    pushToast({
      type: decision === 'APPROVED' ? 'success' : 'info',
      title: decision === 'APPROVED' ? '거래가 승인 확정되었습니다' : '거래가 반려 처리되었습니다',
      description:
        decision === 'APPROVED'
          ? conditionTransitionLog
            ? `승인일(${approvalDate}) 실행일자 기준 새 조건(v${updatedSnapshot.versionNo})이 자동 적용되었습니다.`
            : '승인일 기준 현행 유효 조건으로 확정되어 CM에게 공유되었습니다.'
          : '담당 CM 화면에 반려 상태와 반려 사유가 즉시 공유되었습니다.',
    });
    return { ok: true, message: '처리 결과가 저장되었습니다.' };
  };

  // 5.1 거래 전표 제출 및 구글 시트 자동입력
  const submitSlip = (txId: string, input: SubmitSlipInput): ActionResult => {
    const tx = transactions.find((t) => t.id === txId);
    if (!tx) return { ok: false, message: '존재하지 않는 거래입니다.' };
    if (!currentUser || !canAccessTransaction(tx, currentUser)) {
      return { ok: false, message: '해당 거래에 전표를 제출할 권한이 없습니다.' };
    }
    if (
      tx.status !== 'APPROVED' &&
      tx.status !== 'SLIP_REQUIRED' &&
      tx.status !== 'COMPLETED'
    ) {
      return {
        ok: false,
        message: '승인 또는 전표제출필요 상태의 거래에 대해서만 전표를 제출할 수 있습니다.',
      };
    }
    if (tx.slip) {
      return {
        ok: false,
        message: '이미 전표가 제출된 거래입니다. 중복 제출 및 구글 시트 중복 행 생성이 차단되었습니다.',
      };
    }
    if (!input.approvalNumber.trim() || input.approvalNumber.replace(/\D/g, '').length < 6) {
      return { ok: false, message: '카드 승인번호(숫자 6~8자리 이상)를 정확히 입력해 주세요.' };
    }
    if (!input.fileName.trim()) {
      return { ok: false, message: '매출전표 증빙 파일(이미지 또는 PDF)을 첨부해 주세요.' };
    }
    if (!Number.isFinite(input.approvedAmount) || input.approvedAmount <= 0) {
      return { ok: false, message: '전표 결제 금액을 올바르게 입력해 주세요.' };
    }

    const now = nowFormatted();
    const yyyymm = tx.createdAt.slice(0, 7).replace('-', '');
    const yyyymmUnderscore = tx.createdAt.slice(0, 7).replace('-', '_');
    const slipId = `SLIP-${yyyymm}-${String(Math.floor(1000 + Math.random() * 8999))}`;
    const idempotencyKey = `${tx.id}:${slipId}`;
    const sim = input.simulateResult ?? 'SUCCESS';

    const existingSyncedCount = transactions.filter((t) => t.sheetSync.status === 'SYNCED').length;
    const externalRowId = `GS-${yyyymm}-ROW-${String(101 + existingSyncedCount).padStart(4, '0')}`;
    const sheetTabName = `${yyyymmUnderscore}_오토캐시백전표`;

    const isSuccess = sim === 'SUCCESS';
    const nextStatus: ApprovalStatus = isSuccess ? 'COMPLETED' : tx.status;
    const errorCode =
      sim === 'AUTH_EXPIRED'
        ? 'AUTH_401_TOKEN_EXPIRED'
        : sim === 'API_TIMEOUT'
        ? 'API_503_RATE_LIMIT'
        : undefined;
    const errorReason =
      sim === 'AUTH_EXPIRED'
        ? 'Google Sheets API 서비스 계정 OAuth 액세스 토큰 만료로 자동입력 실패 (중복 행 미생성 확인됨)'
        : sim === 'API_TIMEOUT'
        ? 'Google Sheets API 일시 응답 지연(Timeout)으로 자동입력 실패 — 재처리 대기'
        : undefined;

    setTransactions((prev) =>
      prev.map((item) =>
        item.id !== txId
          ? item
          : {
              ...item,
              status: nextStatus,
              approvalDate: systemReferenceDate,
              updatedAt: now,
              slip: {
                id: slipId,
                submittedBy: currentUser.id,
                submittedByName: currentUser.name,
                submittedAt: now,
                approvalNumber: input.approvalNumber.trim(),
                approvedDate: input.approvedDate || now,
                approvedAmount: Math.round(input.approvedAmount),
                merchantName: input.merchantName.trim() || '제휴 자동차 영업본부',
                fileName: input.fileName.trim(),
                fileSizeLabel: input.fileSizeLabel || '1.1 MB',
                memo: input.memo?.trim() || undefined,
              },
              sheetSync: {
                status: isSuccess ? 'SYNCED' : 'FAILED',
                externalRowId: isSuccess ? externalRowId : undefined,
                sheetTabName,
                lastAttemptAt: now,
                attemptCount: 1,
                errorCode,
                errorReason,
                idempotencyKey,
                retryHistory: [
                  {
                    id: `retry-${Date.now()}`,
                    attemptedAt: now,
                    actorName: '시스템 자동연동',
                    result: isSuccess ? 'SUCCESS' : 'FAILED',
                    message: isSuccess
                      ? `구글 시트 [${sheetTabName}] 탭 자동입력 완료 (행 식별자: ${externalRowId})`
                      : `[${errorCode}] ${errorReason}`,
                    externalRowId: isSuccess ? externalRowId : undefined,
                  },
                ],
              },
              history: [
                ...item.history,
                {
                  id: `hist-${Date.now()}`,
                  changedAt: now,
                  actorId: currentUser.id,
                  actorName: currentUser.name,
                  actorRole: currentUser.role,
                  previousStatus: item.status,
                  newStatus: nextStatus,
                  actionType: 'SLIP_SUBMITTED',
                  actionLabel: isSuccess
                    ? '거래 전표 제출 및 거래완료 전환'
                    : '거래 전표 제출 (시트 입력 재처리 필요)',
                  reasonOrNote: isSuccess
                    ? `승인번호 ${input.approvalNumber.trim()} · 구글 시트 행 ${externalRowId} 기록 및 거래완료 확정`
                    : `승인번호 ${input.approvalNumber.trim()} 전표 저장 완료 / 시트 연동 오류(${errorCode})로 AG·관리자 재처리 대기`,
                },
              ],
            }
      )
    );

    if (isSuccess) {
      pushToast({
        type: 'success',
        title: '전표 제출 및 거래완료 처리 완료',
        description: `외부 행 식별정보 ${externalRowId} 로 시트에 입력되었으며 상태가 [거래완료]로 전환되었습니다.`,
      });
    } else {
      pushToast({
        type: 'error',
        title: '전표는 저장되었으나 구글 시트 입력이 실패했습니다',
        description: `오류 코드: ${errorCode} — 담당 AG 또는 운영 관리자가 중복 없이 재처리할 수 있습니다.`,
      });
    }

    return { ok: true, message: '전표 제출이 처리되었습니다.' };
  };

  // 5.2.1 실패한 구글 시트 입력 재처리
  const retrySheetSync = (txId: string): ActionResult => {
    if (!currentUser || (currentUser.role !== 'AG' && currentUser.role !== 'ADMIN')) {
      return { ok: false, message: '담당 AG 또는 운영 관리자만 구글 시트 재처리를 실행할 수 있습니다.' };
    }
    const tx = transactions.find((t) => t.id === txId);
    if (!tx || !canAccessTransaction(tx)) {
      return { ok: false, message: '접근 권한이 없거나 존재하지 않는 거래입니다.' };
    }
    if (!tx.slip) {
      return { ok: false, message: '제출된 전표가 없는 거래입니다.' };
    }
    if (tx.sheetSync.status === 'SYNCED' && tx.sheetSync.externalRowId) {
      return {
        ok: false,
        message: `이미 구글 시트(${tx.sheetSync.externalRowId})에 정상 입력된 전표입니다.`,
      };
    }

    const now = nowFormatted();
    const idempotencyKey = tx.sheetSync.idempotencyKey || `${tx.id}:${tx.slip.id}`;
    const duplicateRowTx = transactions.find(
      (other) =>
        other.id !== tx.id &&
        other.sheetSync.status === 'SYNCED' &&
        other.sheetSync.idempotencyKey === idempotencyKey
    );
    const yyyymm = tx.createdAt.slice(0, 7).replace('-', '');
    const syncedCount = transactions.filter((t) => t.sheetSync.status === 'SYNCED').length;
    const assignedRowId =
      duplicateRowTx?.sheetSync.externalRowId ||
      `GS-${yyyymm}-ROW-${String(101 + syncedCount).padStart(4, '0')}`;
    const sheetTabName =
      tx.sheetSync.sheetTabName || `${yyyymm.slice(0, 4)}_${yyyymm.slice(4, 6)}_오토캐시백전표`;

    setTransactions((prev) =>
      prev.map((item) =>
        item.id !== txId
          ? item
          : {
              ...item,
              status: 'COMPLETED',
              updatedAt: now,
              sheetSync: {
                status: 'SYNCED',
                externalRowId: assignedRowId,
                sheetTabName,
                lastAttemptAt: now,
                attemptCount: item.sheetSync.attemptCount + 1,
                errorCode: undefined,
                errorReason: undefined,
                idempotencyKey,
                retryHistory: [
                  ...item.sheetSync.retryHistory,
                  {
                    id: `retry-${Date.now()}`,
                    attemptedAt: now,
                    actorName: `${currentUser.name} (${currentUser.role})`,
                    result: 'SUCCESS',
                    message: `기존 시트 대조 완료(중복 행 0건 확인, 키: ${idempotencyKey}) → ${assignedRowId} 행 입력 성공`,
                    externalRowId: assignedRowId,
                  },
                ],
              },
              history: [
                ...item.history,
                {
                  id: `hist-${Date.now()}`,
                  changedAt: now,
                  actorId: currentUser.id,
                  actorName: currentUser.name,
                  actorRole: currentUser.role,
                  previousStatus: item.status,
                  newStatus: 'COMPLETED',
                  actionType: 'SHEET_RETRIED',
                  actionLabel: '구글 시트 재처리 성공 (거래완료)',
                  reasonOrNote: `멱등키(${idempotencyKey}) 중복 대조 완료 후 행 ${assignedRowId} 정상 기록`,
                },
              ],
            }
      )
    );

    pushToast({
      type: 'success',
      title: '구글 시트 재처리 성공 (중복 방지 검증 완료)',
      description: `${tx.id} 전표가 ${assignedRowId} 행으로 정상 동기화되었습니다.`,
    });
    return { ok: true, message: `구글 시트 재처리 완료 (${assignedRowId})` };
  };

  // 6.1/6.2 수수료 산정 기준 누락 거래 확정 보완
  const fixTransactionCommissionRate = (
    txId: string,
    commissionRate: number,
    note?: string
  ): ActionResult => {
    if (!currentUser || (currentUser.role !== 'ADMIN' && currentUser.role !== 'AG')) {
      return { ok: false, message: '정산 관리 권한이 있는 담당자만 산정 기준을 확정할 수 있습니다.' };
    }
    const tx = transactions.find((t) => t.id === txId);
    if (!tx || !canAccessTransaction(tx)) {
      return { ok: false, message: '해당 거래에 대한 권한이 없습니다.' };
    }
    if (!Number.isFinite(commissionRate) || commissionRate < 0 || commissionRate > 10) {
      return { ok: false, message: '수수료율은 0% ~ 10% 사이의 유효한 숫자로 입력해 주세요.' };
    }

    const now = nowFormatted();
    const nextRate = Number(commissionRate.toFixed(2));
    setTransactions((prev) =>
      prev.map((item) =>
        item.id !== txId
          ? item
          : {
              ...item,
              updatedAt: now,
              paymentSplits: item.paymentSplits.map((s) => ({
                ...s,
                cmCommissionRate: nextRate,
              })),
              conditionSnapshot: {
                ...item.conditionSnapshot,
                cmCommissionRate: nextRate,
              },
              history: [
                ...item.history,
                {
                  id: `hist-${Date.now()}`,
                  changedAt: now,
                  actorId: currentUser.id,
                  actorName: currentUser.name,
                  actorRole: currentUser.role,
                  previousStatus: item.status,
                  newStatus: item.status,
                  actionType: 'COMMISSION_FIXED',
                  actionLabel: '정산 수수료 산정 기준 확정',
                  reasonOrNote: `CM 지급 수수료율 ${nextRate.toFixed(2)}% 확정${
                    note ? ` (${note.trim()})` : ''
                  }`,
                },
              ],
            }
      )
    );

    pushToast({
      type: 'success',
      title: '수수료 산정 기준이 확정되었습니다',
      description: `${tx.id} 거래의 CM 수수료율(${nextRate.toFixed(2)}%)이 월별 정산에 즉시 반영됩니다.`,
    });
    return { ok: true, message: '수수료 산정 기준이 저장되었습니다.' };
  };

  // [요구사항 1] 요율표 수정 기능은 ADMIN에게만 부여
  const addRateTableImage = (
    input: Omit<RateTableImageItem, 'id' | 'uploadedBy' | 'uploadedAt'>
  ): ActionResult => {
    if (!currentUser || currentUser.role !== 'ADMIN') {
      return { ok: false, message: '관리자(ADMIN)만 요율표 이미지를 등록·수정할 수 있습니다.' };
    }
    if (!input.title.trim() || !input.imageUrl.trim()) {
      return { ok: false, message: '요율표 제목과 이미지(파일 또는 URL)를 입력해 주세요.' };
    }
    const newItem: RateTableImageItem = {
      id: `rt-img-${Date.now()}`,
      title: input.title.trim(),
      cardCompanyTag: input.cardCompanyTag.trim() || '전 카드사',
      effectiveDate: input.effectiveDate || systemReferenceDate,
      imageUrl: input.imageUrl.trim(),
      note: input.note.trim(),
      uploadedBy: `${currentUser.name} (${currentUser.role})`,
      uploadedAt: nowFormatted(),
    };
    setRateTableImages((prev) => [newItem, ...prev]);
    pushToast({
      type: 'success',
      title: '요율표 이미지가 등록되었습니다',
      description: `${newItem.title} 이미지가 AG/CM 요율표 조회 화면에 즉시 게시되었습니다.`,
    });
    return { ok: true, message: '요율표 이미지가 등록되었습니다.' };
  };

  const deleteRateTableImage = (id: string): ActionResult => {
    if (!currentUser || currentUser.role !== 'ADMIN') {
      return { ok: false, message: '관리자(ADMIN)만 요율표 이미지를 삭제할 수 있습니다.' };
    }
    setRateTableImages((prev) => prev.filter((item) => item.id !== id));
    pushToast({
      type: 'info',
      title: '요율표 이미지 삭제 완료',
      description: '선택한 요율표 이미지가 목록에서 제거되었습니다.',
    });
    return { ok: true, message: '삭제되었습니다.' };
  };

  const saveRateTableRow = (
    input: Omit<RateTableRowItem, 'id'> & { id?: string }
  ): ActionResult => {
    if (!currentUser || currentUser.role !== 'ADMIN') {
      return { ok: false, message: '관리자(ADMIN)만 요율표 데이터를 등록·수정할 수 있습니다.' };
    }
    const isLumpSum = input.paymentMethod === '일시불';
    const normalizedRow: RateTableRowItem = {
      id: input.id || `rt-row-${Date.now()}`,
      cardCompany: input.cardCompany,
      paymentMethod: input.paymentMethod,
      category: (input.category || '기본').trim() || '기본',
      amountTier: input.amountTier.trim() || '전 구간',
      installmentMonths: isLumpSum ? '1달' : input.installmentMonths.trim() || '24 / 36 / 48개월',
      cashbackRate: isLumpSum ? Number((input.cashbackRate || 0).toFixed(2)) : 0,
      interestRate: isLumpSum ? 0 : Number((input.interestRate || 0).toFixed(2)),
      agCommissionRate: Number((input.agCommissionRate || 0).toFixed(2)),
      cmCommissionRate: Number((input.cmCommissionRate || 0).toFixed(2)),
      effectiveDate: input.effectiveDate || systemReferenceDate,
      remark: input.remark.trim(),
    };

    if (input.id) {
      setRateTableRows((prev) =>
        prev.map((r) => (r.id === input.id ? normalizedRow : r))
      );
      pushToast({
        type: 'success',
        title: '요율표 데이터 행 수정 완료',
        description: `${normalizedRow.cardCompany} · ${normalizedRow.paymentMethod} 요율 정보가 갱신되었습니다.`,
      });
    } else {
      setRateTableRows((prev) => [normalizedRow, ...prev]);
      pushToast({
        type: 'success',
        title: '요율표 신규 데이터 행 추가 완료',
        description: `${normalizedRow.cardCompany} · ${normalizedRow.paymentMethod} 요율이 추가되었습니다.`,
      });
    }
    return { ok: true, message: '요율표 데이터가 저장되었습니다.' };
  };

  const deleteRateTableRow = (id: string): ActionResult => {
    if (!currentUser || currentUser.role !== 'ADMIN') {
      return { ok: false, message: '관리자(ADMIN)만 요율표 데이터를 삭제할 수 있습니다.' };
    }
    setRateTableRows((prev) => prev.filter((r) => r.id !== id));
    pushToast({
      type: 'info',
      title: '요율표 데이터 행 삭제 완료',
    });
    return { ok: true, message: '삭제되었습니다.' };
  };

  // [요구사항 1 & 2] 카드사 별 프로모션 추가·수정·삭제 (ADMIN 전용 + 캐시백/금리/AG/CM ±% 마이너스 반영 지원)
  const saveCardPromotion = (
    input: Omit<CardPromotionItem, 'id' | 'updatedAt'> & { id?: string }
  ): ActionResult => {
    if (!currentUser || currentUser.role !== 'ADMIN') {
      return { ok: false, message: '관리자(ADMIN)만 카드사 프로모션을 등록·수정할 수 있습니다.' };
    }
    if (!input.title.trim()) {
      return { ok: false, message: '프로모션 제목을 입력해 주세요.' };
    }
    const now = nowFormatted();
    const normalizedPromo: CardPromotionItem = {
      id: input.id || `promo-${Date.now()}`,
      cardCompany: input.cardCompany,
      title: input.title.trim(),
      startDate: input.startDate || systemReferenceDate,
      endDate: input.endDate && input.endDate.trim() ? input.endDate.trim() : null,
      paymentMethod: input.paymentMethod,
      minAmount: Math.max(0, Math.round(input.minAmount || 0)),
      maxAmount:
        input.maxAmount && input.maxAmount > 0 ? Math.round(input.maxAmount) : null,
      amountConditionLabel:
        input.amountConditionLabel.trim() ||
        `${((input.minAmount || 0) / 10000).toLocaleString()}만원 이상`,
      cashbackRateDelta: Number((Number(input.cashbackRateDelta) || 0).toFixed(2)),
      interestRateDelta: Number((Number(input.interestRateDelta) || 0).toFixed(2)),
      agIncentiveRate: Number((Number(input.agIncentiveRate) || 0).toFixed(2)),
      cmIncentiveRate: Number((Number(input.cmIncentiveRate) || 0).toFixed(2)),
      agIncentiveAmount: Math.round(Number(input.agIncentiveAmount) || 0),
      cmIncentiveAmount: Math.round(Number(input.cmIncentiveAmount) || 0),
      promotionConditionText: input.promotionConditionText.trim(),
      isActive: input.isActive,
      updatedAt: now,
    };

    if (input.id) {
      setCardPromotions((prev) =>
        prev.map((p) => (p.id === input.id ? normalizedPromo : p))
      );
      pushToast({
        type: 'success',
        title: '카드사 프로모션 수정 완료',
        description: `[${normalizedPromo.cardCompany}] ${normalizedPromo.title} 프로모션이 갱신되었습니다.`,
      });
    } else {
      setCardPromotions((prev) => [normalizedPromo, ...prev]);
      pushToast({
        type: 'success',
        title: '신규 카드사 프로모션 등록 완료',
        description: `[${normalizedPromo.cardCompany}] ${normalizedPromo.title} 프로모션이 추가되었습니다.`,
      });
    }
    return { ok: true, message: '프로모션이 저장되었습니다.' };
  };

  const deleteCardPromotion = (id: string): ActionResult => {
    if (!currentUser || currentUser.role !== 'ADMIN') {
      return { ok: false, message: '관리자(ADMIN)만 프로모션을 삭제할 수 있습니다.' };
    }
    setCardPromotions((prev) => prev.filter((p) => p.id !== id));
    pushToast({
      type: 'info',
      title: '카드사 프로모션 삭제 완료',
    });
    return { ok: true, message: '삭제되었습니다.' };
  };

  // 1.2.1 사용자 계정과 역할 관리 (CM 주민등록번호, 사업자등록번호, 사번 포함!)
  const saveUserAccount = (input: SaveUserInput): ActionResult => {
    if (!currentUser || (currentUser.role !== 'ADMIN' && currentUser.role !== 'AG')) {
      return { ok: false, message: '계정 관리 권한이 없습니다.' };
    }
    if (!input.name.trim()) {
      return { ok: false, message: '성명(이름)을 입력해 주세요.' };
    }

    const resolvedAffiliation = input.affiliation.trim() || '제휴 대리점';
    const resolvedLoginId =
      input.loginId.trim() || `cm.${Date.now()}@autodealer.kr`;
    const normalizedLoginId = resolvedLoginId.toLowerCase();
    const duplicate = users.find(
      (u) => u.loginId.toLowerCase() === normalizedLoginId && u.id !== input.id
    );
    if (duplicate) {
      return {
        ok: false,
        message: `이미 등록된 로그인 식별정보(${resolvedLoginId})입니다. 중복 계정은 등록할 수 없습니다.`,
      };
    }

    if (input.id) {
      let updatedUserRef: User | null = null;
      const nextUsers = users.map((u) => {
        if (u.id !== input.id) return u;
        const nextUser: User = {
          ...u,
          loginId: resolvedLoginId,
          name: input.name.trim(),
          role: input.role,
          affiliation: resolvedAffiliation,
          phone: input.phone.trim(),
          rrn: input.rrn?.trim() || u.rrn,
          businessNumber: input.businessNumber?.trim() || u.businessNumber,
          employeeId: input.employeeId?.trim() || u.employeeId,
          isActive: input.isActive,
          password: input.password?.trim() ? input.password.trim() : u.password,
        };
        updatedUserRef = nextUser;
        return nextUser;
      });
      setUsers(nextUsers);
      pushAllMasterTabsToGoogleSheet(`${input.role} 정보 수정`, nextUsers);

      // CM 기본정보가 수정되면 해당 CM의 거래 내역 cmProfile도 최신 등록 정보로 동기화
      if (updatedUserRef && (updatedUserRef as User).role === 'CM') {
        const snapshot = buildCmSnapshotFromUser(updatedUserRef as User);
        setTransactions((prev) =>
          prev.map((tx) => (tx.cmId === input.id ? { ...tx, cmProfile: snapshot } : tx))
        );
      }

      pushToast({
        type: 'success',
        title: `${input.role} 정보가 저장되었습니다`,
        description: `${input.name} (${resolvedAffiliation}) 정보가 갱신되었습니다.`,
      });
      return { ok: true, message: `${input.role} 정보가 수정되었습니다.` };
    } else {
      const newId = `usr-${input.role.toLowerCase()}-${Date.now()}`;
      const newUser: User = {
        id: newId,
        loginId: resolvedLoginId,
        password: input.password?.trim() || 'password123',
        name: input.name.trim(),
        role: input.role,
        affiliation: resolvedAffiliation,
        phone: input.phone.trim() || '010-0000-0000',
        rrn: input.rrn?.trim() || (input.role === 'CM' ? '900101-1234567' : undefined),
        businessNumber:
          input.businessNumber?.trim() || (input.role === 'CM' ? '214-88-10293' : undefined),
        employeeId:
          input.employeeId?.trim() ||
          `${input.role}-${String(users.length + 1).padStart(4, '0')}`,
        isActive: input.isActive,
        createdAt: nowFormatted(),
      };
      const nextUsers = [...users, newUser];
      setUsers(nextUsers);
      pushAllMasterTabsToGoogleSheet(`신규 ${input.role} 등록`, nextUsers);

      if (input.role === 'CM' && currentUser.role === 'AG') {
        setAssignments((prev) => [
          ...prev,
          {
            agId: currentUser.id,
            cmId: newId,
            updatedAt: nowFormatted(),
            updatedBy: currentUser.name,
          },
        ]);
      }

      pushToast({
        type: 'success',
        title: `${input.role} 등록 완료`,
        description: `${newUser.name} (${resolvedAffiliation}) 정보가 저장되었습니다.`,
      });
      return { ok: true, message: `신규 ${input.role} 정보가 등록되었습니다.` };
    }
  };

  // [요구사항] ADMIN 전용: 이미 등록되어 있는 AG 및 CM 데이터 삭제
  const deleteUserAccount = (userId: string): ActionResult => {
    if (!currentUser || currentUser.role !== 'ADMIN') {
      return {
        ok: false,
        message: '관리자(ADMIN)만 등록된 AG 및 CM 데이터를 삭제할 수 있습니다.',
      };
    }

    const target = users.find((u) => u.id === userId);
    if (!target) {
      return { ok: false, message: '삭제할 AG 또는 CM 데이터를 찾을 수 없습니다.' };
    }

    if (target.role === 'ADMIN') {
      return { ok: false, message: '관리자(ADMIN) 계정은 삭제할 수 없습니다.' };
    }

    const nextUsers = users.filter((u) => u.id !== userId);
    setUsers(nextUsers);
    setAssignments((prev) =>
      prev.filter((a) => a.agId !== userId && a.cmId !== userId)
    );

    if (currentUserId === userId) {
      setCurrentUserId(currentUser.id);
    }

    pushAllMasterTabsToGoogleSheet('사용자 계정 삭제', nextUsers);

    pushToast({
      type: 'info',
      title: `${target.role} 데이터 삭제 완료`,
      description: `${target.name} (${target.affiliation}) 데이터가 삭제되었습니다.`,
    });
    return { ok: true, message: `${target.name} (${target.role}) 데이터가 삭제되었습니다.` };
  };

  // 1.2.2 AG 담당 CM 배정
  const saveAgAssignments = (agId: string, cmIds: string[]): ActionResult => {
    if (!currentUser || (currentUser.role !== 'ADMIN' && currentUser.role !== 'AG')) {
      return { ok: false, message: '담당 CM 배정 변경 권한이 없습니다.' };
    }
    const agUser = users.find((u) => u.id === agId && u.role === 'AG');
    if (!agUser) {
      return { ok: false, message: '유효한 AG 계정을 선택해 주세요.' };
    }

    const validCmSet = new Set(
      cmIds.filter((cmId) => users.some((u) => u.id === cmId && u.role === 'CM'))
    );
    const now = nowFormatted();

    setAssignments((prev) => {
      const remaining = prev.filter((a) => a.agId !== agId && !validCmSet.has(a.cmId));
      const added: AgCmAssignment[] = Array.from(validCmSet).map((cmId) => ({
        agId,
        cmId,
        updatedAt: now,
        updatedBy: currentUser.name,
      }));
      return [...remaining, ...added];
    });

    pushToast({
      type: 'success',
      title: '담당 CM 배정이 저장되었습니다',
      description: `${agUser.name} AG에게 총 ${validCmSet.size}명의 담당 CM 범위가 즉시 적용되었습니다.`,
    });
    return { ok: true, message: '담당 CM 배정이 저장되었습니다.' };
  };

  // 2.2 카드사·거래 방법별 거래 조건 수동 저장 (실행일자 기준 그룹 종료일 자동 정렬)
  const saveDealCondition = (input: SaveConditionInput): ActionResult => {
    if (!currentUser || (currentUser.role !== 'ADMIN' && currentUser.role !== 'AG')) {
      return { ok: false, message: '거래 조건 관리 권한이 없습니다.' };
    }
    if (!input.title.trim()) {
      return { ok: false, message: '거래 조건명을 입력해 주세요.' };
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveFrom)) {
      return { ok: false, message: '실행일자를 YYYY-MM-DD 형식으로 입력해 주세요.' };
    }

    const now = nowFormatted();
    if (input.id) {
      setConditions((prev) =>
        reconcileConditionGroupDates(
          prev.map((c) =>
            c.id !== input.id
              ? c
              : {
                  ...c,
                  conditionGroupCode: input.conditionGroupCode.trim(),
                  versionNo: input.versionNo,
                  effectiveFrom: input.effectiveFrom,
                  effectiveTo: input.effectiveTo,
                  cardCompany: input.cardCompany,
                  paymentMethod: input.paymentMethod,
                  channelType: input.channelType,
                  cardKind: input.cardKind,
                  installmentTerms: input.installmentTerms.trim(),
                  downPaymentRule: input.downPaymentRule.trim(),
                  minAmount: input.minAmount,
                  maxAmount: input.maxAmount,
                  title: input.title.trim(),
                  customerCashbackRate: input.customerCashbackRate,
                  cmCommissionRate: input.cmCommissionRate,
                  description: input.description.trim(),
                  isActive: input.isActive,
                  updatedAt: now,
                }
          )
        )
      );
      pushToast({
        type: 'success',
        title: '거래 조건 및 실행일자가 저장되었습니다',
        description: '새 실행일자 전까지는 이전 조건이 자동 유지됩니다.',
      });
      return { ok: true, message: '거래 조건이 수정되었습니다.' };
    } else {
      const newCond: DealCondition = {
        id: `cond-${Date.now()}`,
        conditionGroupCode:
          input.conditionGroupCode.trim() ||
          `${input.cardCompany.slice(0, 2)}-${Date.now().toString().slice(-4)}`,
        versionNo: input.versionNo || 1,
        effectiveFrom: input.effectiveFrom,
        effectiveTo: input.effectiveTo,
        cardCompany: input.cardCompany,
        paymentMethod: input.paymentMethod,
        channelType: input.channelType,
        cardKind: input.cardKind,
        installmentTerms: input.installmentTerms.trim() || '일시불',
        downPaymentRule: input.downPaymentRule.trim() || '선수금 제한 없음',
        minAmount: input.minAmount,
        maxAmount: input.maxAmount,
        title: input.title.trim(),
        customerCashbackRate: input.customerCashbackRate,
        cmCommissionRate: input.cmCommissionRate,
        description: input.description.trim(),
        isActive: input.isActive,
        updatedAt: now,
      };
      setConditions((prev) => reconcileConditionGroupDates([newCond, ...prev]));
      pushToast({
        type: 'success',
        title: '신규 거래 조건 버전 등록 완료',
        description: `실행일자(${newCond.effectiveFrom}) 기준 이전 조건 종료일이 자동 조정되었습니다.`,
      });
      return { ok: true, message: '신규 거래 조건이 추가되었습니다.' };
    }
  };

  const toggleConditionActive = (conditionId: string): ActionResult => {
    if (!currentUser || (currentUser.role !== 'ADMIN' && currentUser.role !== 'AG')) {
      return { ok: false, message: '거래 조건 관리 권한이 없습니다.' };
    }
    const target = conditions.find((c) => c.id === conditionId);
    if (!target) return { ok: false, message: '존재하지 않는 조건입니다.' };

    const nextActive = !target.isActive;
    setConditions((prev) =>
      reconcileConditionGroupDates(
        prev.map((c) =>
          c.id !== conditionId ? c : { ...c, isActive: nextActive, updatedAt: nowFormatted() }
        )
      )
    );
    pushToast({
      type: 'info',
      title: nextActive ? '조건 사용 활성화' : '조건 수동 중단(비활성화)',
      description: `${target.title} 상태가 갱신되었으며 동일 그룹 조건 유효기간이 재정렬되었습니다.`,
    });
    return { ok: true, message: '상태가 변경되었습니다.' };
  };

  // 구글 시트로부터 거래조건 일괄 동기화 (Upsert + 실행일자 기준 이전 조건 종료일 자동 산출)
  const syncConditionsFromSheet = (
    rows: ParsedSheetConditionRow[],
    sourceLabel: string
  ): ActionResult => {
    if (!currentUser || (currentUser.role !== 'ADMIN' && currentUser.role !== 'AG')) {
      return { ok: false, message: '시트 동기화 권한이 없습니다.' };
    }
    if (rows.length === 0) {
      return { ok: false, message: '동기화할 조건 행이 없습니다.' };
    }

    const now = nowFormatted();
    let addedCount = 0;
    let updatedCount = 0;

    setConditions((prev) => {
      const next = [...prev];

      rows.forEach((row, idx) => {
        const existingIndex = next.findIndex(
          (c) =>
            (row.sheetRowId && c.sheetRowId === row.sheetRowId) ||
            (c.conditionGroupCode === row.conditionGroupCode &&
              c.effectiveFrom === row.effectiveFrom)
        );

        if (existingIndex >= 0) {
          updatedCount += 1;
          next[existingIndex] = {
            ...next[existingIndex],
            ...row,
            lastSyncedAt: now,
            updatedAt: now,
          };
        } else {
          addedCount += 1;
          next.unshift({
            id: `cond-sync-${Date.now()}-${idx}`,
            conditionGroupCode: row.conditionGroupCode,
            versionNo: row.versionNo,
            effectiveFrom: row.effectiveFrom,
            effectiveTo: null,
            cardCompany: row.cardCompany,
            paymentMethod: row.paymentMethod,
            channelType: row.channelType,
            cardKind: row.cardKind,
            installmentTerms: row.installmentTerms,
            downPaymentRule: row.downPaymentRule,
            minAmount: row.minAmount,
            maxAmount: row.maxAmount,
            title: row.title,
            customerCashbackRate: row.customerCashbackRate,
            cmCommissionRate: row.cmCommissionRate,
            description: row.description,
            isActive: row.isActive,
            sheetRowId: row.sheetRowId,
            lastSyncedAt: now,
            updatedAt: now,
          });
        }
      });

      return reconcileConditionGroupDates(next);
    });

    const summaryText = rows
      .map((r) => `${r.cardCompany}(${r.effectiveFrom} 실행, ${r.customerCashbackRate}%)`)
      .join(', ');

    setConditionSyncLogs((prev) => [
      {
        id: `csync-${Date.now()}`,
        syncedAt: now,
        actorName: `${currentUser.name} (${currentUser.role})`,
        sourceLabel,
        addedCount,
        updatedCount,
        summary: `신규 ${addedCount}건 · 갱신 ${updatedCount}건 반영 — ${summaryText}`,
      },
      ...prev,
    ]);

    pushToast({
      type: 'success',
      title: `구글 시트 거래조건 동기화 완료 (신규 ${addedCount} · 갱신 ${updatedCount})`,
      description: '각 카드사별 실행일자 전까지는 기존 조건이 자동 유지되도록 종료일자가 설정되었습니다.',
    });

    return {
      ok: true,
      message: `신규 ${addedCount}건, 업데이트 ${updatedCount}건 동기화 완료`,
    };
  };

  // 웹앱 데이터 변경 시 구글 시트에 자동 저장. 시트 로드 전에는 절대 쓰지 않고, 바뀐 게 없으면 건너뜀.
  useEffect(() => {
    if (!isSheetReady) return;
    const timer = window.setTimeout(async () => {
      const batchOps = buildMasterBatchOps(rateTableRows, cardPromotions, transactions, users);
      if (JSON.stringify(batchOps) === lastPushedKeyRef.current) return;
      try {
        await pushBatchToSheet(batchOps);
      } catch (err) {
        pushToast({
          type: 'error',
          title: '구글 시트 자동 저장 실패',
          description: err instanceof Error ? err.message : String(err),
        });
      }
    }, 500);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSheetReady, rateTableRows, cardPromotions, transactions, users]);

  const pushAllMasterTabsToGoogleSheet = async (
    scopeLabel = '통합 마스터시트 5개 탭 전체',
    explicitUsers?: User[],
    explicitTransactions?: Transaction[],
    explicitRateRows?: RateTableRowItem[],
    explicitPromotions?: CardPromotionItem[]
  ): Promise<ActionResult> => {
    if (!isSheetReady) {
      pushToast({
        type: 'error',
        title: '구글 시트 저장 불가',
        description: '시트를 아직 불러오지 못했습니다. [시트 불러오기]를 먼저 성공시킨 뒤 다시 시도해 주세요.',
      });
      return { ok: false, message: '시트 미연결 상태에서는 저장할 수 없습니다.' };
    }
    setIsSyncingMasterSheet(true);
    const now = nowFormatted();
    const targetUsers = explicitUsers ?? users;
    const targetTransactions = explicitTransactions ?? transactions;
    const targetRates = explicitRateRows ?? rateTableRows;
    const targetPromos = explicitPromotions ?? cardPromotions;

    try {
      await pushBatchToSheet(
        buildMasterBatchOps(targetRates, targetPromos, targetTransactions, targetUsers)
      );

      // 거래내역의 시트 동기화 상태도 최신 마스터 시트 기준으로 갱신
      setTransactions((prev) =>
        prev.map((tx, idx) => ({
          ...tx,
          sheetSync: {
            ...tx.sheetSync,
            status: tx.slip
              ? tx.sheetSync.status === 'FAILED'
                ? 'FAILED'
                : 'SYNCED'
              : tx.sheetSync.status,
            sheetTabName: tx.sheetSync.sheetTabName || '07_거래내역_통합마스터',
            externalRowId: tx.sheetSync.externalRowId || `ROW-07-${idx + 2}`,
            syncedAt: now,
          },
        }))
      );

      setLastMasterSheetSyncedAt(now);
      localStorage.setItem('kanadara_v5_master_sheet_synced_at', now);

      setConditionSyncLogs((prev) => [
        {
          id: `msync-${Date.now()}`,
          syncedAt: now,
          actorName: currentUser ? `${currentUser.name} (${currentUser.role})` : 'SYSTEM',
          sourceLabel: `${GOOGLE_MASTER_SPREADSHEET_TITLE} (${scopeLabel})`,
          addedCount: rateTableRows.length + cardPromotions.length,
          updatedCount: transactions.length + users.length,
          summary: `[구글 시트 마스터 Push 완료] 05_요율표(${rateTableRows.length}행) · 06_프로모션(${cardPromotions.length}행) · 07_거래내역(${transactions.length}건) · 09_사용자_CM(${users.length}명) 실시간 반영`,
        },
        ...prev,
      ]);

      pushToast({
        type: 'success',
        title: '구글 시트 통합 마스터 동기화(Push) 완료',
        description: `05_요율표(${rateTableRows.length}행) · 06_프로모션(${cardPromotions.length}건) · 07_거래내역(${transactions.length}건) · 09_사용자_CM(${users.length}명) 데이터가 시트에 저장되었습니다.`,
      });

      return {
        ok: true,
        message: `구글 시트(${GOOGLE_MASTER_SPREADSHEET_ID}) 동기화 완료`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      pushToast({ type: 'error', title: '구글 시트 저장 실패', description: message });
      return { ok: false, message };
    } finally {
      setIsSyncingMasterSheet(false);
    }
  };

  const pullRateAndPromotionsFromGoogleSheet = async (silent = false): Promise<ActionResult> => {
    if (!currentUser || (currentUser.role !== 'ADMIN' && currentUser.role !== 'AG')) {
      return {
        ok: false,
        message: 'AG 또는 관리자(ADMIN)만 구글 시트에서 조건·요율표를 불러올 수 있습니다.',
      };
    }

    setIsSyncingMasterSheet(true);
    try {
      const counts = await loadFromSheet();
      const now = nowFormatted();
      setLastMasterSheetSyncedAt(now);
      localStorage.setItem('kanadara_v5_master_sheet_synced_at', now);
      if (!silent) {
        pushToast({
          type: 'success',
          title: '시트 > 웹앱 불러오기(Pull) 완료',
          description: `05_요율표(${counts.rates}행) · 06_프로모션(${counts.promos}건) · 07_거래내역(${counts.txs}건) · 09_사용자(${counts.users}명)을 시트에서 불러왔습니다.`,
        });
      }
      return { ok: true, message: '구글 시트에서 최신 데이터를 불러왔습니다.' };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!silent) {
        pushToast({ type: 'error', title: '구글 시트 불러오기 실패', description: message });
      }
      return { ok: false, message };
    } finally {
      setIsSyncingMasterSheet(false);
    }
  };

  const importRateTableRowsFromSheetTsv = (
    rawTsv: string,
    mode: 'MERGE' | 'REPLACE'
  ): ActionResult => {
    if (!currentUser || (currentUser.role !== 'ADMIN' && currentUser.role !== 'AG')) {
      return { ok: false, message: 'AG 또는 관리자(ADMIN)만 요율표 시트 데이터를 반영할 수 있습니다.' };
    }
    const { rows, errors } = parseRateTableFromTsv(rawTsv);
    if (rows.length === 0) {
      return {
        ok: false,
        message:
          errors.length > 0
            ? errors.join(', ')
            : '유효한 요율표 행을 찾지 못했습니다. 05_요율표_마스터 시트 행을 복사해 붙여넣어 주세요.',
      };
    }

    const now = nowFormatted();
    if (mode === 'REPLACE') {
      setRateTableRows(rows);
    } else {
      setRateTableRows((prev) => {
        const next = [...prev];
        rows.forEach((incoming) => {
          const idx = next.findIndex((r) => r.id === incoming.id);
          if (idx >= 0) {
            next[idx] = incoming;
          } else {
            next.unshift(incoming);
          }
        });
        return next;
      });
    }

    setLastMasterSheetSyncedAt(now);
    localStorage.setItem('kanadara_v5_master_sheet_synced_at', now);
    pushToast({
      type: 'success',
      title: `05_요율표_마스터 시트 데이터 ${rows.length}행 반영 완료`,
      description:
        mode === 'REPLACE'
          ? '시트 데이터로 전체 요율표가 교체되었습니다.'
          : '기존 요율표에 신규/수정 행이 병합(Upsert)되었습니다.',
    });
    return { ok: true, message: `${rows.length}행 반영 완료` };
  };

  const importPromotionsFromSheetTsv = (
    rawTsv: string,
    mode: 'MERGE' | 'REPLACE'
  ): ActionResult => {
    if (!currentUser || (currentUser.role !== 'ADMIN' && currentUser.role !== 'AG')) {
      return { ok: false, message: 'AG 또는 관리자(ADMIN)만 프로모션 시트 데이터를 반영할 수 있습니다.' };
    }
    const { promotions, errors } = parsePromotionsFromTsv(rawTsv);
    if (promotions.length === 0) {
      return {
        ok: false,
        message:
          errors.length > 0
            ? errors.join(', ')
            : '유효한 프로모션 행을 찾지 못했습니다. 06_카드사별_프로모션_마스터 시트 행을 복사해 붙여넣어 주세요.',
      };
    }

    const now = nowFormatted();
    if (mode === 'REPLACE') {
      setCardPromotions(promotions);
    } else {
      setCardPromotions((prev) => {
        const next = [...prev];
        promotions.forEach((incoming) => {
          const idx = next.findIndex((p) => p.id === incoming.id);
          if (idx >= 0) {
            next[idx] = incoming;
          } else {
            next.unshift(incoming);
          }
        });
        return next;
      });
    }

    setLastMasterSheetSyncedAt(now);
    localStorage.setItem('kanadara_v5_master_sheet_synced_at', now);
    pushToast({
      type: 'success',
      title: `06_카드사별_프로모션_마스터 시트 데이터 ${promotions.length}건 반영 완료`,
      description: '캐시백/금리/AG/CM ±% 마이너스 요율 조정을 포함한 프로모션이 즉시 적용되었습니다.',
    });
    return { ok: true, message: `${promotions.length}건 반영 완료` };
  };

  const saveDraftV2 = (
    draft: Omit<TransactionDraftV2, 'id' | 'savedAt'> & { id?: string }
  ): TransactionDraftV2 => {
    const now = nowFormatted();
    const savedItem: TransactionDraftV2 = {
      ...draft,
      id: draft.id || `draft-v2-${Date.now()}`,
      savedAt: now,
    };
    setDraftsV2((prev) => {
      const filtered = prev.filter((d) => d.id !== savedItem.id);
      return [savedItem, ...filtered];
    });
    pushToast({
      type: 'success',
      title: '작성 중인 거래 내역이 임시 저장되었습니다',
      description: `${savedItem.title} (${now})`,
    });
    return savedItem;
  };

  const deleteDraftV2 = (id: string) => {
    setDraftsV2((prev) => prev.filter((d) => d.id !== id));
    pushToast({
      type: 'info',
      title: '임시 저장 항목이 삭제되었습니다',
    });
  };

  const deleteTransaction = (txId: string): ActionResult => {
    const existing = transactions.find((t) => t.id === txId);
    if (!existing) {
      return { ok: false, message: '삭제할 거래를 찾을 수 없습니다.' };
    }
    setTransactions((prev) => prev.filter((t) => t.id !== txId));
    pushToast({
      type: 'info',
      title: `거래(${txId})가 삭제되었습니다`,
      description: `고객: ${existing.customerName}`,
    });
    return { ok: true, message: '삭제되었습니다.' };
  };

  const resetDemoData = () => {
    setUsers(INITIAL_USERS);
    setAssignments(INITIAL_ASSIGNMENTS);
    setConditions(reconcileConditionGroupDates(INITIAL_CONDITIONS));
    setConditionSyncLogs(INITIAL_CONDITION_SYNC_LOGS);
    setTransactions([]);
    setDraftsV2([]);
    setRateTableImages(INITIAL_RATE_TABLE_IMAGES);
    setRateTableRows(INITIAL_RATE_TABLE_ROWS);
    setCardPromotions(INITIAL_CARD_PROMOTIONS);
    setSystemReferenceDateState(DEFAULT_REFERENCE_DATE);
    pushToast({
      type: 'info',
      title: '데이터가 초기화되었습니다',
      description: '거래 및 임시저장 내역이 모두 초기화되었습니다.',
    });
  };

  return (
    <AppContext.Provider
      value={{
        currentUser,
        users,
        assignments,
        conditions,
        conditionSyncLogs,
        transactions,
        rateTableImages,
        rateTableRows,
        cardPromotions,
        isRateTableSplitOpen,
        setRateTableSplitOpen,
        toggleRateTableSplit,
        systemReferenceDate,
        setSystemReferenceDate,
        toasts,
        pushToast,
        dismissToast,
        login,
        quickSwitchUser,
        logout,
        getUserById,
        getAssignedAgForCm,
        getAssignedCmsForAg,
        canAccessTransaction,
        canManageApprovalOf,
        accessibleTransactions,
        getEffectiveConditionForGroup,
        getScheduledNextConditionForGroup,
        saveAgTransactionRequest,
        quickChangeTransactionStatus,
        quickChangeTransactionSettlementStatus,
        bulkUpdateTransactionsV2,
        registerTransaction,
        submitSlip,
        startReview,
        recordCardApplication,
        decideApproval,
        retrySheetSync,
        fixTransactionCommissionRate,
        addRateTableImage,
        deleteRateTableImage,
        saveRateTableRow,
        deleteRateTableRow,
        saveCardPromotion,
        deleteCardPromotion,
        saveUserAccount,
        deleteUserAccount,
        saveAgAssignments,
        saveDealCondition,
        toggleConditionActive,
        syncConditionsFromSheet,
        lastMasterSheetSyncedAt,
        isSyncingMasterSheet,
        isSheetReady,
        isAuthReady,
        pushAllMasterTabsToGoogleSheet,
        pullRateAndPromotionsFromGoogleSheet,
        importRateTableRowsFromSheetTsv,
        importPromotionsFromSheetTsv,
        appVersion,
        setAppVersion,
        draftsV2,
        saveDraftV2,
        deleteDraftV2,
        editingTxIdV2,
        setEditingTxIdV2,
        pendingDraftIdV2,
        setPendingDraftIdV2,
        deleteTransaction,
        resetDemoData,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}
