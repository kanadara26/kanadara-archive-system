import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import {
  APPROVAL_STATUS_META,
  CardApplicationStatus,
} from '../types';
import {
  ApprovalStatusBadge,
  RoleBadge,
  SlipAndSheetBadge,
} from '../components/StatusBadges';
import { calcExpectedCommission, formatKRW, formatNumber, nowFormatted } from '../utils/format';
import {
  ArrowLeft,
  ShieldAlert,
  ShieldCheck,
  Eye,
  EyeOff,
  PlayCircle,
  CheckCircle2,
  XCircle,
  Building2,
  FileSpreadsheet,
  Upload,
  RefreshCw,
  Clock,
  AlertTriangle,
  FileCheck2,
  RotateCcw,
  ArrowRightLeft,
  Lock,
  CalendarClock,
} from 'lucide-react';

const REJECTION_PRESETS = [
  '카드사 특별한도 심사 결과 요청 금액 대비 승인 가능 한도 부족 (선입금 방식 전환 권고)',
  '자동차 매매계약서 계약자 명의와 결제 카드 명의자 불일치',
  '선택한 오토캐시백 조건의 대상 차종·결제수단 규정 미충족',
  '고객 본인 확인(ARS/녹취) 미완료 또는 타 에이전시 중복 심사 접수 건',
];

