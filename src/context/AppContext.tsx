import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppliedPromotionSnapshot,
  APPROVAL_STATUS_META,
  ApprovalStatus,
  CardPromotionItem,
  CmProfileSnapshot,
  ConditionSnapshot,
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
  INITIAL_CARD_PROMOTIONS,
  INITIAL_RATE_TABLE_IMAGES,
  INITIAL_RATE_TABLE_ROWS,
  INITIAL_USERS,
} from '../data/mockData';
import {
  calcSplitTotals,
  mapSplitCardToCardCompany,
  nowFormatted,
} from '../utils/format';
import {
  GOOGLE_SHEET_TABS,
  buildMasterBatchOps,
  parsePromotionsFrom2D,
  parsePromotionsFromTsv,
  parseRateTableFrom2D,
  parseRateTableFromTsv,
  parseRateImagesFrom2D,
  parseTransactionsFrom2D,
  RATE_IMAGE_TAB,
  parseUsersFrom2D,
} from '../constants/googleSheetConfig';
import { prepareImageUpload } from '../utils/image';

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info';
  title: string;
  description?: string;
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

interface ActionResult {
  ok: boolean;
  message: string;
  transactionId?: string;
}

interface AppContextValue {
  currentUser: User | null;
  users: User[];
  transactions: Transaction[];
  rateTableImages: RateTableImageItem[];
  rateTableRows: RateTableRowItem[];
  cardPromotions: CardPromotionItem[];
  isRateTableSplitOpen: boolean;
  setRateTableSplitOpen: (open: boolean) => void;
  toasts: ToastMessage[];
  pushToast: (toast: Omit<ToastMessage, 'id'>) => void;
  dismissToast: (id: string) => void;

  // Auth
  login: (loginId: string, password: string) => Promise<ActionResult>;
  isAuthReady: boolean;
  quickSwitchUser: (userId: string) => void;
  logout: () => Promise<void>;

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

  // Rate Table (이미지 / 데이터 표) & Card Promotions Admin management
  addRateTableImage: (input: {
    title: string;
    cardCompanyTag: string;
    effectiveDate: string;
    note: string;
    file?: File | null;
    externalUrl?: string;
  }) => Promise<ActionResult>;
  deleteRateTableImage: (id: string) => Promise<ActionResult>;
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
  /** 다른 사람이 바꾼 내용을 시트에서 다시 불러옴 (저장 안 된 변경이 있으면 건너뜀) */
  refreshFromSheet: (silent?: boolean) => Promise<ActionResult>;
}

const STORAGE_KEYS = {
  CURRENT_USER_ID: 'kanadara_v6_session_user_id',
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
    // 거래(CM 주민번호 포함)·계정·요율은 로그인 후 시트에서만 받음 → 예전 버전이 남긴 사본 삭제
    [
      'kanadara_v6_users', 'kanadara_v6_transactions', 'kanadara_v6_assignments',
      'kanadara_v5_conditions', 'kanadara_v5_condition_sync_logs', 'kanadara_v5_rate_images',
      'kanadara_v5_rate_rows', 'kanadara_v5_card_promos', 'kanadara_v5_ref_date',
      'kanadara_v5_app_version', 'kanadara_v2_clean_dummy_20261110',
    ].forEach((key) => window.localStorage.removeItem(key));
  }
} catch {}

const AppContext = createContext<AppContextValue | undefined>(undefined);

