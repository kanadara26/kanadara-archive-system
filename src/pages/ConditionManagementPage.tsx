import React, { useMemo, useState } from 'react';
import { useApp } from '../context/AppContext';
import {
  CARD_COMPANIES,
  CARD_KINDS,
  CHANNEL_TYPES,
  CardCompany,
  CardKind,
  ChannelType,
  ConditionLifecycleStatus,
  DealCondition,
  PAYMENT_METHODS,
  PaymentMethod,
} from '../types';
import { PENDING_GOOGLE_SHEET_SYNC_BATCH } from '../data/mockData';
import { RateTablePanel } from '../components/RateTablePanel';
import {
  downloadCsvFile,
  formatManwonRange,
  getConditionLifecycleStatus,
  parseSheetTextToConditions,
  subtractOneDay,
} from '../utils/format';
import {
  PlusCircle,
  Edit3,
  ShieldAlert,
  ToggleLeft,
  ToggleRight,
  X,
  Info,
  FileSpreadsheet,
  RefreshCw,
  Download,
  CalendarClock,
  CheckCircle2,
  Clock,
  History,
  GitBranchPlus,
  Upload,
  Search,
  Table2,
} from 'lucide-react';

type ViewTab = 'ACTIVE_NOW' | 'SCHEDULED' | 'EXPIRED' | 'ALL' | 'SHEET_SPEC';

const SAMPLE_PASTE_TSV = [
  '시트행ID\t조건그룹코드\t버전\t실행일자\t카드사\t거래방법\t진행경로\t카드종류\t최소금액\t최대금액\t선수금비율조건\t할부개월조건\t표준조건명\t고객캐시백율\tCM수수료율\t세부기준설명',
  'COND-ROW-020\tHN-PRE-2000\t2\t2026-11-12\t하나카드\t선입금(가상계좌) 캐시백\tAG다이렉트\t개인 체크·선입금\t20000000\t90000000\t신청금액 100% 선입금\t일시불 (가상계좌 선입금)\t[11/12 실행] 하나 원큐 AG다이렉트 선입금 2.12%\t2.12\t0.54\t11/12 거래승인 건부터 상향 적용 (11/11까지 기존 v1 2.0% 유지)',
  'COND-ROW-021\tSS-ONE-2000\t3\t2026-11-18\t삼성카드\t일시불 오토캐시백\t카드사다이렉트\t개인 신용\t20000000\t80000000\t선수금 제한 없음\t일시불 (1개월)\t[11/18 실행] 삼성 신용한도 일시불 1.85% (하반기 특판)\t1.85\t0.52\t11/18 거래승인 건부터 적용 (11/17까지 기존 v2 1.8% 유지)',
].join('\n');

const LIFECYCLE_BADGE: Record<
  ConditionLifecycleStatus,
  { label: string; className: string }
> = {
  ACTIVE_NOW: {
    label: '현재 적용중',
    className: 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/25',
  },
  SCHEDULED: {
    label: '실행 예정 (이전조건 유지)',
    className: 'bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-600/25',
  },
  EXPIRED: {
    label: '기간 종료 (이력 보존)',
    className: 'bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-500/20',
  },
  DISABLED: {
    label: '수동 중단',
    className: 'bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-600/20',
  },
};