export const TransactionDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const {
    currentUser,
    transactions,
    systemReferenceDate,
    getUserById,
    canAccessTransaction,
    canManageApprovalOf,
    getEffectiveConditionForGroup,
    getScheduledNextConditionForGroup,
    startReview,
    recordCardApplication,
    decideApproval,
    submitSlip,
    retrySheetSync,
    fixTransactionCommissionRate,
    quickSwitchUser,
  } = useApp();

  const tx = transactions.find((t) => t.id === id);

  // Sensitive identifier verification toggle (AG / Admin only)
  const [showVerifyId, setShowVerifyId] = useState(false);

  // AG Card Application form state
  const [cardAppStatus, setCardAppStatus] = useState<CardApplicationStatus>('APPLIED');
  const [cardAppAt, setCardAppAt] = useState('');
  const [cardAppHandler, setCardAppHandler] = useState('');
  const [cardAppRefNo, setCardAppRefNo] = useState('');
  const [cardAppMemo, setCardAppMemo] = useState('');

  // AG Approve / Reject state
  const [decisionMode, setDecisionMode] = useState<'APPROVE' | 'REJECT'>('APPROVE');
  const [approvalDateInput, setApprovalDateInput] = useState(systemReferenceDate);
  const [approvalNote, setApprovalNote] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [decisionError, setDecisionError] = useState<string | null>(null);

  // CM Slip Submission form state
  const [approvalNumber, setApprovalNumber] = useState('');
  const [approvedDate, setApprovedDate] = useState('');
  const [approvedAmountStr, setApprovedAmountStr] = useState('');
  const [merchantName, setMerchantName] = useState('현대자동차(주) 국내영업본부');
  const [fileName, setFileName] = useState('');
  const [fileSizeLabel, setFileSizeLabel] = useState('');
  const [slipMemo, setSlipMemo] = useState('');
  const [simulateResult, setSimulateResult] = useState<
    'SUCCESS' | 'AUTH_EXPIRED' | 'API_TIMEOUT'
  >('SUCCESS');
  const [slipError, setSlipError] = useState<string | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);

  // Commission fix inline input (when cmCommissionRate === null)
  const [commissionFixInput, setCommissionFixInput] = useState('0.45');

  useEffect(() => {
    setApprovalDateInput(systemReferenceDate);
  }, [systemReferenceDate, tx?.id]);

  useEffect(() => {
    if (!tx) return;
    setCardAppStatus(
      tx.cardApplication.status === 'NOT_APPLIED' ? 'APPLIED' : tx.cardApplication.status
    );
    setCardAppAt(tx.cardApplication.appliedAt || nowFormatted());
    setCardAppHandler(tx.cardApplication.handlerName || currentUser?.name || '');
    setCardAppRefNo(tx.cardApplication.referenceNo || '');
    setCardAppMemo(tx.cardApplication.memo || '');
    setApprovedAmountStr(String(tx.amount));
    setApprovedDate(nowFormatted());
    setShowVerifyId(false);
    setDecisionError(null);
    setSlipError(null);
  }, [tx?.id, currentUser?.id]);

  if (!currentUser) return null;

  // Acceptance Criterion 1.3 & 4.2: Direct URL / unauthorized access completely blocked without leaking data
  if (!tx || !canAccessTransaction(tx, currentUser)) {
    return (
      <div className="mx-auto max-w-xl rounded-2xl border border-rose-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-rose-50 text-rose-600">
          <ShieldAlert className="h-7 w-7" />
        </div>
        <h1 className="mt-4 text-lg font-bold text-slate-900">
          접근 권한이 없거나 존재하지 않는 거래입니다
        </h1>
        <p className="mt-2 text-xs leading-relaxed text-slate-600">
          카나다라 보안 정책에 따라 CM은 본인이 등록한 거래만, AG는 배정된 담당 CM의 거래만 조회 및
          처리할 수 있습니다. 권한 범위 밖의 거래 상세 URL 직접 접근이 차단되었으며 어떠한 고객
          데이터도 노출되지 않았습니다.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <Link
            to="/transactions"
            className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white hover:bg-slate-800"
          >
            <ArrowLeft className="h-4 w-4" />
            허용된 거래 목록으로 이동
          </Link>
        </div>
      </div>
    );
  }

  const cmUser = getUserById(tx.cmId);
  const agUser = getUserById(tx.agId);
  const isAssignedAg = canManageApprovalOf(tx, currentUser);
  const isOwningCm = currentUser.role === 'CM' && tx.cmId === currentUser.id;
  const canRetrySheet =
    (currentUser.role === 'AG' && canAccessTransaction(tx, currentUser)) ||
    currentUser.role === 'ADMIN';

  const handleStartReview = () => {
    const res = startReview(tx.id);
    if (!res.ok) setDecisionError(res.message);
  };

  const handleSaveCardApp = (e: React.FormEvent) => {
    e.preventDefault();
    recordCardApplication(tx.id, {
      status: cardAppStatus,
      appliedAt: cardAppAt || nowFormatted(),
      handlerName: cardAppHandler,
      referenceNo: cardAppRefNo,
      memo: cardAppMemo,
    });
  };

  const handleDecisionSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setDecisionError(null);
    if (decisionMode === 'REJECT' && !rejectionReason.trim()) {
      setDecisionError('반려 시 CM에게 공유할 반려 사유를 반드시 입력해야 합니다.');
      return;
    }
    const res = decideApproval(
      tx.id,
      decisionMode === 'APPROVE' ? 'APPROVED' : 'REJECTED',
      decisionMode === 'APPROVE' ? approvalNote : rejectionReason,
      approvalDateInput
    );
    if (!res.ok) {
      setDecisionError(res.message);
    }
  };

  const handleFileUploadChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const kb = Math.max(1, Math.round(file.size / 1024));
    setFileSizeLabel(kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} KB`);
    setSlipError(null);
  };

  const handleFillSampleSlip = () => {
    const randApproval = String(Math.floor(10000000 + Math.random() * 89999999));
    setApprovalNumber(randApproval);
    setApprovedDate(nowFormatted());
    setApprovedAmountStr(String(tx.amount));
    setMerchantName(
      tx.cardCompany === '현대카드'
        ? '현대자동차(주) 국내영업본부'
        : `${tx.cardCompany} 제휴 자동차판매점`
    );
    setFileName(`${tx.cardCompany}_매출전표_${tx.customerName}_${randApproval}.jpg`);
    setFileSizeLabel('1.3 MB');
    setSlipMemo('고객 차량 출고 잔금 카드 승인 완료');
    setSlipError(null);
  };

  const handleSubmitSlip = (e: React.FormEvent) => {
    e.preventDefault();
    setSlipError(null);
    const numericApproved = Number(approvedAmountStr.replace(/\D/g, '')) || 0;
    const res = submitSlip(tx.id, {
      approvalNumber,
      approvedDate,
      approvedAmount: numericApproved,
      merchantName,
      fileName,
      fileSizeLabel: fileSizeLabel || '1.2 MB',
      memo: slipMemo,
      simulateResult,
    });
    if (!res.ok) {
      setSlipError(res.message);
    }
  };

  const handleRetrySheet = () => {
    setIsRetrying(true);
    setTimeout(() => {
      retrySheetSync(tx.id);
      setIsRetrying(false);
    }, 320);
  };

  const handleReRequestFromRejected = () => {
    navigate('/requests/new', {
      state: {
        prefill: {
          customerName: tx.customerName,
          vehicleInfo: tx.vehicleInfo,
          cardCompany: tx.cardCompany,
          paymentMethod:
            tx.paymentMethod === '일시불 오토캐시백'
              ? '선입금(가상계좌) 캐시백'
              : tx.paymentMethod,
          amount: tx.amount,
          fromRejectedId: tx.id,
        },
      },
    });
  };

  // Visual workflow step state
  const step1Done = true;
  const step2Active = tx.status === 'WAITING';
  const step2Done =
    tx.status === 'REVIEWING' || tx.status === 'APPROVED' || tx.status === 'REJECTED';
  const step3Active = tx.status === 'REVIEWING';
  const step3Done = tx.status === 'APPROVED' || tx.status === 'REJECTED';
  const step4Active = tx.status === 'APPROVED' && !tx.slip;
  const step4Done = Boolean(tx.slip && tx.sheetSync.status === 'SYNCED');
  const step4Failed = Boolean(tx.slip && tx.sheetSync.status === 'FAILED');

  const expectedCommission = calcExpectedCommission(tx);
  const scheduledNextCond = getScheduledNextConditionForGroup(
    tx.conditionSnapshot.conditionGroupCode,
    systemReferenceDate
  );
  const effectiveCondOnApprovalDate = getEffectiveConditionForGroup(
    tx.conditionSnapshot.conditionGroupCode,
    approvalDateInput
  );
  const willSwitchOnApproval = Boolean(
    effectiveCondOnApprovalDate &&
      effectiveCondOnApprovalDate.id !== tx.conditionSnapshot.conditionId
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Top Breadcrumb & Header */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <Link
            to="/transactions"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-900"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            거래 목록으로 돌아가기
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-2.5">
            <h1 className="font-mono text-2xl font-bold tracking-tight text-slate-900">{tx.id}</h1>
            <ApprovalStatusBadge status={tx.status} />
            <SlipAndSheetBadge tx={tx} />
          </div>
          <p className="mt-1 text-xs text-slate-500">
            등록일시 {tx.createdAt} · 최종 변경 {tx.updatedAt} · 요청 CM:{' '}
            <strong className="text-slate-700">
              {cmUser?.name} ({cmUser?.affiliation})
            </strong>{' '}
            · 담당 AG:{' '}
            <strong className="text-slate-700">
              {agUser?.name} ({agUser?.affiliation})
            </strong>
          </p>
        </div>

        {/* Helpful Role-Switch Shortcut for Interactive Evaluation */}
        <div className="flex flex-wrap items-center gap-2">
          {!isAssignedAg && agUser && (tx.status === 'WAITING' || tx.status === 'REVIEWING') && (
            <button
              type="button"
              onClick={() => quickSwitchUser(agUser.id)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
            >
              <ArrowRightLeft className="h-3.5 w-3.5" />
              담당 AG({agUser.name})로 전환해 승인 검토하기
            </button>
          )}
          {!isOwningCm && cmUser && tx.status === 'APPROVED' && !tx.slip && (
            <button
              type="button"
              onClick={() => quickSwitchUser(cmUser.id)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
            >
              <ArrowRightLeft className="h-3.5 w-3.5" />
              요청 CM({cmUser.name})으로 전환해 전표 제출하기
            </button>
          )}
        </div>
      </div>

      {/* Workflow Stepper Bar */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 shadow-sm">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="flex items-center gap-3 rounded-xl bg-slate-50 p-3">
            <span
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                step1Done ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-600'
              }`}
            >
              1
            </span>
            <div className="min-w-0">
              <p className="text-xs font-bold text-slate-900">승인 요청 등록</p>
              <p className="truncate text-[11px] text-slate-500">{tx.createdAt}</p>
            </div>
          </div>

          <div
            className={`flex items-center gap-3 rounded-xl p-3 ${
              step2Active
                ? 'bg-amber-50 ring-1 ring-amber-300'
                : step2Done
                ? 'bg-slate-50'
                : 'bg-slate-50/50'
            }`}
          >
            <span
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                step2Done
                  ? 'bg-indigo-600 text-white'
                  : step2Active
                  ? 'bg-amber-500 text-white'
                  : 'bg-slate-200 text-slate-500'
              }`}
            >
              2
            </span>
            <div className="min-w-0">
              <p className="text-xs font-bold text-slate-900">AG 검토 · 카드사 신청</p>
              <p className="truncate text-[11px] text-slate-500">
                {tx.status === 'WAITING'
                  ? 'AG 검토 시작 대기'
                  : tx.cardApplication.status === 'APPLIED'
                  ? '카드사 신청 완료'
                  : tx.cardApplication.status === 'DOC_REQUESTED'
                  ? '보완서류 요청중'
                  : 'AG 검토 진행중'}
              </p>
            </div>
          </div>

          <div
            className={`flex items-center gap-3 rounded-xl p-3 ${
              tx.status === 'REJECTED'
                ? 'bg-rose-50 ring-1 ring-rose-300'
                : step3Active
                ? 'bg-blue-50 ring-1 ring-blue-300'
                : step3Done
                ? 'bg-emerald-50/60'
                : 'bg-slate-50/50'
            }`}
          >
            <span
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                tx.status === 'REJECTED'
                  ? 'bg-rose-600 text-white'
                  : tx.status === 'APPROVED'
                  ? 'bg-emerald-600 text-white'
                  : step3Active
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-200 text-slate-500'
              }`}
            >
              3
            </span>
            <div className="min-w-0">
              <p className="text-xs font-bold text-slate-900">승인 · 반려 결과</p>
              <p className="truncate text-[11px] text-slate-500">
                {APPROVAL_STATUS_META[tx.status].label}
              </p>
            </div>
          </div>

          <div
            className={`flex items-center gap-3 rounded-xl p-3 ${
              step4Failed
                ? 'bg-rose-50 ring-1 ring-rose-300'
                : step4Done
                ? 'bg-teal-50 ring-1 ring-teal-200'
                : step4Active
                ? 'bg-indigo-50 ring-1 ring-indigo-300'
                : 'bg-slate-50/50'
            }`}
          >
            <span
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                step4Failed
                  ? 'bg-rose-600 text-white'
                  : step4Done
                  ? 'bg-teal-600 text-white'
                  : step4Active
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-200 text-slate-500'
              }`}
            >
              4
            </span>
            <div className="min-w-0">
              <p className="text-xs font-bold text-slate-900">전표 · 구글 시트 입력</p>
              <p className="truncate text-[11px] text-slate-500">
                {step4Done
                  ? tx.sheetSync.externalRowId
                  : step4Failed
                  ? '시트 재처리 필요'
                  : step4Active
                  ? 'CM 전표 제출 대기'
                  : '승인 후 활성화'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Prominent Rejection Reason Banner */}
      {tx.status === 'REJECTED' && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 shadow-sm">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
            <div className="flex items-start gap-3">
              <XCircle className="mt-0.5 h-6 w-6 shrink-0 text-rose-600" />
              <div>
                <h2 className="text-sm font-bold text-rose-900">
                  승인 요청이 반려되었습니다 (반려 사유 공유됨)
                </h2>
                <p className="mt-1.5 text-sm leading-relaxed text-rose-800">
                  {tx.rejectionReason || '반려 사유 미기재'}
                </p>
                <p className="mt-2 text-xs text-rose-600">
                  * 상태 무결성 정책에 따라 이미 반려 확정된 거래의 상태를 임의로 역전할 수 없으며, 조건을
                  보완하여 신규 승인 요청으로 재접수할 수 있습니다.
                </p>
              </div>
            </div>
            {isOwningCm && (
              <button
                type="button"
                onClick={handleReRequestFromRejected}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-rose-700"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                조건 보완하여 신규 재요청 등록
              </button>
            )}
          </div>
        </div>
      )}

      {/* Main 2-Column Layout */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left 7 Cols: Request Info + Role Action Panels */}
        <div className="space-y-6 lg:col-span-7">
          {/* Deal & Customer Details Card */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <h2 className="text-base font-bold text-slate-900">승인 요청 및 선택 거래 조건</h2>
              <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600">
                제출 당시 조건 스냅샷 보존
              </span>
            </div>

            <dl className="mt-4 grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
              <div className="rounded-xl bg-slate-50 p-3.5">
                <dt className="text-xs font-medium text-slate-500">고객 성명 / 차량정보</dt>
                <dd className="mt-1 font-bold text-slate-900">{tx.customerName}</dd>
                <dd className="mt-0.5 text-xs text-slate-600">{tx.vehicleInfo}</dd>
              </div>

              <div className="rounded-xl bg-slate-50 p-3.5">
                <div className="flex items-center justify-between">
                  <dt className="text-xs font-medium text-slate-500">
                    고객 식별정보 ({tx.identifierType === 'CARD_NUMBER' ? '카드번호' : '주민등록번호'})
                  </dt>
                  {(isAssignedAg || currentUser.role === 'ADMIN') && (
                    <button
                      type="button"
                      onClick={() => setShowVerifyId((v) => !v)}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-600 hover:text-indigo-800"
                    >
                      {showVerifyId ? (
                        <>
                          <EyeOff className="h-3 w-3" /> 마스킹 복귀
                        </>
                      ) : (
                        <>
                          <Eye className="h-3 w-3" /> 카드사 대조값
                        </>
                      )}
                    </button>
                  )}
                </div>
                <dd className="mt-1 font-mono text-sm font-bold text-slate-900">
                  {showVerifyId ? tx.agVerifyIdentifier : tx.maskedIdentifier}
                </dd>
                <dd className="mt-0.5 flex items-center gap-1 text-[11px] text-slate-500">
                  <ShieldCheck className="h-3 w-3 text-emerald-600" />
                  {showVerifyId
                    ? 'AG·관리자 권한 제한 대조용 (원문 암호화 보관)'
                    : '권한별 민감정보 마스킹 적용됨'}
                </dd>
              </div>

              <div className="rounded-xl bg-slate-50 p-3.5">
                <dt className="text-xs font-medium text-slate-500">카드사 · 거래 방법 · 진행경로</dt>
                <dd className="mt-1 flex flex-wrap items-center gap-1.5 font-bold text-slate-900">
                  <span>
                    {tx.cardCompany} · {tx.paymentMethod}
                  </span>
                  {tx.conditionSnapshot.channelType && (
                    <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[11px] font-bold text-indigo-800">
                      {tx.conditionSnapshot.channelType}
                    </span>
                  )}
                </dd>
              </div>

              <div className="rounded-xl bg-indigo-50/70 p-3.5">
                <dt className="text-xs font-medium text-indigo-700">
                  신청 금액 · 캐시백 · 예상 수수료
                </dt>
                <dd className="mt-1 text-lg font-extrabold tabular-nums text-indigo-900">
                  {formatKRW(tx.amount)}
                </dd>
                <dd className="mt-0.5 text-xs tabular-nums text-indigo-700">
                  캐시백 {tx.conditionSnapshot.customerCashbackRate}% /{' '}
                  <strong>
                    {expectedCommission !== null
                      ? `예상수수료 ${formatKRW(expectedCommission)}`
                      : '예상수수료 별도확정'}
                  </strong>
                </dd>
              </div>

              <div className="rounded-xl border border-slate-200 p-4 sm:col-span-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs font-semibold text-slate-500">적용된 거래 조건</span>
                    {tx.conditionSnapshot.conditionGroupCode && (
                      <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-[11px] font-semibold text-slate-700">
                        {tx.conditionSnapshot.conditionGroupCode}
                        {tx.conditionSnapshot.versionNo ? ` · v${tx.conditionSnapshot.versionNo}` : ''}
                      </span>
                    )}
                    {tx.conditionSnapshot.effectiveFrom && (
                      <span className="rounded bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-700">
                        실행일 {tx.conditionSnapshot.effectiveFrom}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="rounded bg-emerald-50 px-2 py-0.5 text-xs font-bold text-emerald-700">
                      고객 캐시백 {tx.conditionSnapshot.customerCashbackRate}% (
                      {formatKRW(
                        Math.round((tx.amount * tx.conditionSnapshot.customerCashbackRate) / 100)
                      )}
                      )
                    </span>
                    {tx.conditionSnapshot.cmCommissionRate !== null ? (
                      <span className="rounded bg-indigo-50 px-2 py-0.5 text-xs font-bold text-indigo-700">
                        CM 수수료 {tx.conditionSnapshot.cmCommissionRate}% (
                        {formatKRW(
                          Math.round((tx.amount * tx.conditionSnapshot.cmCommissionRate) / 100)
                        )}
                        )
                      </span>
                    ) : (
                      <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800">
                        CM 수수료율 미확정 (정산 전 확정 필요)
                      </span>
                    )}
                  </div>
                </div>
                <p className="mt-1.5 text-sm font-bold text-slate-900">
                  {tx.conditionSnapshot.title}
                </p>
                <p className="mt-0.5 text-xs text-slate-600">{tx.conditionSnapshot.description}</p>

                {(tx.conditionSnapshot.cardKind ||
                  tx.conditionSnapshot.downPaymentRule ||
                  tx.conditionSnapshot.installmentTerms) && (
                  <div className="mt-2.5 flex flex-wrap gap-1.5 text-[11px]">
                    {tx.conditionSnapshot.cardKind && (
                      <span className="rounded-md bg-slate-100 px-2 py-0.5 font-medium text-slate-700">
                        카드종류: {tx.conditionSnapshot.cardKind}
                      </span>
                    )}
                    {tx.conditionSnapshot.downPaymentRule && (
                      <span className="rounded-md bg-slate-100 px-2 py-0.5 font-medium text-slate-700">
                        선수금: {tx.conditionSnapshot.downPaymentRule}
                      </span>
                    )}
                    {tx.conditionSnapshot.installmentTerms && (
                      <span className="rounded-md bg-slate-100 px-2 py-0.5 font-medium text-slate-700">
                        할부·결제: {tx.conditionSnapshot.installmentTerms}
                      </span>
                    )}
                  </div>
                )}

                {tx.conditionSnapshot.appliedBasisNote && (
                  <div className="mt-2.5 flex items-center gap-1.5 rounded-lg bg-indigo-50/70 px-3 py-1.5 text-[11px] font-medium text-indigo-800">
                    <CalendarClock className="h-3.5 w-3.5 shrink-0 text-indigo-600" />
                    <span>{tx.conditionSnapshot.appliedBasisNote}</span>
                  </div>
                )}
              </div>

              {tx.requestMemo && (
                <div className="rounded-xl bg-amber-50/60 p-3.5 sm:col-span-2">
                  <dt className="text-xs font-semibold text-amber-800">CM 요청 전달 메모</dt>
                  <dd className="mt-1 text-xs leading-relaxed text-slate-800">{tx.requestMemo}</dd>
                </div>
              )}
            </dl>

            {/* Missing Commission Fix Inline Helper for AG / Admin (links directly to Spec 6.1/6.2) */}
            {tx.conditionSnapshot.cmCommissionRate === null &&
              (currentUser.role === 'ADMIN' || isAssignedAg) && (
                <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4">
                  <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                    <div>
                      <p className="text-xs font-bold text-amber-900">
                        ⚠️ 월별 수수료 정산 산정 데이터 누락 안내
                      </p>
                      <p className="mt-0.5 text-xs text-amber-800">
                        법인 특약 조건으로 CM 지급 수수료율이 아직 확정되지 않았습니다. 정산 집계를 위해
                        수수료율(%)을 확정해 주세요.
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <input
                        type="number"
                        step="0.05"
                        min="0"
                        max="5"
                        value={commissionFixInput}
                        onChange={(e) => setCommissionFixInput(e.target.value)}
                        className="w-20 rounded-lg border border-amber-300 bg-white px-2.5 py-1.5 text-right text-xs font-bold"
                      />
                      <span className="text-xs font-bold text-amber-900">%</span>
                      <button
                        type="button"
                        onClick={() =>
                          fixTransactionCommissionRate(
                            tx.id,
                            Number(commissionFixInput),
                            '법인 특약 건별 수수료율 운영 확정'
                          )
                        }
                        className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700"
                      >
                        수수료율 확정
                      </button>
                    </div>
                  </div>
                </div>
              )}
          </div>

          {/* Card Company Application Progress Card (Read-only summary for CM & Admin, Editable for Assigned AG) */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div className="flex items-center gap-2">
                <Building2 className="h-5 w-5 text-indigo-600" />
                <div>
                  <h2 className="text-base font-bold text-slate-900">카드사 승인 신청 진행 내역</h2>
                  <p className="text-xs text-slate-500">
                    승인 상태와 별도로 카드사 접수 여부·접수 시각·담당자를 기록하고 공유합니다.
                  </p>
                </div>
              </div>
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                  tx.cardApplication.status === 'APPLIED'
                    ? 'bg-indigo-50 text-indigo-700'
                    : tx.cardApplication.status === 'DOC_REQUESTED'
                    ? 'bg-amber-50 text-amber-800'
                    : 'bg-slate-100 text-slate-600'
                }`}
              >
                {tx.cardApplication.status === 'APPLIED'
                  ? '카드사 신청완료'
                  : tx.cardApplication.status === 'DOC_REQUESTED'
                  ? '보완서류 요청'
                  : '카드사 미신청'}
              </span>
            </div>

            {isAssignedAg && tx.status !== 'REJECTED' ? (
              <form onSubmit={handleSaveCardApp} className="mt-4 space-y-3.5">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700">
                      카드사 신청 여부
                    </label>
                    <select
                      value={cardAppStatus}
                      onChange={(e) => setCardAppStatus(e.target.value as CardApplicationStatus)}
                      className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 focus:border-indigo-500 focus:outline-none"
                    >
                      <option value="NOT_APPLIED">미신청</option>
                      <option value="APPLIED">카드사 신청완료</option>
                      <option value="DOC_REQUESTED">보완서류 요청 진행중</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700">신청 시각</label>
                    <input
                      type="text"
                      value={cardAppAt}
                      onChange={(e) => setCardAppAt(e.target.value)}
                      placeholder="YYYY-MM-DD HH:mm"
                      className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 focus:border-indigo-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700">
                      신청 담당자 / 카드사 심사역
                    </label>
                    <input
                      type="text"
                      value={cardAppHandler}
                      onChange={(e) => setCardAppHandler(e.target.value)}
                      placeholder="예: 이지훈 (삼성카드 오토센터 접수)"
                      className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 focus:border-indigo-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700">
                      카드사 접수번호 (선택)
                    </label>
                    <input
                      type="text"
                      value={cardAppRefNo}
                      onChange={(e) => setCardAppRefNo(e.target.value)}
                      placeholder="예: SS-20261030-9912"
                      className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-800 focus:border-indigo-500 focus:outline-none"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700">
                    카드사 소통 및 진행 메모
                  </label>
                  <input
                    type="text"
                    value={cardAppMemo}
                    onChange={(e) => setCardAppMemo(e.target.value)}
                    placeholder="예: 고객 본인 녹취 확인 완료, 가상계좌 입금 매칭 대기"
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 focus:border-indigo-500 focus:outline-none"
                  />
                </div>
                <div className="flex justify-end">
                  <button
                    type="submit"
                    className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800"
                  >
                    카드사 신청 내역 저장
                  </button>
                </div>
              </form>
            ) : (
              <div className="mt-4 grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
                <div className="rounded-xl bg-slate-50 p-3">
                  <span className="text-slate-500">신청 시각:</span>{' '}
                  <strong className="text-slate-800">
                    {tx.cardApplication.appliedAt || '기록 전'}
                  </strong>
                </div>
                <div className="rounded-xl bg-slate-50 p-3">
                  <span className="text-slate-500">담당자:</span>{' '}
                  <strong className="text-slate-800">
                    {tx.cardApplication.handlerName || agUser?.name || '-'}
                  </strong>
                </div>
                {tx.cardApplication.referenceNo && (
                  <div className="rounded-xl bg-slate-50 p-3">
                    <span className="text-slate-500">카드사 접수번호:</span>{' '}
                    <strong className="font-mono text-slate-800">
                      {tx.cardApplication.referenceNo}
                    </strong>
                  </div>
                )}
                {tx.cardApplication.memo && (
                  <div className="rounded-xl bg-slate-50 p-3 sm:col-span-2">
                    <span className="text-slate-500">진행 메모:</span>{' '}
                    <span className="text-slate-800">{tx.cardApplication.memo}</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* AG Approval Decision Panel (Spec 3.1.1 & 3.1.3) */}
          {isAssignedAg && (
            <div className="rounded-2xl border-2 border-indigo-200 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                <div>
                  <span className="rounded bg-indigo-100 px-2 py-0.5 text-[11px] font-bold text-indigo-800">
                    담당 AG 전용 처리
                  </span>
                  <h2 className="mt-1.5 text-base font-bold text-slate-900">
                    승인 검토 및 최종 결과 등록
                  </h2>
                </div>
                <ApprovalStatusBadge status={tx.status} />
              </div>

              {decisionError && (
                <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-medium text-rose-700">
                  {decisionError}
                </div>
              )}

              {tx.status === 'WAITING' && (
                <div className="mt-4 space-y-4">
                  <p className="text-xs leading-relaxed text-slate-600">
                    현재 <strong>[요청대기]</strong> 상태입니다. 아래 <strong>[검토 시작]</strong>{' '}
                    버튼을 누르면 거래가 <strong>[검토중]</strong> 상태로 전환되고 CM에게 검토 착수 사실이
                    실시간으로 공유됩니다.
                  </p>
                  {scheduledNextCond && (
                    <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50/80 p-3 text-xs text-amber-900">
                      <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                      <div>
                        <p className="font-bold">
                          차기 거래 조건 실행 예정 안내 ({scheduledNextCond.effectiveFrom} 실행)
                        </p>
                        <p className="mt-0.5 text-amber-800">
                          해당 조건군(<code>{scheduledNextCond.conditionGroupCode}</code>)에{' '}
                          <strong>{scheduledNextCond.effectiveFrom}</strong> 실행 예정인 새 조건(캐시백{' '}
                          {scheduledNextCond.customerCashbackRate}%)이 등록되어 있습니다. 새 실행일자 전
                          승인 시 현행 조건({tx.conditionSnapshot.customerCashbackRate}%)이 유지되며, 실행일
                          이후 승인 시 새 조건을 따릅니다.
                        </p>
                      </div>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={handleStartReview}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700"
                  >
                    <PlayCircle className="h-4 w-4" />
                    승인 요청 검토 시작 (요청대기 → 검토중)
                  </button>
                </div>
              )}

              {tx.status === 'REVIEWING' && (
                <form onSubmit={handleDecisionSubmit} className="mt-4 space-y-4">
                  <div className="grid grid-cols-2 gap-2.5">
                    <button
                      type="button"
                      onClick={() => {
                        setDecisionMode('APPROVE');
                        setDecisionError(null);
                      }}
                      className={`flex items-center justify-center gap-2 rounded-xl border py-3 text-xs font-bold transition-all ${
                        decisionMode === 'APPROVE'
                          ? 'border-emerald-600 bg-emerald-50 text-emerald-800 ring-1 ring-emerald-600'
                          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      승인 확정 등록
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDecisionMode('REJECT');
                        setDecisionError(null);
                      }}
                      className={`flex items-center justify-center gap-2 rounded-xl border py-3 text-xs font-bold transition-all ${
                        decisionMode === 'REJECT'
                          ? 'border-rose-600 bg-rose-50 text-rose-800 ring-1 ring-rose-600'
                          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      <XCircle className="h-4 w-4" />
                      반려 처리 (사유 필수)
                    </button>
                  </div>

                  {decisionMode === 'APPROVE' ? (
                    <div className="space-y-3.5">
                      {/* 거래승인일자 기준 실행 조건 자동 판별 박스 */}
                      <div className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-3.5 space-y-2.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <label className="flex items-center gap-1.5 text-xs font-bold text-indigo-950">
                            <CalendarClock className="h-4 w-4 text-indigo-600" />
                            거래승인 기준일자 (실행일자 기준 적용 조건 판별)
                          </label>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => setApprovalDateInput(systemReferenceDate)}
                              className={`rounded-lg px-2 py-1 text-[11px] font-semibold ${
                                approvalDateInput === systemReferenceDate
                                  ? 'bg-indigo-600 text-white'
                                  : 'border border-indigo-200 bg-white text-indigo-700 hover:bg-indigo-100'
                              }`}
                            >
                              현행 기준일 ({systemReferenceDate})
                            </button>
                            {scheduledNextCond && (
                              <button
                                type="button"
                                onClick={() => setApprovalDateInput(scheduledNextCond.effectiveFrom)}
                                className={`rounded-lg px-2 py-1 text-[11px] font-semibold ${
                                  approvalDateInput === scheduledNextCond.effectiveFrom
                                    ? 'bg-amber-600 text-white'
                                    : 'border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100'
                                }`}
                              >
                                차기 실행일 ({scheduledNextCond.effectiveFrom}) 시뮬레이션
                              </button>
                            )}
                          </div>
                        </div>

                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                          <input
                            type="date"
                            value={approvalDateInput}
                            onChange={(e) => setApprovalDateInput(e.target.value)}
                            className="rounded-xl border border-indigo-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-900 focus:border-indigo-500 focus:outline-none"
                          />
                          <span className="text-[11px] text-slate-600">
                            * 새 조건이 시트에 등록되어도 실행일자 전 승인 건은 이전 조건이 유지됩니다.
                          </span>
                        </div>

                        {willSwitchOnApproval && effectiveCondOnApprovalDate ? (
                          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950">
                            <p className="font-bold">
                              ⚡ 승인일({approvalDateInput})이 새 조건 실행일(
                              {effectiveCondOnApprovalDate.effectiveFrom}) 이후이므로 신규 조건이 적용됩니다
                            </p>
                            <p className="mt-1 text-[11px] text-amber-900">
                              요청 당시 v{tx.conditionSnapshot.versionNo ?? 1} (캐시백{' '}
                              {tx.conditionSnapshot.customerCashbackRate}% / CM{' '}
                              {tx.conditionSnapshot.cmCommissionRate ?? '-'}%) →{' '}
                              <strong>
                                승인 적용 v{effectiveCondOnApprovalDate.versionNo} (캐시백{' '}
                                {effectiveCondOnApprovalDate.customerCashbackRate}% / CM{' '}
                                {effectiveCondOnApprovalDate.cmCommissionRate ?? '-'}%)
                              </strong>
                            </p>
                          </div>
                        ) : (
                          <div className="rounded-lg border border-emerald-200 bg-emerald-50/80 p-2.5 text-xs text-emerald-900">
                            <strong>현행 조건 유지 적용:</strong> 승인일({approvalDateInput}) 기준{' '}
                            <strong>{tx.conditionSnapshot.title}</strong> (캐시백{' '}
                            {tx.conditionSnapshot.customerCashbackRate}% / CM{' '}
                            {tx.conditionSnapshot.cmCommissionRate ?? '-'}%) 조건이 그대로 유지 확정됩니다.
                          </div>
                        )}
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-slate-700">
                          승인 안내 메모 (선택 — CM 화면에 함께 표시됩니다)
                        </label>
                        <input
                          type="text"
                          value={approvalNote}
                          onChange={(e) => setApprovalNote(e.target.value)}
                          placeholder="예: 특별한도 승인 완료 (유효기한 7일). 고객 결제 후 매출전표 업로드 바랍니다."
                          className="mt-1.5 w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-xs focus:border-emerald-500 focus:outline-none"
                        />
                      </div>
                      <button
                        type="submit"
                        className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700"
                      >
                        <CheckCircle2 className="h-4 w-4" />
                        승인일({approvalDateInput}) 기준 최종 승인 확정 저장
                      </button>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-rose-200 bg-rose-50/40 p-4 space-y-3">
                      <div>
                        <label className="block text-xs font-bold text-rose-900">
                          반려 사유 입력 (필수) <span className="text-rose-600">*</span>
                        </label>
                        <p className="mt-0.5 text-[11px] text-rose-700">
                          자주 발생하는 반려 사유를 선택하거나 직접 상세 사유를 작성해 CM에게 전달합니다.
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {REJECTION_PRESETS.map((preset) => (
                          <button
                            key={preset}
                            type="button"
                            onClick={() => {
                              setRejectionReason(preset);
                              setDecisionError(null);
                            }}
                            className="rounded-lg border border-rose-200 bg-white px-2.5 py-1 text-left text-[11px] font-medium text-rose-800 hover:bg-rose-100"
                          >
                            + {preset.slice(0, 28)}...
                          </button>
                        ))}
                      </div>
                      <textarea
                        rows={3}
                        value={rejectionReason}
                        onChange={(e) => {
                          setRejectionReason(e.target.value);
                          setDecisionError(null);
                        }}
                        placeholder="반려 사유 및 보완 방법을 구체적으로 입력해 주세요."
                        className="w-full rounded-xl border border-rose-300 bg-white px-3.5 py-2.5 text-xs text-slate-900 focus:border-rose-500 focus:outline-none"
                      />
                      <button
                        type="submit"
                        className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-rose-600 px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-rose-700"
                      >
                        <XCircle className="h-4 w-4" />
                        반려 사유 저장 및 반려 확정
                      </button>
                    </div>
                  )}
                </form>
              )}

              {(tx.status === 'APPROVED' || tx.status === 'REJECTED') && (
                <div className="mt-4 flex items-center gap-2.5 rounded-xl bg-slate-50 p-3.5 text-xs text-slate-600">
                  <Lock className="h-4 w-4 shrink-0 text-slate-400" />
                  <span>
                    이미 <strong>[{APPROVAL_STATUS_META[tx.status].label}]</strong> 확정된 거래입니다.
                    정산 데이터 무결성을 위해 허용되지 않은 상태 역전(재변경)이 차단됩니다.
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Slip Submission & Google Sheets Auto-Entry Panel (Spec 5.1 & 5.2) */}
          {tx.status === 'APPROVED' && (
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                <div className="flex items-center gap-2">
                  <FileSpreadsheet className="h-5 w-5 text-teal-600" />
                  <div>
                    <h2 className="text-base font-bold text-slate-900">
                      거래 전표 제출 및 구글 시트 자동입력
                    </h2>
                    <p className="text-xs text-slate-500">
                      결제 완료 전표 제출 시 약속된 구글 시트 열 구조에 자동 입력되고 외부 행 ID를 추적합니다.
                    </p>
                  </div>
                </div>
                <SlipAndSheetBadge tx={tx} />
              </div>

              {/* Case A: Slip NOT YET submitted */}
              {!tx.slip ? (
                isOwningCm ? (
                  <form onSubmit={handleSubmitSlip} className="mt-5 space-y-4">
                    <div className="flex items-center justify-between rounded-xl bg-indigo-50/70 px-3.5 py-2.5 text-xs text-indigo-900">
                      <span>고객과 카드 결제를 완료하셨나요? 전표 정보를 제출해 거래를 완료하세요.</span>
                      <button
                        type="button"
                        onClick={handleFillSampleSlip}
                        className="shrink-0 font-bold text-indigo-700 underline hover:text-indigo-900"
                      >
                        샘플 전표값 자동채움
                      </button>
                    </div>

                    {slipError && (
                      <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-medium text-rose-700">
                        {slipError}
                      </div>
                    )}

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <label className="block text-xs font-semibold text-slate-700">
                          카드 승인번호 (6~8자리) <span className="text-rose-500">*</span>
                        </label>
                        <input
                          type="text"
                          value={approvalNumber}
                          onChange={(e) => setApprovalNumber(e.target.value)}
                          placeholder="예: 58392014"
                          className="mt-1 w-full rounded-xl border border-slate-300 px-3.5 py-2 font-mono text-sm focus:border-indigo-500 focus:outline-none"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-slate-700">
                          실제 승인·결제 일시 <span className="text-rose-500">*</span>
                        </label>
                        <input
                          type="text"
                          value={approvedDate}
                          onChange={(e) => setApprovedDate(e.target.value)}
                          placeholder="YYYY-MM-DD HH:mm"
                          className="mt-1 w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-slate-700">
                          전표 결제 금액 (원) <span className="text-rose-500">*</span>
                        </label>
                        <input
                          type="text"
                          value={
                            Number(approvedAmountStr.replace(/\D/g, '')) > 0
                              ? formatNumber(Number(approvedAmountStr.replace(/\D/g, '')))
                              : ''
                          }
                          onChange={(e) => setApprovedAmountStr(e.target.value.replace(/\D/g, ''))}
                          className="mt-1 w-full rounded-xl border border-slate-300 px-3.5 py-2 text-right font-bold tabular-nums text-sm focus:border-indigo-500 focus:outline-none"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-slate-700">
                          매출전표 가맹점명
                        </label>
                        <input
                          type="text"
                          value={merchantName}
                          onChange={(e) => setMerchantName(e.target.value)}
                          className="mt-1 w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                        />
                      </div>

                      <div className="sm:col-span-2">
                        <label className="block text-xs font-semibold text-slate-700">
                          매출전표 증빙 파일 첨부 (이미지 / PDF){' '}
                          <span className="text-rose-500">*</span>
                        </label>
                        <div className="mt-1.5 flex flex-col gap-2 sm:flex-row sm:items-center">
                          <label className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-2.5 text-xs font-semibold text-slate-700 hover:border-indigo-400 hover:bg-indigo-50/40">
                            <Upload className="h-4 w-4 text-indigo-600" />
                            파일 선택하기
                            <input
                              type="file"
                              accept="image/*,.pdf"
                              onChange={handleFileUploadChange}
                              className="hidden"
                            />
                          </label>
                          {fileName ? (
                            <div className="flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800">
                              <FileCheck2 className="h-4 w-4 text-emerald-600" />
                              <span>{fileName}</span>
                              <span className="text-emerald-600">({fileSizeLabel})</span>
                            </div>
                          ) : (
                            <span className="text-xs text-slate-400">
                              선택된 파일 없음 (우측 상단 &lsquo;샘플 전표값 자동채움&rsquo;으로도 첨부 가능)
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="sm:col-span-2">
                        <label className="block text-xs font-semibold text-slate-700">
                          전표 비고 메모 (선택)
                        </label>
                        <input
                          type="text"
                          value={slipMemo}
                          onChange={(e) => setSlipMemo(e.target.value)}
                          placeholder="예: 차량 잔금 일시불 결제 완료"
                          className="mt-1 w-full rounded-xl border border-slate-300 px-3.5 py-2 text-xs focus:border-indigo-500 focus:outline-none"
                        />
                      </div>

                      {/* Demo Google Sheets API Simulation Option */}
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 sm:col-span-2">
                        <label className="block text-[11px] font-bold text-slate-600">
                          [시연용 테스트 옵션] Google Sheets API 응답 시뮬레이션 선택
                        </label>
                        <select
                          value={simulateResult}
                          onChange={(e) =>
                            setSimulateResult(
                              e.target.value as 'SUCCESS' | 'AUTH_EXPIRED' | 'API_TIMEOUT'
                            )
                          }
                          className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800"
                        >
                          <option value="SUCCESS">
                            정상: 구글 시트 약속된 열 구조에 즉시 자동입력 성공 (기본)
                          </option>
                          <option value="AUTH_EXPIRED">
                            장애 시나리오 1: OAuth 토큰 만료(401) 실패 발생 → AG/관리자 재처리 테스트
                          </option>
                          <option value="API_TIMEOUT">
                            장애 시나리오 2: API 응답 타임아웃(503) 실패 발생 → AG/관리자 재처리 테스트
                          </option>
                        </select>
                      </div>
                    </div>

                    <button
                      type="submit"
                      className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-teal-600 px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-teal-700"
                    >
                      <FileSpreadsheet className="h-4 w-4" />
                      거래 전표 제출 및 구글 시트 자동입력 실행
                    </button>
                  </form>
                ) : (
                  <div className="mt-4 flex items-center gap-3 rounded-xl bg-amber-50/70 p-4 text-xs text-amber-900">
                    <Clock className="h-5 w-5 shrink-0 text-amber-600" />
                    <div>
                      <p className="font-bold">담당 CM({cmUser?.name})의 매출전표 제출 대기 중</p>
                      <p className="mt-0.5 text-amber-800">
                        승인이 확정되었으나 아직 전표가 제출되지 않았습니다. 전표 제출이 완료되어야 구글 시트
                        자동입력 및 월별 수수료 정산 집계 대상에 포함됩니다.
                      </p>
                    </div>
                  </div>
                )
              ) : (
                /* Case B: Slip ALREADY submitted */
                <div className="mt-5 space-y-4">
                  <div className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs sm:grid-cols-2">
                    <div>
                      <span className="text-slate-500">전표 ID / 카드 승인번호:</span>
                      <p className="mt-0.5 font-mono text-sm font-bold text-slate-900">
                        {tx.slip.id} · 승인 #{tx.slip.approvalNumber}
                      </p>
                    </div>
                    <div>
                      <span className="text-slate-500">결제 금액 / 결제 일시:</span>
                      <p className="mt-0.5 font-bold tabular-nums text-slate-900">
                        {formatKRW(tx.slip.approvedAmount)} ({tx.slip.approvedDate})
                      </p>
                    </div>
                    <div>
                      <span className="text-slate-500">가맹점명 / 제출자:</span>
                      <p className="mt-0.5 font-medium text-slate-800">
                        {tx.slip.merchantName} · {tx.slip.submittedByName} ({tx.slip.submittedAt})
                      </p>
                    </div>
                    <div>
                      <span className="text-slate-500">첨부 증빙 파일:</span>
                      <p className="mt-0.5 inline-flex items-center gap-1.5 font-semibold text-indigo-700">
                        <FileCheck2 className="h-3.5 w-3.5" />
                        {tx.slip.fileName} ({tx.slip.fileSizeLabel})
                      </p>
                    </div>
                  </div>

                  {/* Google Sheets Sync Status Detail */}
                  {tx.sheetSync.status === 'SYNCED' ? (
                    <div className="rounded-xl border border-teal-200 bg-teal-50/70 p-4 text-xs text-teal-900">
                      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                        <div className="flex items-start gap-2.5">
                          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-teal-600" />
                          <div>
                            <p className="font-bold">
                              구글 시트 자동입력 성공 · 외부 행 식별자:{' '}
                              <span className="font-mono text-teal-950">
                                {tx.sheetSync.externalRowId}
                              </span>
                            </p>
                            <p className="mt-0.5 text-teal-800">
                              대상 시트 탭: <strong>{tx.sheetSync.sheetTabName}</strong> · 중복 방지
                              멱등키: <code className="font-mono">{tx.sheetSync.idempotencyKey}</code>
                            </p>
                          </div>
                        </div>
                        {canRetrySheet && (
                          <Link
                            to="/sheets-sync"
                            className="shrink-0 rounded-lg border border-teal-300 bg-white px-3 py-1.5 text-xs font-semibold text-teal-800 hover:bg-teal-100"
                          >
                            시트 뷰어에서 확인 →
                          </Link>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-900 space-y-3">
                      <div className="flex items-start gap-2.5">
                        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" />
                        <div>
                          <p className="font-bold">
                            구글 시트 자동입력 실패 ({tx.sheetSync.errorCode})
                          </p>
                          <p className="mt-1 text-rose-800">{tx.sheetSync.errorReason}</p>
                          <p className="mt-1 text-[11px] text-rose-700">
                            중복 방지 멱등키:{' '}
                            <code className="font-mono">{tx.sheetSync.idempotencyKey}</code> · 재처리 시
                            기존 외부 행 대조 후 중복 행 생성 없이 단 1회만 기록합니다.
                          </p>
                        </div>
                      </div>

                      {canRetrySheet ? (
                        <div className="flex justify-end">
                          <button
                            type="button"
                            disabled={isRetrying}
                            onClick={handleRetrySheet}
                            className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-rose-700 disabled:opacity-60"
                          >
                            <RefreshCw
                              className={`h-3.5 w-3.5 ${isRetrying ? 'animate-spin' : ''}`}
                            />
                            {isRetrying
                              ? '기존 시트 행 중복 대조 및 재처리 중...'
                              : '중복 대조 후 구글 시트 입력 재처리 실행'}
                          </button>
                        </div>
                      ) : (
                        <p className="rounded-lg bg-white/70 px-3 py-2 text-[11px] font-medium text-rose-800">
                          * 전표 원본은 안전하게 제출 완료되었습니다. 담당 AG({agUser?.name}) 또는 운영
                          관리자가 구글 시트 재처리를 수행합니다.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right 5 Cols: Complete Status & Audit History Timeline */}
        <div className="space-y-6 lg:col-span-5">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div>
                <h2 className="text-base font-bold text-slate-900">승인 상태 및 변경 이력</h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  모든 상태 전이의 변경자·시각·이전/변경 상태와 사유가 감사 로그로 보존됩니다.
                </p>
              </div>
              <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-bold text-slate-700">
                {tx.history.length}건
              </span>
            </div>

            <ol className="relative mt-5 ml-3 border-l-2 border-slate-200 space-y-5">
              {[...tx.history].reverse().map((item, idx) => {
                const isLatest = idx === 0;
                return (
                  <li key={item.id} className="ml-5">
                    <span
                      className={`absolute -left-[9px] flex h-4 w-4 items-center justify-center rounded-full ring-4 ring-white ${
                        isLatest ? 'bg-indigo-600' : 'bg-slate-300'
                      }`}
                    />
                    <div
                      className={`rounded-xl border p-3.5 ${
                        isLatest
                          ? 'border-indigo-200 bg-indigo-50/40'
                          : 'border-slate-100 bg-slate-50/70'
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-1.5">
                        <span className="text-xs font-bold text-slate-900">{item.actionLabel}</span>
                        <span className="font-mono text-[11px] text-slate-500">
                          {item.changedAt}
                        </span>
                      </div>

                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                        <RoleBadge role={item.actorRole} short />
                        <span className="font-semibold text-slate-700">{item.actorName}</span>
                        <span className="text-slate-300">|</span>
                        {item.previousStatus ? (
                          <span className="text-slate-600">
                            {APPROVAL_STATUS_META[item.previousStatus].label} →{' '}
                            <strong className="text-slate-900">
                              {APPROVAL_STATUS_META[item.newStatus].label}
                            </strong>
                          </span>
                        ) : (
                          <span className="font-semibold text-amber-700">
                            초기 상태: {APPROVAL_STATUS_META[item.newStatus].label}
                          </span>
                        )}
                      </div>

                      {item.reasonOrNote && (
                        <p className="mt-2 rounded-lg bg-white px-2.5 py-2 text-xs leading-relaxed text-slate-700 ring-1 ring-slate-200/70">
                          {item.reasonOrNote}
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
};