const sheetTabOf = (range: string) => range.replace(/'/g, '').split('!')[0];

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
    rrn: cmUser.rrn || '',
    businessNumber: cmUser.businessNumber || '',
    phone: cmUser.phone || '',
    affiliation: cmUser.affiliation || '',
    employeeId: cmUser.employeeId || '',
  };
}

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // 계정 목록은 로그인 후 시트(서버)에서만 받아오며 브라우저에 저장하지 않음 (비밀번호 제외)
  const [users, setUsers] = useState<User[]>(INITIAL_USERS);
  // 거래는 CM 주민번호를 담고 있어 브라우저에 저장하지 않음 (로그인 후 시트에서 받아옴)
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  // 요율표 이미지: 시트 10 탭 + Drive에 저장 → 로그인한 모든 AG가 같은 목록을 봄
  const [rateTableImages, setRateTableImages] = useState<RateTableImageItem[]>(INITIAL_RATE_TABLE_IMAGES);
  // 요율표·프로모션은 구글 시트가 원본 → 로그인 후 시트에서만 받아옴 (브라우저 저장 안 함)
  const [rateTableRows, setRateTableRows] = useState<RateTableRowItem[]>(INITIAL_RATE_TABLE_ROWS);
  const [cardPromotions, setCardPromotions] = useState<CardPromotionItem[]>(INITIAL_CARD_PROMOTIONS);
  const [draftsV2, setDraftsV2] = useState<TransactionDraftV2[]>(() =>
    loadStorage(STORAGE_KEYS.DRAFTS_V2, [])
  );
  const [editingTxIdV2, setEditingTxIdV2] = useState<string | null>(null);
  const [pendingDraftIdV2, setPendingDraftIdV2] = useState<string | null>(null);
  const [isRateTableSplitOpen, setRateTableSplitOpen] = useState<boolean>(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(() => {
    return sessionStorage.getItem(STORAGE_KEYS.CURRENT_USER_ID) || null;
  });
  const [lastMasterSheetSyncedAt, setLastMasterSheetSyncedAt] = useState<string>(
    () => localStorage.getItem('kanadara_v5_master_sheet_synced_at') || ''
  );
  const [isSyncingMasterSheet, setIsSyncingMasterSheet] = useState<boolean>(false);
  const markSheetSynced = (at: string) => {
    setLastMasterSheetSyncedAt(at);
    localStorage.setItem('kanadara_v5_master_sheet_synced_at', at);
  };
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  // 시트를 정상적으로 읽어온 뒤에만 시트 쓰기를 허용 (빈/구형 브라우저 상태로 시트를 덮어쓰는 사고 방지)
  const [isSheetReady, setIsSheetReady] = useState<boolean>(false);
  // 서버 세션 기준 실제 로그인 계정 (화면상 계정 전환과 별개)
  const [sessionUser, setSessionUser] = useState<{ id: string; role: string } | null>(null);
  const [isAuthReady, setIsAuthReady] = useState<boolean>(false);
  // 마지막으로 시트와 맞춰진 탭별 내용 / 서버가 준 탭 버전 / 시트에 있다고 알고 있는 거래 ID
  const lastPushedTabsRef = useRef<Record<string, string>>({});
  const baseVersionsRef = useRef<Record<string, string>>({});
  const baseTxIdsRef = useRef<string[]>([]);
  // 저장·불러오기를 한 줄로 세워 서로 겹치지 않게 함 (겹치면 자기 저장에 버전 충돌이 남)
  const sheetQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const enqueueSheetTask = <T,>(task: () => Promise<T>): Promise<T> => {
    const p = sheetQueueRef.current.then(task, task);
    sheetQueueRef.current = p.catch(() => {});
    return p;
  };

  // 최신 화면 상태 (예약된 작업이 옛 렌더의 값을 보지 않도록)
  const latestRef = useRef({ rateTableRows, cardPromotions, transactions, users });
  latestRef.current = { rateTableRows, cardPromotions, transactions, users };
  // 화면에 시트로 아직 저장되지 않은 변경이 있는지
  const hasUnsavedChanges = () => {
    const l = latestRef.current;
    return buildMasterBatchOps(l.rateTableRows, l.cardPromotions, l.transactions, l.users).some(
      (o) => JSON.stringify(o.data) !== lastPushedTabsRef.current[sheetTabOf(o.range)]
    );
  };
  const lastLoadedAtRef = useRef(0);

  // 구글 시트 → 웹앱 전체 로드. 실패하면 예외를 던지고 isSheetReady는 그대로 둔다.
  // skipIfDirty: 읽는 사이 내가 바꾼 내용이 있으면 덮어쓰지 않고 null 반환 (자동 새로고침용)
  const loadFromSheet = (opts: { skipIfDirty?: boolean } = {}) =>
    enqueueSheetTask(() => loadFromSheetNow(opts));
  const loadFromSheetNow = async ({ skipIfDirty = false }: { skipIfDirty?: boolean } = {}): Promise<{
    rates: number;
    promos: number;
    txs: number;
    users: number;
  } | null> => {
    if (skipIfDirty && hasUnsavedChanges()) return null;
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
    // 셀 단위 그대로 파싱 (TSV로 이어 붙이면 줄바꿈이 든 셀이 여러 행으로 쪼개짐)
    const sheetRates = parseRateTableFrom2D(tabs[GOOGLE_SHEET_TABS.RATE_TABLE_MASTER.title]).rows;
    const sheetPromos = parsePromotionsFrom2D(tabs[GOOGLE_SHEET_TABS.PROMOTION_MASTER.title]).promotions;
    const sheetUsers = parseUsersFrom2D(
      (tabs[GOOGLE_SHEET_TABS.USER_CM_MASTER.title] || []) as (string | number)[][]
    );

    if (skipIfDirty && hasUnsavedChanges()) return null;
    // 거래는 시트가 원본. 시트에 없는 이 브라우저 전용 거래(저장 실패분)는 지우지 않고 백업만 남긴다.
    const sheetTxIds = new Set(txResult.transactions.map((t) => t.id));
    const localOnly = latestRef.current.transactions.filter((t) => !sheetTxIds.has(t.id));
    if (localOnly.length > 0) {
      localStorage.setItem(`kanadara_local_only_tx_backup_${Date.now()}`, JSON.stringify(localOnly));
    }

    const nextRates = sheetRates;
    const nextPromos = sheetPromos;
    const nextUsers = sheetUsers;
    const nextTxs = normalizeStoredTransactions(txResult.transactions);

    setRateTableRows(nextRates);
    setCardPromotions(nextPromos);
    setUsers(nextUsers);
    setTransactions(nextTxs);
    setRateTableImages(parseRateImagesFrom2D(tabs[RATE_IMAGE_TAB]));
    setSessionUser(me);
    markSheetSynced(nowFormatted());
    // ADMIN만 화면상 다른 계정으로 전환해 둔 상태를 유지할 수 있음
    setCurrentUserId((prev) => (me.role === 'ADMIN' && prev ? prev : me.id));
    lastPushedTabsRef.current = Object.fromEntries(
      buildMasterBatchOps(nextRates, nextPromos, nextTxs, nextUsers).map((o) => [
        sheetTabOf(o.range),
        JSON.stringify(o.data),
      ])
    );
    baseVersionsRef.current = (json.versions as Record<string, string>) || {};
    baseTxIdsRef.current = nextTxs.map((t) => t.id);
    lastLoadedAtRef.current = Date.now();
    setIsSheetReady(true);
    return { rates: nextRates.length, promos: nextPromos.length, txs: nextTxs.length, users: nextUsers.length };
  };

  // 시트와 달라진 탭만 저장. 반환값: 실제로 저장한 탭 이름들.
  // 거래(07/08)는 서버가 거래 단위로 병합하므로 먼저 따로 보내고, 05/06/09는 버전 확인 후 저장.
  const syncToSheet = (
    rates: RateTableRowItem[],
    promos: CardPromotionItem[],
    txs: Transaction[],
    usersToSave: User[]
  ) =>
    enqueueSheetTask(async (): Promise<string[]> => {
      const ops = buildMasterBatchOps(rates, promos, txs, usersToSave);
      const changed = new Set(
        ops
          .filter((o) => JSON.stringify(o.data) !== lastPushedTabsRef.current[sheetTabOf(o.range)])
          .map((o) => sheetTabOf(o.range))
      );
      const txTabs = [GOOGLE_SHEET_TABS.TRANSACTION_MASTER.title, GOOGLE_SHEET_TABS.SPLIT_PAYMENT_DB.title];
      const txChanged = txTabs.some((t) => changed.has(t));
      const groups = [
        txChanged ? ops.filter((o) => txTabs.includes(sheetTabOf(o.range) as (typeof txTabs)[number])) : [],
        ops.filter((o) => changed.has(sheetTabOf(o.range)) && !txTabs.includes(sheetTabOf(o.range) as (typeof txTabs)[number])),
      ].filter((g) => g.length > 0);

      const saved: string[] = [];
      for (const batchOps of groups) {
        const res = await fetch('/api/gsheets/push', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            batchOps,
            baseVersions: baseVersionsRef.current,
            baseTxIds: baseTxIdsRef.current,
          }),
        });
        const json = await res.json().catch(() => null);
        if (res.status === 401) {
          setIsSheetReady(false);
          setCurrentUserId(null);
        }
        if (!res.ok || !json?.ok) {
          throw Object.assign(new Error(json?.error || `시트 저장 실패 (HTTP ${res.status})`), {
            status: res.status,
          });
        }
        for (const o of batchOps) {
          lastPushedTabsRef.current[sheetTabOf(o.range)] = JSON.stringify(o.data);
          saved.push(sheetTabOf(o.range));
        }
        if (json.versions) baseVersionsRef.current = json.versions;
        if (batchOps.some((o) => txTabs.includes(sheetTabOf(o.range) as (typeof txTabs)[number]))) {
          baseTxIdsRef.current = txs.map((t) => t.id);
        }
      }
      return saved;
    });

  // 409 = 불러온 뒤 시트(콘솔·다른 사용자)가 먼저 바뀜 → 덮어쓰지 않고 최신 시트로 다시 맞춤
  const handleSyncError = (err: unknown, title: string): string => {
    const message = err instanceof Error ? err.message : String(err);
    if ((err as { status?: number }).status === 409) {
      pushToast({
        type: 'error',
        title: '시트가 다른 곳에서 먼저 변경됨',
        description: `${message} 방금 바꾼 내용은 저장되지 않았습니다. 최신 시트를 다시 불러왔으니 확인 후 다시 입력해 주세요.`,
      });
      loadFromSheet().catch(() => {});
    } else {
      pushToast({ type: 'error', title, description: message });
    }
    return message;
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
    if (currentUserId) {
      sessionStorage.setItem(STORAGE_KEYS.CURRENT_USER_ID, currentUserId);
    } else {
      sessionStorage.removeItem(STORAGE_KEYS.CURRENT_USER_ID);
    }
  }, [currentUserId]);

  const currentUser = useMemo(
    () => users.find((u) => u.id === currentUserId && u.isActive && u.role !== 'CM') ?? null,
    [users, currentUserId]
  );

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

  // ponytail: AG는 본인이 등록한 거래만 (Ver1의 AG-CM 배정 기능은 삭제됨)
  const canManageApprovalOf = (tx: Transaction, user: User | null = currentUser): boolean =>
    !!user && user.isActive && (user.role === 'ADMIN' || (user.role === 'AG' && tx.agId === user.id));

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
        rateCategory: s.rateCategory?.trim() || '일반',
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
      primarySplit.rateCategory && primarySplit.rateCategory !== '일반'
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
                  s.rateCategory && s.rateCategory !== '일반' ? `[${s.rateCategory}]` : ''
                } ${(s.amount / 10000).toLocaleString()}만`
            )
            .join(' + ')})${promoSuffix}`;

    const cmSnapshot = buildCmSnapshotFromUser(cmUser);
    const resolvedAgId =
      currentUser.role === 'AG'
        ? currentUser.id
        : users.find((u) => u.role === 'AG')?.id || 'usr-ag-1';

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
    // 거래는 ID 기준으로 시트에 병합되므로 ID가 절대 겹치면 안 됨:
    // 순번 = 이번 달 최대 순번+1 (삭제 후 재사용 방지) + 무작위 꼬리 (동시에 등록한 다른 사용자와 충돌 방지)
    const prefix = `TRX-${yyyymm}-`;
    const maxSeq = transactions.reduce(
      (max, t) => (t.id.startsWith(prefix) ? Math.max(max, parseInt(t.id.slice(prefix.length), 10) || 0) : max),
      0
    );
    const newId = `${prefix}${String(maxSeq + 1).padStart(4, '0')}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;

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
      maskedIdentifier: cmSnapshot.rrn ? `${cmSnapshot.rrn.slice(0, 8)}******` : '',
      agVerifyIdentifier: cmSnapshot.rrn ? `${cmSnapshot.rrn.slice(0, 9)}*****` : '',
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

  // [요구사항 1] 요율표 수정 기능은 ADMIN에게만 부여
  const addRateTableImage: AppContextValue['addRateTableImage'] = async (input) => {
    if (!currentUser || currentUser.role !== 'ADMIN') {
      return { ok: false, message: '관리자(ADMIN)만 요율표 이미지를 등록·수정할 수 있습니다.' };
    }
    if (!input.title.trim() || (!input.file && !input.externalUrl?.trim())) {
      return { ok: false, message: '요율표 제목과 이미지(파일 또는 URL)를 입력해 주세요.' };
    }
    try {
      const payload = input.file ? await prepareImageUpload(input.file) : { externalUrl: input.externalUrl!.trim() };
      const res = await fetch('/api/images/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: input.title,
          cardCompanyTag: input.cardCompanyTag,
          effectiveDate: input.effectiveDate || getTodayDateStr(),
          note: input.note,
          ...payload,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error || `업로드 실패 (HTTP ${res.status})`);
      setRateTableImages((prev) => [json.image as RateTableImageItem, ...prev]);
      pushToast({
        type: 'success',
        title: '요율표 이미지가 등록되었습니다',
        description: `${json.image.title} — 모든 AG의 요율표 화면에 바로 보입니다.`,
      });
      return { ok: true, message: '요율표 이미지가 등록되었습니다.' };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      pushToast({ type: 'error', title: '요율표 이미지 등록 실패', description: message });
      return { ok: false, message };
    }
  };

  const deleteRateTableImage = async (id: string): Promise<ActionResult> => {
    if (!currentUser || currentUser.role !== 'ADMIN') {
      return { ok: false, message: '관리자(ADMIN)만 요율표 이미지를 삭제할 수 있습니다.' };
    }
    const res = await fetch('/api/images/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    }).catch(() => null);
    const json = await res?.json().catch(() => null);
    if (!res?.ok || !json?.ok) {
      const message = json?.error || '이미지 삭제에 실패했습니다.';
      pushToast({ type: 'error', title: '요율표 이미지 삭제 실패', description: message });
      return { ok: false, message };
    }
    setRateTableImages((prev) => prev.filter((item) => item.id !== id));
    pushToast({ type: 'info', title: '요율표 이미지 삭제 완료', description: '모든 AG 화면에서 제거되었습니다.' });
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
      category: (input.category || '일반').trim() || '일반',
      amountTier: input.amountTier.trim() || '전 구간',
      installmentMonths: isLumpSum ? '1달' : input.installmentMonths.trim() || '24 / 36 / 48개월',
      cashbackRate: isLumpSum ? Number((input.cashbackRate || 0).toFixed(2)) : 0,
      interestRate: isLumpSum ? 0 : Number((input.interestRate || 0).toFixed(2)),
      agCommissionRate: Number((input.agCommissionRate || 0).toFixed(2)),
      cmCommissionRate: Number((input.cmCommissionRate || 0).toFixed(2)),
      effectiveDate: input.effectiveDate || getTodayDateStr(),
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
      startDate: input.startDate || getTodayDateStr(),
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

    const resolvedAffiliation = input.affiliation.trim();
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
        password: input.password?.trim() || '', // 비밀번호 없으면 로그인 불가 (CM은 로그인 대상 아님)
        name: input.name.trim(),
        role: input.role,
        affiliation: resolvedAffiliation,
        phone: input.phone.trim(),
        rrn: input.rrn?.trim() || undefined,
        businessNumber: input.businessNumber?.trim() || undefined,
        employeeId:
          input.employeeId?.trim() ||
          `${input.role}-${String(users.length + 1).padStart(4, '0')}`,
        isActive: input.isActive,
        createdAt: nowFormatted(),
      };
      const nextUsers = [...users, newUser];
      setUsers(nextUsers);
      pushAllMasterTabsToGoogleSheet(`신규 ${input.role} 등록`, nextUsers);

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

  // 웹앱 데이터 변경 시 구글 시트에 자동 저장. 시트 로드 전에는 절대 쓰지 않고, 바뀐 게 없으면 건너뜀.
  useEffect(() => {
    if (!isSheetReady) return;
    const timer = window.setTimeout(() => {
      syncToSheet(rateTableRows, cardPromotions, transactions, users).catch((err) =>
        handleSyncError(err, '구글 시트 자동 저장 실패')
      );
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
      const saved = await syncToSheet(targetRates, targetPromos, targetTransactions, targetUsers);
      if (saved.length === 0) {
        pushToast({ type: 'info', title: '변경 사항 없음', description: '시트와 이미 같은 상태입니다.' });
        return { ok: true, message: '변경 사항 없음' };
      }

      markSheetSynced(now);

      pushToast({
        type: 'success',
        title: '구글 시트 통합 마스터 동기화(Push) 완료',
        description: `저장한 탭: ${saved.join(', ')}`,
      });

      return {
        ok: true,
        message: '구글 시트 동기화 완료',
      };
    } catch (err) {
      return { ok: false, message: handleSyncError(err, '구글 시트 저장 실패') };
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
      const counts = (await loadFromSheet())!;
      const now = nowFormatted();
      markSheetSynced(now);
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

    markSheetSynced(now);
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

    markSheetSynced(now);
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

  // 다른 사람이 등록·수정한 내용 반영. 아직 시트에 저장되지 않은 내 변경이 있으면 덮어쓰지 않고 건너뜀.
  const refreshFromSheet = async (silent = false): Promise<ActionResult> => {
    if (!isSheetReady) return { ok: false, message: '시트가 아직 연결되지 않았습니다.' };
    try {
      const counts = await loadFromSheet({ skipIfDirty: true });
      if (!counts) {
        if (!silent) {
          pushToast({ type: 'info', title: '저장 중인 변경이 있어 새로고침을 미뤘습니다', description: '잠시 후 다시 눌러 주세요.' });
        }
        return { ok: false, message: '저장 대기 중인 변경이 있습니다.' };
      }
      if (!silent) {
        pushToast({
          type: 'success',
          title: '최신 데이터로 새로고침했습니다',
          description: `거래 ${counts.txs}건 · 요율 ${counts.rates}행 · 프로모션 ${counts.promos}건`,
        });
      }
      return { ok: true, message: '새로고침 완료' };
    } catch (err) {
      if ((err as { status?: number }).status === 401) {
        // 세션 만료(12시간) → 로그인 화면으로
        setIsSheetReady(false);
        setCurrentUserId(null);
      }
      const message = err instanceof Error ? err.message : String(err);
      if (!silent) pushToast({ type: 'error', title: '새로고침 실패', description: message });
      return { ok: false, message };
    }
  };

  // 3분마다, 그리고 이 탭으로 돌아올 때 조용히 새로고침 (30초 안에 이미 불러왔으면 생략)
  const refreshRef = useRef(refreshFromSheet);
  refreshRef.current = refreshFromSheet;
  useEffect(() => {
    if (!isSheetReady) return;
    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastLoadedAtRef.current < 30_000) return;
      refreshRef.current(true);
    };
    const timer = window.setInterval(tick, 3 * 60_000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [isSheetReady]);

  // 주의: 상태를 빈 값으로 바꾸면 자동 저장이 시트의 거래·계정을 지워버림 → 브라우저 캐시만 비우고 새로 로드
  const resetDemoData = () => {
    Object.values(STORAGE_KEYS).forEach((key) => localStorage.removeItem(key));
    sessionStorage.removeItem(STORAGE_KEYS.CURRENT_USER_ID);
    window.location.reload();
  };

  return (
    <AppContext.Provider
      value={{
        currentUser,
        users,
        transactions,
        rateTableImages,
        rateTableRows,
        cardPromotions,
        isRateTableSplitOpen,
        setRateTableSplitOpen,
        toasts,
        pushToast,
        dismissToast,
        login,
        quickSwitchUser,
        logout,
        saveAgTransactionRequest,
        quickChangeTransactionStatus,
        quickChangeTransactionSettlementStatus,
        bulkUpdateTransactionsV2,
        addRateTableImage,
        deleteRateTableImage,
        saveRateTableRow,
        deleteRateTableRow,
        saveCardPromotion,
        deleteCardPromotion,
        saveUserAccount,
        deleteUserAccount,
        lastMasterSheetSyncedAt,
        isSyncingMasterSheet,
        isSheetReady,
        isAuthReady,
        pushAllMasterTabsToGoogleSheet,
        pullRateAndPromotionsFromGoogleSheet,
        importRateTableRowsFromSheetTsv,
        importPromotionsFromSheetTsv,
        draftsV2,
        saveDraftV2,
        deleteDraftV2,
        editingTxIdV2,
        setEditingTxIdV2,
        pendingDraftIdV2,
        setPendingDraftIdV2,
        deleteTransaction,
        resetDemoData,
        refreshFromSheet,
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