export const ConditionManagementPage: React.FC = () => {
  const {
    currentUser,
    conditions,
    conditionSyncLogs,
    systemReferenceDate,
    setSystemReferenceDate,
    saveDealCondition,
    toggleConditionActive,
    syncConditionsFromSheet,
  } = useApp();

  // View & Filter states (all hooks MUST remain above role-guard early returns)
  const [viewTab, setViewTab] = useState<ViewTab>('ACTIVE_NOW');
  const [cardFilter, setCardFilter] = useState<string>('ALL');
  const [methodFilter, setMethodFilter] = useState<string>('ALL');
  const [channelFilter, setChannelFilter] = useState<string>('ALL');
  const [cardKindFilter, setCardKindFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Manual Add / Edit Modal states
  const [modalOpen, setModalOpen] = useState(false);
  const [editingCond, setEditingCond] = useState<DealCondition | null>(null);
  const [conditionGroupCode, setConditionGroupCode] = useState('SS-PRE-3000');
  const [versionNo, setVersionNo] = useState('1');
  const [effectiveFrom, setEffectiveFrom] = useState(systemReferenceDate);
  const [effectiveTo, setEffectiveTo] = useState('');
  const [cardCompany, setCardCompany] = useState<CardCompany>('삼성카드');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('선입금(가상계좌) 캐시백');
  const [channelType, setChannelType] = useState<ChannelType>('AG다이렉트');
  const [cardKind, setCardKind] = useState<CardKind>('개인 체크·선입금');
  const [installmentTerms, setInstallmentTerms] = useState('일시불 (가상계좌 선입금)');
  const [downPaymentRule, setDownPaymentRule] = useState('신청금액 100% 선입금');
  const [minAmount, setMinAmount] = useState('30000000');
  const [maxAmount, setMaxAmount] = useState('100000000');
  const [title, setTitle] = useState('');
  const [customerCashbackRate, setCustomerCashbackRate] = useState('2.0');
  const [cmCommissionRate, setCmCommissionRate] = useState('0.50');
  const [isCommissionDeferred, setIsCommissionDeferred] = useState(false);
  const [description, setDescription] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);

  // Google Sheets Sync Modal states
  const [syncModalOpen, setSyncModalOpen] = useState(false);
  const [syncMode, setSyncMode] = useState<'API_BATCH' | 'PASTE_CSV'>('API_BATCH');
  const [rawSheetText, setRawSheetText] = useState('');
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null);

  const conditionsWithStatus = useMemo(() => {
    return conditions
      .map((cond) => ({
        cond,
        lifecycle: getConditionLifecycleStatus(cond, systemReferenceDate),
      }))
      .sort(
        (a, b) =>
          a.cond.cardCompany.localeCompare(b.cond.cardCompany) ||
          a.cond.conditionGroupCode.localeCompare(b.cond.conditionGroupCode) ||
          b.cond.effectiveFrom.localeCompare(a.cond.effectiveFrom)
      );
  }, [conditions, systemReferenceDate]);

  const lifecycleCounts = useMemo(() => {
    let activeNow = 0;
    let scheduled = 0;
    let expired = 0;
    let disabled = 0;
    conditionsWithStatus.forEach(({ lifecycle }) => {
      if (lifecycle === 'ACTIVE_NOW') activeNow += 1;
      else if (lifecycle === 'SCHEDULED') scheduled += 1;
      else if (lifecycle === 'EXPIRED') expired += 1;
      else disabled += 1;
    });
    return {
      activeNow,
      scheduled,
      expired,
      disabled,
      all: conditionsWithStatus.length,
    };
  }, [conditionsWithStatus]);

  const filteredConditions = useMemo(() => {
    return conditionsWithStatus.filter(({ cond, lifecycle }) => {
      if (viewTab === 'ACTIVE_NOW' && lifecycle !== 'ACTIVE_NOW') return false;
      if (viewTab === 'SCHEDULED' && lifecycle !== 'SCHEDULED') return false;
      if (viewTab === 'EXPIRED' && lifecycle !== 'EXPIRED' && lifecycle !== 'DISABLED')
        return false;

      if (cardFilter !== 'ALL' && cond.cardCompany !== cardFilter) return false;
      if (methodFilter !== 'ALL' && cond.paymentMethod !== methodFilter) return false;
      if (channelFilter !== 'ALL' && cond.channelType !== channelFilter) return false;
      if (cardKindFilter !== 'ALL' && cond.cardKind !== cardKindFilter) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const hit =
          cond.conditionGroupCode.toLowerCase().includes(q) ||
          cond.title.toLowerCase().includes(q) ||
          cond.description.toLowerCase().includes(q) ||
          (cond.sheetRowId ?? '').toLowerCase().includes(q) ||
          cond.downPaymentRule.toLowerCase().includes(q) ||
          cond.installmentTerms.toLowerCase().includes(q);
        if (!hit) return false;
      }

      return true;
    });
  }, [
    conditionsWithStatus,
    viewTab,
    cardFilter,
    methodFilter,
    channelFilter,
    cardKindFilter,
    searchQuery,
  ]);

  const parsedPastePreview = useMemo(() => {
    if (!rawSheetText.trim()) return null;
    return parseSheetTextToConditions(rawSheetText);
  }, [rawSheetText]);

  if (!currentUser) return null;

  if (currentUser.role !== 'ADMIN' && currentUser.role !== 'AG') {
    return (
      <div className="mx-auto max-w-xl rounded-2xl border border-rose-200 bg-white p-8 text-center shadow-sm">
        <ShieldAlert className="mx-auto h-10 w-10 text-rose-500" />
        <h2 className="mt-3 text-lg font-bold text-slate-900">거래 조건 관리 권한이 없습니다</h2>
        <p className="mt-1.5 text-xs text-slate-600">
          CM은 승인 요청 화면에서 현재 기준일자에 실행 중인 거래 조건을 조회·선택만 할 수 있습니다.
        </p>
      </div>
    );
  }

  const openCreateModal = () => {
    setEditingCond(null);
    setConditionGroupCode('SS-NEW-3000');
    setVersionNo('1');
    setEffectiveFrom(systemReferenceDate);
    setEffectiveTo('');
    setCardCompany('삼성카드');
    setPaymentMethod('선입금(가상계좌) 캐시백');
    setChannelType('AG다이렉트');
    setCardKind('개인 체크·선입금');
    setInstallmentTerms('일시불 (가상계좌 선입금)');
    setDownPaymentRule('신청금액 100% 선입금');
    setMinAmount('30000000');
    setMaxAmount('100000000');
    setTitle('');
    setCustomerCashbackRate('2.05');
    setCmCommissionRate('0.52');
    setIsCommissionDeferred(false);
    setDescription('');
    setIsActive(true);
    setFormError(null);
    setModalOpen(true);
  };

  const openScheduleNextVersionModal = (base: DealCondition) => {
    const sameGroupMaxVer = conditions
      .filter((c) => c.conditionGroupCode === base.conditionGroupCode)
      .reduce((max, c) => Math.max(max, c.versionNo), base.versionNo);

    setEditingCond(null);
    setConditionGroupCode(base.conditionGroupCode);
    setVersionNo(String(sameGroupMaxVer + 1));
    setEffectiveFrom('2026-11-15');
    setEffectiveTo('');
    setCardCompany(base.cardCompany);
    setPaymentMethod(base.paymentMethod);
    setChannelType(base.channelType);
    setCardKind(base.cardKind);
    setInstallmentTerms(base.installmentTerms);
    setDownPaymentRule(base.downPaymentRule);
    setMinAmount(String(base.minAmount));
    setMaxAmount(base.maxAmount ? String(base.maxAmount) : '');
    setTitle(`[11/15 실행] ${base.title.replace(/^\[.*?\]\s*/, '')}`);
    setCustomerCashbackRate(String(base.customerCashbackRate));
    setIsCommissionDeferred(base.cmCommissionRate === null);
    setCmCommissionRate(base.cmCommissionRate !== null ? String(base.cmCommissionRate) : '0.50');
    setDescription(
      `새 실행일자 거래승인 건부터 적용 (실행일 전까지는 기존 v${base.versionNo} ${base.customerCashbackRate}% 조건 자동 유지)`
    );
    setIsActive(true);
    setFormError(null);
    setModalOpen(true);
  };

  const openEditModal = (cond: DealCondition) => {
    setEditingCond(cond);
    setConditionGroupCode(cond.conditionGroupCode);
    setVersionNo(String(cond.versionNo));
    setEffectiveFrom(cond.effectiveFrom);
    setEffectiveTo(cond.effectiveTo ?? '');
    setCardCompany(cond.cardCompany);
    setPaymentMethod(cond.paymentMethod);
    setChannelType(cond.channelType);
    setCardKind(cond.cardKind);
    setInstallmentTerms(cond.installmentTerms);
    setDownPaymentRule(cond.downPaymentRule);
    setMinAmount(String(cond.minAmount));
    setMaxAmount(cond.maxAmount ? String(cond.maxAmount) : '');
    setTitle(cond.title);
    setCustomerCashbackRate(String(cond.customerCashbackRate));
    setIsCommissionDeferred(cond.cmCommissionRate === null);
    setCmCommissionRate(cond.cmCommissionRate !== null ? String(cond.cmCommissionRate) : '0.45');
    setDescription(cond.description);
    setIsActive(cond.isActive);
    setFormError(null);
    setModalOpen(true);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const cleanMin = Number(minAmount.replace(/\D/g, '')) || 0;
    const cleanMaxStr = maxAmount.replace(/\D/g, '');
    const cleanMax = cleanMaxStr ? Number(cleanMaxStr) : null;

    if (cleanMax !== null && cleanMax < cleanMin) {
      setFormError('최대 한도 금액은 최소 신청 금액보다 크거나 같아야 합니다.');
      return;
    }

    const res = saveDealCondition({
      id: editingCond?.id,
      conditionGroupCode: conditionGroupCode.trim(),
      versionNo: Number(versionNo) || 1,
      effectiveFrom,
      effectiveTo: effectiveTo.trim() ? effectiveTo.trim() : null,
      cardCompany,
      paymentMethod,
      channelType,
      cardKind,
      installmentTerms,
      downPaymentRule,
      minAmount: cleanMin,
      maxAmount: cleanMax,
      title,
      customerCashbackRate: Number(customerCashbackRate),
      cmCommissionRate: isCommissionDeferred ? null : Number(cmCommissionRate),
      description,
      isActive,
    });
    if (!res.ok) {
      setFormError(res.message);
      return;
    }
    setModalOpen(false);
  };

  const handleDownloadOptimizedSheetTemplate = () => {
    const header = [
      '시트행ID(A)',
      '조건그룹코드(B)',
      '버전(C)',
      '실행일자_YYYY-MM-DD(D)',
      '카드사(E)',
      '거래방법(F)',
      '진행경로_AG다이렉트등(G)',
      '카드종류(H)',
      '최소금액_원(I)',
      '최대금액_원_빈값무제한(J)',
      '선수금비율조건(K)',
      '할부개월조건(L)',
      '표준조건명(M)',
      '고객캐시백율_%(N)',
      'CM수수료율_%_빈값특약(O)',
      '세부기준설명(P)',
      '자동산출_종료일자(Q_수식열)',
      '현재상태_기준일대비(R_수식열)',
    ];

    const dataRows = conditionsWithStatus.map(({ cond, lifecycle }, index) => [
      cond.sheetRowId || `COND-ROW-${String(index + 1).padStart(3, '0')}`,
      cond.conditionGroupCode,
      String(cond.versionNo),
      cond.effectiveFrom,
      cond.cardCompany,
      cond.paymentMethod,
      cond.channelType,
      cond.cardKind,
      String(cond.minAmount),
      cond.maxAmount !== null ? String(cond.maxAmount) : '',
      cond.downPaymentRule,
      cond.installmentTerms,
      cond.title,
      String(cond.customerCashbackRate),
      cond.cmCommissionRate !== null ? String(cond.cmCommissionRate) : '',
      cond.description,
      cond.effectiveTo ?? '상시유지(차기버전없음)',
      LIFECYCLE_BADGE[lifecycle].label,
    ]);

    downloadCsvFile(
      `카나다라_거래조건_마스터시트_${systemReferenceDate}.csv`,
      [header, ...dataRows]
    );
  };

  const handleRunSimulatedBatchSync = () => {
    const res = syncConditionsFromSheet(
      PENDING_GOOGLE_SHEET_SYNC_BATCH,
      '구글 시트 [01_거래조건_마스터] 원클릭 API 연동'
    );
    if (res.ok) {
      setSyncFeedback(res.message);
      setTimeout(() => {
        setSyncModalOpen(false);
        setSyncFeedback(null);
      }, 700);
    }
  };

  const handleCsvFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setRawSheetText(reader.result);
      }
    };
    reader.readAsText(file, 'utf-8');
  };

  const handleRunPasteSync = () => {
    if (!parsedPastePreview || parsedPastePreview.rows.length === 0) return;
    const res = syncConditionsFromSheet(
      parsedPastePreview.rows,
      '구글 시트 복사·붙여넣기(TSV/CSV) 일괄 동기화'
    );
    if (res.ok) {
      setRawSheetText('');
      setSyncModalOpen(false);
    }
  };

  const DATE_PRESETS = [
    { date: '2026-11-02', label: '11/02 (현재 기준일)' },
    { date: '2026-11-05', label: '11/05 (삼성 v2 실행일)' },
    { date: '2026-11-08', label: '11/08 (우리 시트연동 실행일)' },
    { date: '2026-11-10', label: '11/10 (현대 특판 실행일)' },
    { date: '2026-11-15', label: '11/15 (롯데 신규 실행일)' },
  ];

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            거래방법 · 카드사별 거래 조건 및 구글 시트 연동
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            카드사별 월 1~2회 비동기 조건 개편을 구글 시트와 연동해 관리합니다. 새 조건이 등록되어도{' '}
            <strong className="text-slate-900">새 실행일자 전까지는 이전 조건이 자동 유지</strong>됩니다.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => {
              setSyncFeedback(null);
              setSyncModalOpen(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-xl bg-teal-600 px-4 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-teal-700"
          >
            <FileSpreadsheet className="h-4 w-4" />
            구글 시트 조건 동기화
          </button>

          <button
            type="button"
            onClick={handleDownloadOptimizedSheetTemplate}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
          >
            <Download className="h-4 w-4 text-slate-500" />
            최적화 시트(.CSV) 다운로드
          </button>

          <button
            type="button"
            onClick={openCreateModal}
            className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700"
          >
            <PlusCircle className="h-4 w-4" />
            새 거래 조건 등록
          </button>
        </div>
      </div>

      {/* ADMIN 전용 요율표 · 카드사 프로모션 · 이미지 요율표 통합 관리 패널 */}
      <RateTablePanel />

      {/* Effective Date Simulator Bar */}
      <div className="rounded-2xl border border-indigo-200 bg-gradient-to-r from-indigo-50/80 via-white to-teal-50/60 p-4 shadow-sm">
        <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white">
              <CalendarClock className="h-5 w-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-bold text-indigo-950">
                  실행일자 판별 · 거래승인 기준일 시뮬레이터
                </span>
                <span className="rounded-full bg-indigo-100 px-2 py-0.5 font-mono text-xs font-bold text-indigo-800">
                  기준일: {systemReferenceDate}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-slate-600">
                기준일자를 변경하면 카드사별로 예약된{' '}
                <strong className="text-amber-800">[실행 예정]</strong> 조건이 실행일 도래와 동시에{' '}
                <strong className="text-emerald-700">[현재 적용중]</strong>으로 자동 전환되고 직전 조건은 종료됩니다.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <input
              type="date"
              value={systemReferenceDate}
              onChange={(e) => setSystemReferenceDate(e.target.value)}
              className="rounded-xl border border-indigo-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-900 focus:border-indigo-500 focus:outline-none"
            />
            {DATE_PRESETS.map((preset) => (
              <button
                key={preset.date}
                type="button"
                onClick={() => setSystemReferenceDate(preset.date)}
                className={`rounded-xl px-2.5 py-1.5 text-[11px] font-semibold transition-all ${
                  systemReferenceDate === preset.date
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'border border-slate-200 bg-white text-slate-700 hover:border-indigo-300 hover:bg-indigo-50'
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Business Rule Summary Banner */}
      <div className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-xs text-slate-700 shadow-sm">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-teal-600" />
        <div className="space-y-1">
          <p className="font-bold text-slate-900">
            실행일자(`effectiveFrom`) 중심 조건 버전 관리 & 승인일 기준 자동 매칭 규칙
          </p>
          <p className="leading-relaxed text-slate-600">
            1) 동일 <strong>조건그룹코드</strong>(예: <code className="font-mono">SS-PRE-3000</code>)에 새 실행일자의
            차기 버전이 시트에서 동기화되면, 기존 버전의 종료일자는 자동으로{' '}
            <strong>(새 실행일자 - 1일)</strong>로 설정되어 실행일 전까지 이전 조건이 유지됩니다.{' '}
            2) 거래승인이 나는 시점의 승인일자가 새 조건 실행일자 이후라면 해당 거래는 새 조건을 따르고, 실행일자
            이전 승인 건은 기존 조건이 보존됩니다.
          </p>
        </div>
      </div>

      {/* Lifecycle Navigation Tabs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <button
          type="button"
          onClick={() => setViewTab('ACTIVE_NOW')}
          className={`rounded-xl border p-3.5 text-left transition-all ${
            viewTab === 'ACTIVE_NOW'
              ? 'border-emerald-500 bg-emerald-50/70 ring-1 ring-emerald-500'
              : 'border-slate-200 bg-white hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-emerald-800">현재 적용중</span>
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          </div>
          <p className="mt-1 text-2xl font-bold tabular-nums text-emerald-700">
            {lifecycleCounts.activeNow}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500">당일 승인 · 신규 요청 적용</p>
        </button>

        <button
          type="button"
          onClick={() => setViewTab('SCHEDULED')}
          className={`rounded-xl border p-3.5 text-left transition-all ${
            viewTab === 'SCHEDULED'
              ? 'border-amber-500 bg-amber-50/70 ring-1 ring-amber-500'
              : 'border-slate-200 bg-white hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-amber-800">실행 예정 (대기)</span>
            <Clock className="h-4 w-4 text-amber-600" />
          </div>
          <p className="mt-1 text-2xl font-bold tabular-nums text-amber-700">
            {lifecycleCounts.scheduled}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500">실행일 전까지 이전조건 유지</p>
        </button>

        <button
          type="button"
          onClick={() => setViewTab('EXPIRED')}
          className={`rounded-xl border p-3.5 text-left transition-all ${
            viewTab === 'EXPIRED'
              ? 'border-slate-500 bg-slate-100 ring-1 ring-slate-500'
              : 'border-slate-200 bg-white hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-700">종료 · 중단 이력</span>
            <History className="h-4 w-4 text-slate-500" />
          </div>
          <p className="mt-1 text-2xl font-bold tabular-nums text-slate-700">
            {lifecycleCounts.expired + lifecycleCounts.disabled}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500">기존 승인건 스냅샷 보존</p>
        </button>

        <button
          type="button"
          onClick={() => setViewTab('ALL')}
          className={`rounded-xl border p-3.5 text-left transition-all ${
            viewTab === 'ALL'
              ? 'border-slate-800 bg-slate-100 ring-1 ring-slate-800'
              : 'border-slate-200 bg-white hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-800">전체 조건 버전</span>
            <Table2 className="h-4 w-4 text-slate-600" />
          </div>
          <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900">
            {lifecycleCounts.all}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">그룹별 전체 버전 타임라인</p>
        </button>

        <button
          type="button"
          onClick={() => setViewTab('SHEET_SPEC')}
          className={`col-span-2 sm:col-span-1 rounded-xl border p-3.5 text-left transition-all ${
            viewTab === 'SHEET_SPEC'
              ? 'border-teal-600 bg-teal-50/80 ring-1 ring-teal-600'
              : 'border-slate-200 bg-white hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-teal-800">연동 시트 구조 · 로그</span>
            <FileSpreadsheet className="h-4 w-4 text-teal-600" />
          </div>
          <p className="mt-1 text-2xl font-bold tabular-nums text-teal-700">
            {conditionSyncLogs.length}회
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500">최적화 구글 시트 설계 보기</p>
        </button>
      </div>

      {viewTab === 'SHEET_SPEC' ? (
        /* Optimized Google Sheet Schema & Sync Audit Log View */
        <div className="space-y-6">
          <div className="rounded-2xl border border-teal-200 bg-white p-6 shadow-sm">
            <div className="flex flex-col justify-between gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-center">
              <div>
                <span className="rounded bg-teal-100 px-2 py-0.5 text-[11px] font-bold text-teal-800">
                  Google Sheets 연동 표준 설계
                </span>
                <h2 className="mt-1.5 text-lg font-bold text-slate-900">
                  카드사별 비동기 조건 업데이트 최적화 구글 시트 (4개 탭 구조)
                </h2>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <a
                  href="https://docs.google.com/spreadsheets/d/1fGq9OKWroDBovIlkvdrkYmDFZp-HTkeJem5sirv6vvs/edit"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-xl border border-teal-300 bg-teal-50 px-3.5 py-2 text-xs font-bold text-teal-800 hover:bg-teal-100"
                >
                  <FileSpreadsheet className="h-3.5 w-3.5" />
                  실제 생성된 구글 시트 열기 ↗
                </a>
                <button
                  type="button"
                  onClick={handleDownloadOptimizedSheetTemplate}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-teal-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-teal-700"
                >
                  <Download className="h-3.5 w-3.5" />
                  구글 시트 업로드용 마스터 CSV 받기
                </button>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-xl border border-teal-200 bg-teal-50/50 p-4">
                <p className="font-mono text-xs font-bold text-teal-800">TAB 01 · 01_거래조건_마스터</p>
                <p className="mt-1 text-xs font-bold text-slate-900">버전 누적형(Append-Only) 원본</p>
                <p className="mt-1 text-[11px] leading-relaxed text-slate-600">
                  기존 행을 덮어쓰지 않고 동일 <code className="font-mono">조건그룹코드</code>로 새 실행일자
                  행을 아래에 추가합니다. 웹앱 API가 이 탭의 A~P열을 읽어 조건을 자동 갱신합니다.
                </p>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="font-mono text-xs font-bold text-indigo-700">TAB 02 · 02_코드표_드롭다운</p>
                <p className="mt-1 text-xs font-bold text-slate-900">입력 오타 차단 데이터 검증</p>
                <p className="mt-1 text-[11px] leading-relaxed text-slate-600">
                  카드사(7개), 거래방법(4종), 진행경로(AG다이렉트/카드사다이렉트/일반·특판제휴), 카드종류,
                  선수금·할부개월 표준 옵션을 드롭다운으로 강제합니다.
                </p>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="font-mono text-xs font-bold text-amber-700">
                  TAB 03 · 03_카드사별_실행일정_보드
                </p>
                <p className="mt-1 text-xs font-bold text-slate-900">현행 vs 차기 예정 한눈에 비교</p>
                <p className="mt-1 text-[11px] leading-relaxed text-slate-600">
                  <code className="font-mono">QUERY</code> 수식으로 카드사별 현재 적용 조건과 다가오는 실행 예정
                  조건(D-Day) 및 실행일 중복 오류 경고를 자동 시각화합니다.
                </p>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="font-mono text-xs font-bold text-purple-700">TAB 04 · 04_동기화_감사로그</p>
                <p className="mt-1 text-xs font-bold text-slate-900">웹앱 반영 이력 · 체크섬 기록</p>
                <p className="mt-1 text-[11px] leading-relaxed text-slate-600">
                  Apps Script 웹훅 또는 운영자 수동 동기화 시 반영 일시, 담당자, 추가/종료된 조건그룹 내역을
                  자동 기록합니다.
                </p>
              </div>
            </div>

            {/* Key Formulas Preview */}
            <div className="mt-5 rounded-xl border border-slate-200 bg-slate-900 p-4 text-xs text-slate-100">
              <p className="font-bold text-teal-300">
                핵심 자동 수식 ([01_거래조건_마스터] Q열~S열 — 새 조건 실행일 전까지 이전 조건 자동 유지)
              </p>
              <div className="mt-2.5 space-y-2 font-mono text-[11px]">
                <div>
                  <span className="text-slate-400"># Q열 (자동 종료일자 effective_to 산출): </span>
                  <code className="text-emerald-300">
                    {`=IF(B2="","", IFERROR(TEXT(MINIFS(D$2:D, B$2:B, B2, T$2:T, TRUE, D$2:D, ">"&D2)-1, "yyyy-mm-dd"), ""))`}
                  </code>
                </div>
                <div>
                  <span className="text-slate-400"># R열 (오늘 기준 실시간 적용 상태): </span>
                  <code className="text-amber-300">
                    {`=IF(NOT(T2),"사용중단", IF(D2>TODAY(),"실행예정(이전조건유지)", IF(AND(Q2<>"", DATEVALUE(Q2)<TODAY()),"기간종료","현재적용중")))`}
                  </code>
                </div>
              </div>
            </div>
          </div>

          {/* Condition Sheet Sync History Table */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h3 className="text-base font-bold text-slate-900">구글 시트 조건 동기화 실행 이력</h3>
            <div className="mt-4 space-y-3">
              {conditionSyncLogs.map((log) => (
                <div
                  key={log.id}
                  className="flex flex-col justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50/70 p-4 text-xs sm:flex-row sm:items-center"
                >
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono font-bold text-slate-900">{log.syncedAt}</span>
                      <span className="rounded bg-teal-100 px-2 py-0.5 font-semibold text-teal-800">
                        {log.sourceLabel}
                      </span>
                      <span className="text-slate-500">실행자: {log.actorName}</span>
                    </div>
                    <p className="mt-1.5 text-slate-700">{log.summary}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="rounded-lg bg-emerald-100 px-2.5 py-1 font-bold text-emerald-800">
                      신규 +{log.addedCount}
                    </span>
                    <span className="rounded-lg bg-indigo-100 px-2.5 py-1 font-bold text-indigo-800">
                      갱신 {log.updatedCount}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* Rich Multi-Criteria Filter Bar */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="그룹코드, 조건명, 선수금, 할부 검색..."
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-8 pr-3 text-xs text-slate-900 focus:border-indigo-500 focus:bg-white focus:outline-none"
                />
              </div>

              <select
                value={cardFilter}
                onChange={(e) => setCardFilter(e.target.value)}
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 focus:border-indigo-500 focus:bg-white focus:outline-none"
              >
                <option value="ALL">카드사: 전체</option>
                {CARD_COMPANIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>

              <select
                value={methodFilter}
                onChange={(e) => setMethodFilter(e.target.value)}
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 focus:border-indigo-500 focus:bg-white focus:outline-none"
              >
                <option value="ALL">거래방법: 전체</option>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>

              <select
                value={channelFilter}
                onChange={(e) => setChannelFilter(e.target.value)}
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 focus:border-indigo-500 focus:bg-white focus:outline-none"
              >
                <option value="ALL">진행경로(AG다이렉트 등): 전체</option>
                {CHANNEL_TYPES.map((ch) => (
                  <option key={ch} value={ch}>
                    {ch}
                  </option>
                ))}
              </select>

              <select
                value={cardKindFilter}
                onChange={(e) => setCardKindFilter(e.target.value)}
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 focus:border-indigo-500 focus:bg-white focus:outline-none"
              >
                <option value="ALL">카드종류: 전체</option>
                {CARD_KINDS.map((ck) => (
                  <option key={ck} value={ck}>
                    {ck}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Conditions Table */}
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50/70 px-5 py-3 text-xs">
              <span className="font-semibold text-slate-700">
                조회된 거래 조건 <strong className="text-indigo-600">{filteredConditions.length}</strong>건
                (기준일자: <span className="font-mono">{systemReferenceDate}</span>)
              </span>
              <span className="text-slate-500">
                * 동일 조건그룹 내 차기 실행일 등록 시 이전 조건 종료일이 자동 산출됩니다.
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
                <thead className="bg-slate-50 text-xs font-semibold text-slate-600">
                  <tr>
                    <th className="px-4 py-3.5">적용상태 · 실행/종료일</th>
                    <th className="px-3 py-3.5">그룹코드 · 버전</th>
                    <th className="px-3 py-3.5">카드사 · 방법 · 경로</th>
                    <th className="px-4 py-3.5">조건명 및 세부 기준 (금액·선수금·할부·카드종류)</th>
                    <th className="px-3 py-3.5 text-center">캐시백 / CM수수료</th>
                    <th className="px-4 py-3.5 text-right">버전예약 · 관리</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredConditions.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-12 text-center text-xs text-slate-500">
                        선택한 탭 및 필터 조건에 해당하는 거래 조건이 없습니다.
                      </td>
                    </tr>
                  ) : (
                    filteredConditions.map(({ cond, lifecycle }) => {
                      const badge = LIFECYCLE_BADGE[lifecycle];
                      return (
                        <tr
                          key={cond.id}
                          className={
                            lifecycle === 'ACTIVE_NOW'
                              ? 'hover:bg-emerald-50/20'
                              : lifecycle === 'SCHEDULED'
                              ? 'bg-amber-50/20 hover:bg-amber-50/40'
                              : 'bg-slate-50/60 opacity-80'
                          }
                        >
                          <td className="px-4 py-3.5 align-top">
                            <span
                              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold ${badge.className}`}
                            >
                              {badge.label}
                            </span>
                            <div className="mt-1.5 font-mono text-xs font-bold text-slate-800">
                              실행: {cond.effectiveFrom}
                            </div>
                            <div className="font-mono text-[11px] text-slate-500">
                              종료: {cond.effectiveTo ?? '상시 유지'}
                            </div>
                          </td>

                          <td className="px-3 py-3.5 align-top">
                            <div className="font-mono text-xs font-bold text-slate-900">
                              {cond.conditionGroupCode}
                            </div>
                            <div className="mt-1 flex items-center gap-1.5">
                              <span className="rounded bg-slate-200/80 px-1.5 py-0.5 font-mono text-[11px] font-bold text-slate-700">
                                v{cond.versionNo}
                              </span>
                              {cond.sheetRowId && (
                                <span className="rounded bg-teal-50 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-teal-700">
                                  {cond.sheetRowId}
                                </span>
                              )}
                            </div>
                          </td>

                          <td className="px-3 py-3.5 align-top">
                            <div className="font-bold text-slate-900">{cond.cardCompany}</div>
                            <div className="mt-0.5 text-xs text-slate-600">{cond.paymentMethod}</div>
                            <div className="mt-1.5 flex flex-wrap gap-1">
                              <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-bold text-indigo-700">
                                {cond.channelType}
                              </span>
                              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-700">
                                {cond.cardKind}
                              </span>
                            </div>
                          </td>

                          <td className="px-4 py-3.5 align-top">
                            <div className="font-semibold text-slate-900">{cond.title}</div>
                            <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px]">
                              <span className="rounded-md bg-slate-100 px-2 py-0.5 font-semibold text-slate-800">
                                금액: {formatManwonRange(cond.minAmount, cond.maxAmount)}
                              </span>
                              <span className="rounded-md bg-sky-50 px-2 py-0.5 font-medium text-sky-800">
                                선수금: {cond.downPaymentRule}
                              </span>
                              <span className="rounded-md bg-purple-50 px-2 py-0.5 font-medium text-purple-800">
                                할부·결제: {cond.installmentTerms}
                              </span>
                            </div>
                            <div className="mt-1.5 max-w-lg text-xs text-slate-500">
                              {cond.description}
                            </div>
                          </td>

                          <td className="px-3 py-3.5 text-center align-top">
                            <div>
                              <span className="rounded bg-emerald-50 px-2 py-0.5 text-xs font-bold tabular-nums text-emerald-700">
                                캐시백 {cond.customerCashbackRate}%
                              </span>
                            </div>
                            <div className="mt-1.5">
                              {cond.cmCommissionRate !== null ? (
                                <span className="rounded bg-indigo-50 px-2 py-0.5 text-xs font-bold tabular-nums text-indigo-700">
                                  CM {cond.cmCommissionRate}%
                                </span>
                              ) : (
                                <span className="rounded bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">
                                  건별 확정
                                </span>
                              )}
                            </div>
                          </td>

                          <td className="px-4 py-3.5 text-right align-top">
                            <div className="flex flex-col items-end gap-1.5">
                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => openScheduleNextVersionModal(cond)}
                                  title="새 실행일자로 차기 버전 예약 등록"
                                  className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-100"
                                >
                                  <GitBranchPlus className="h-3.5 w-3.5" />
                                  차기버전 예약
                                </button>
                                <button
                                  type="button"
                                  onClick={() => openEditModal(cond)}
                                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:border-indigo-300 hover:text-indigo-600"
                                >
                                  <Edit3 className="h-3 w-3" />
                                  수정
                                </button>
                              </div>

                              <button
                                type="button"
                                onClick={() => toggleConditionActive(cond.id)}
                                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold transition-colors ${
                                  cond.isActive
                                    ? 'text-emerald-700 hover:bg-emerald-50'
                                    : 'text-rose-600 hover:bg-rose-50'
                                }`}
                              >
                                {cond.isActive ? (
                                  <>
                                    <ToggleRight className="h-3.5 w-3.5" /> 시트활성
                                  </>
                                ) : (
                                  <>
                                    <ToggleLeft className="h-3.5 w-3.5" /> 수동중단됨
                                  </>
                                )}
                              </button>
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
        </>
      )}

      {/* Google Sheets Condition Sync Modal */}
      {syncModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3.5">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="h-5 w-5 text-teal-600" />
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    구글 시트 거래 조건 업데이트 동기화
                  </h3>
                  <p className="text-xs text-slate-500">
                    연동 문서: <strong>카나다라_오토캐시백_거래조건_마스터_2026</strong> · 탭:{' '}
                    <code className="font-mono">01_거래조건_마스터</code>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSyncModalOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Mode Switcher */}
            <div className="mt-4 grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1">
              <button
                type="button"
                onClick={() => setSyncMode('API_BATCH')}
                className={`rounded-lg py-2 text-xs font-bold transition-all ${
                  syncMode === 'API_BATCH'
                    ? 'bg-white text-teal-800 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                1. 연동 구글 시트 변경분 원클릭 불러오기
              </button>
              <button
                type="button"
                onClick={() => setSyncMode('PASTE_CSV')}
                className={`rounded-lg py-2 text-xs font-bold transition-all ${
                  syncMode === 'PASTE_CSV'
                    ? 'bg-white text-indigo-800 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                2. 구글 시트 행 복사·붙여넣기(TSV) / CSV 업로드
              </button>
            </div>

            {syncMode === 'API_BATCH' ? (
              <div className="mt-4 space-y-4 text-xs">
                <div className="rounded-xl border border-teal-200 bg-teal-50/70 p-3.5 text-teal-900">
                  <p className="font-bold">
                    구글 시트 [01_거래조건_마스터] 탭에서 신규 업데이트 행 {PENDING_GOOGLE_SHEET_SYNC_BATCH.length}건이 감지되었습니다.
                  </p>
                  <p className="mt-1 text-teal-800">
                    카드사별 실행일자가 서로 다르더라도 <strong>각 실행일자 전까지는 기존 버전이 자동 유지</strong>되며,
                    기존 버전의 종료일자가 <code className="font-mono">(새 실행일자 - 1일)</code>로 자동 정렬됩니다.
                  </p>
                </div>

                <div className="space-y-2.5">
                  {PENDING_GOOGLE_SHEET_SYNC_BATCH.map((row) => {
                    const prevCond = conditions.find(
                      (c) =>
                        c.conditionGroupCode === row.conditionGroupCode &&
                        c.effectiveFrom < row.effectiveFrom
                    );
                    const autoPrevEndDate = subtractOneDay(row.effectiveFrom);
                    const isImmediate = row.effectiveFrom <= systemReferenceDate;
                    return (
                      <div
                        key={row.sheetRowId}
                        className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="rounded bg-teal-100 px-1.5 py-0.5 font-mono text-[10px] font-bold text-teal-800">
                              {row.sheetRowId}
                            </span>
                            <span className="font-mono font-bold text-slate-800">
                              {row.conditionGroupCode} · v{row.versionNo}
                            </span>
                            <span className="font-bold text-slate-900">{row.cardCompany}</span>
                            <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-bold text-indigo-700">
                              {row.channelType}
                            </span>
                          </div>
                          <span
                            className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                              isImmediate
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-amber-100 text-amber-800'
                            }`}
                          >
                            실행일 {row.effectiveFrom} ({isImmediate ? '기준일 즉시 적용' : '실행일 전 기존유지'})
                          </span>
                        </div>
                        <p className="mt-1.5 text-sm font-bold text-slate-900">{row.title}</p>
                        <p className="mt-0.5 text-slate-600">
                          캐시백 <strong>{row.customerCashbackRate}%</strong> / CM수수료{' '}
                          <strong>{row.cmCommissionRate ?? '-'}%</strong> · 금액{' '}
                          {formatManwonRange(row.minAmount, row.maxAmount)} · 선수금: {row.downPaymentRule} ·{' '}
                          {row.installmentTerms}
                        </p>
                        <p className="mt-1.5 text-[11px] font-semibold text-indigo-700">
                          {prevCond
                            ? `↳ 기존 v${prevCond.versionNo}(${prevCond.customerCashbackRate}%) 조건은 ${autoPrevEndDate} 승인분까지 자동 유지 후 종료 설정됨`
                            : '↳ 신규 조건그룹 오픈 (기존 조건 영향 없음)'}
                        </p>
                      </div>
                    );
                  })}
                </div>

                {syncFeedback && (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 font-semibold text-emerald-800">
                    ✓ {syncFeedback}
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setSyncModalOpen(false)}
                    className="rounded-xl border border-slate-300 bg-white px-4 py-2 font-semibold text-slate-700"
                  >
                    닫기
                  </button>
                  <button
                    type="button"
                    onClick={handleRunSimulatedBatchSync}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-teal-600 px-5 py-2.5 font-semibold text-white shadow-sm hover:bg-teal-700"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    시트 변경분 {PENDING_GOOGLE_SHEET_SYNC_BATCH.length}건 동기화 반영
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-4 space-y-4 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-indigo-50/70 p-3 text-indigo-900">
                  <span>
                    구글 시트 <code className="font-mono">01_거래조건_마스터</code> 탭의 A~P열을 드래그 복사해
                    붙여넣거나 CSV 파일을 업로드하세요.
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setRawSheetText(SAMPLE_PASTE_TSV)}
                      className="font-bold text-indigo-700 underline hover:text-indigo-950"
                    >
                      샘플 시트 행(하나·삼성) 자동채움
                    </button>
                    <label className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-indigo-200 bg-white px-2.5 py-1 font-semibold text-indigo-700 hover:bg-indigo-100">
                      <Upload className="h-3.5 w-3.5" />
                      CSV 파일 선택
                      <input
                        type="file"
                        accept=".csv,.tsv,.txt"
                        onChange={handleCsvFileUpload}
                        className="hidden"
                      />
                    </label>
                  </div>
                </div>

                <textarea
                  rows={6}
                  value={rawSheetText}
                  onChange={(e) => setRawSheetText(e.target.value)}
                  placeholder="시트행ID [TAB] 조건그룹코드 [TAB] 버전 [TAB] 실행일자(YYYY-MM-DD) [TAB] 카드사 [TAB] 거래방법 [TAB] 진행경로 [TAB] 카드종류 [TAB] 최소금액 [TAB] 최대금액 [TAB] 선수금비율 [TAB] 할부개월 [TAB] 표준조건명 [TAB] 고객캐시백율 [TAB] CM수수료율 [TAB] 세부설명"
                  className="w-full rounded-xl border border-slate-300 p-3 font-mono text-[11px] text-slate-800 focus:border-indigo-500 focus:outline-none"
                />

                {parsedPastePreview && (
                  <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3.5">
                    <p className="font-bold text-slate-900">
                      파싱 검증 결과: 유효 조건{' '}
                      <span className="text-emerald-700">{parsedPastePreview.rows.length}건</span>
                      {parsedPastePreview.errors.length > 0 && (
                        <span className="ml-2 text-rose-600">
                          · 오류 {parsedPastePreview.errors.length}건
                        </span>
                      )}
                    </p>
                    {parsedPastePreview.errors.map((err, i) => (
                      <p key={i} className="text-rose-600">
                        • {err}
                      </p>
                    ))}
                    {parsedPastePreview.rows.map((r, i) => (
                      <div
                        key={i}
                        className="rounded-lg bg-white px-3 py-2 text-[11px] text-slate-700 ring-1 ring-slate-200"
                      >
                        <strong>
                          [{r.effectiveFrom} 실행] {r.cardCompany} · {r.channelType} · {r.title}
                        </strong>{' '}
                        (그룹 <code className="font-mono">{r.conditionGroupCode}</code> v{r.versionNo} / 캐시백{' '}
                        {r.customerCashbackRate}% / CM {r.cmCommissionRate ?? '특약'}%)
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setSyncModalOpen(false)}
                    className="rounded-xl border border-slate-300 bg-white px-4 py-2 font-semibold text-slate-700"
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    disabled={!parsedPastePreview || parsedPastePreview.rows.length === 0}
                    onClick={handleRunPasteSync}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-5 py-2.5 font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    검증된 {parsedPastePreview?.rows.length ?? 0}건 조건 동기화 실행
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Manual Add / Edit / Next-Version Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
          <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900">
                {editingCond ? '거래 조건 및 실행일자 수정' : '새 거래 조건 버전 등록 (실행일자 기준)'}
              </h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {formError && (
              <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-medium text-rose-700">
                {formError}
              </div>
            )}

            <form onSubmit={handleSave} className="mt-4 space-y-3.5 text-xs">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="sm:col-span-2">
                  <label className="block font-semibold text-slate-700">
                    조건그룹코드 * <span className="font-normal text-slate-400">(동일그룹 버전연결)</span>
                  </label>
                  <input
                    type="text"
                    value={conditionGroupCode}
                    onChange={(e) => setConditionGroupCode(e.target.value)}
                    placeholder="예: SS-PRE-3000"
                    className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 font-mono text-xs font-bold"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700">버전 번호</label>
                  <input
                    type="number"
                    min="1"
                    value={versionNo}
                    onChange={(e) => setVersionNo(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 font-mono text-xs font-bold"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-indigo-700">실행일자 (승인기준) *</label>
                  <input
                    type="date"
                    value={effectiveFrom}
                    onChange={(e) => setEffectiveFrom(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-indigo-300 bg-indigo-50/40 px-2.5 py-2 font-mono text-xs font-bold text-slate-900"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div>
                  <label className="block font-semibold text-slate-700">카드사 *</label>
                  <select
                    value={cardCompany}
                    onChange={(e) => setCardCompany(e.target.value as CardCompany)}
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-2.5 py-2 text-xs font-semibold"
                  >
                    {CARD_COMPANIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700">거래 방법 *</label>
                  <select
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-2.5 py-2 text-xs font-semibold"
                  >
                    {PAYMENT_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700">진행 경로 *</label>
                  <select
                    value={channelType}
                    onChange={(e) => setChannelType(e.target.value as ChannelType)}
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-2.5 py-2 text-xs font-semibold"
                  >
                    {CHANNEL_TYPES.map((ch) => (
                      <option key={ch} value={ch}>
                        {ch}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700">카드 종류 *</label>
                  <select
                    value={cardKind}
                    onChange={(e) => setCardKind(e.target.value as CardKind)}
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-2.5 py-2 text-xs font-semibold"
                  >
                    {CARD_KINDS.map((ck) => (
                      <option key={ck} value={ck}>
                        {ck}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700">표준 조건명 *</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="예: [11/15 실행] 삼성 AG다이렉트 선입금 2.05% (3천만 이상)"
                  className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div>
                  <label className="block font-semibold text-slate-700">최소 기준금액(원)</label>
                  <input
                    type="number"
                    step="1000000"
                    value={minAmount}
                    onChange={(e) => setMinAmount(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-xs font-bold"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700">
                    최대 한도금액(원) <span className="font-normal text-slate-400">(빈값=무제한)</span>
                  </label>
                  <input
                    type="number"
                    step="1000000"
                    value={maxAmount}
                    onChange={(e) => setMaxAmount(e.target.value)}
                    placeholder="무제한"
                    className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-xs font-bold"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700">고객 캐시백율(%)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={customerCashbackRate}
                    onChange={(e) => setCustomerCashbackRate(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-xs font-bold text-emerald-700"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700">CM 수수료율(%)</label>
                  <input
                    type="number"
                    step="0.01"
                    disabled={isCommissionDeferred}
                    value={cmCommissionRate}
                    onChange={(e) => setCmCommissionRate(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-xs font-bold text-indigo-700 disabled:bg-slate-100"
                  />
                  <label className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-600">
                    <input
                      type="checkbox"
                      checked={isCommissionDeferred}
                      onChange={(e) => setIsCommissionDeferred(e.target.checked)}
                    />
                    건별 별도 확정(특약)
                  </label>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block font-semibold text-slate-700">선수금 비율 조건</label>
                  <input
                    type="text"
                    value={downPaymentRule}
                    onChange={(e) => setDownPaymentRule(e.target.value)}
                    placeholder="예: 차량가 선수금 15% 이상 / 신청금액 100% 선입금"
                    className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-xs"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700">할부개월 및 금리 조건</label>
                  <input
                    type="text"
                    value={installmentTerms}
                    onChange={(e) => setInstallmentTerms(e.target.value)}
                    placeholder="예: 36 / 48 / 60개월 (고정 4.5%) 또는 일시불"
                    className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-xs"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700">세부 기준 및 유의사항 설명</label>
                <textarea
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="예: 실행일 거래승인 건부터 적용되며 실행일 전 승인 건은 이전 조건이 유지됩니다."
                  className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-xs focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-1 gap-3 rounded-xl bg-slate-50 p-3 sm:grid-cols-2">
                <div>
                  <label className="block font-semibold text-slate-700">
                    수동 종료일자 <span className="font-normal text-slate-400">(차기버전 있으면 자동계산)</span>
                  </label>
                  <input
                    type="date"
                    value={effectiveTo}
                    onChange={(e) => setEffectiveTo(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700">운영 활성 여부</label>
                  <select
                    value={isActive ? 'YES' : 'NO'}
                    onChange={(e) => setIsActive(e.target.value === 'YES')}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-800"
                  >
                    <option value="YES">활성 (실행일 도래 시 자동 노출)</option>
                    <option value="NO">수동 중단 (노출 제외)</option>
                  </select>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700"
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-indigo-600 px-5 py-2 text-xs font-semibold text-white hover:bg-indigo-700"
                >
                  조건 버전 저장
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
