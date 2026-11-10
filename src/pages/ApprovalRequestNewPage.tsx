import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import {
  CARD_COMPANIES,
  CardCompany,
  IdentifierType,
  PAYMENT_METHODS,
  PaymentMethod,
} from '../types';
import {
  formatKRW,
  formatManwonRange,
  formatNumber,
  formatRawIdentifierInput,
  getConditionLifecycleStatus,
  validateAndMaskIdentifier,
} from '../utils/format';
import {
  ArrowLeft,
  ShieldCheck,
  AlertCircle,
  CheckCircle2,
  CreditCard,
  Send,
  Info,
  CalendarClock,
} from 'lucide-react';

interface PrefillState {
  prefill?: {
    customerName?: string;
    vehicleInfo?: string;
    cardCompany?: CardCompany;
    paymentMethod?: PaymentMethod;
    amount?: number;
    requestMemo?: string;
    fromRejectedId?: string;
  };
}

export const ApprovalRequestNewPage: React.FC = () => {
  const {
    currentUser,
    conditions,
    systemReferenceDate,
    getAssignedAgForCm,
    getScheduledNextConditionForGroup,
    registerTransaction,
  } = useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const prefill = (location.state as PrefillState | null)?.prefill;

  const [customerName, setCustomerName] = useState(prefill?.customerName ?? '');
  const [vehicleInfo, setVehicleInfo] = useState(prefill?.vehicleInfo ?? '');
  const [identifierType, setIdentifierType] = useState<IdentifierType>('CARD_NUMBER');
  const [rawIdentifier, setRawIdentifier] = useState('');
  const [cardCompany, setCardCompany] = useState<CardCompany>(prefill?.cardCompany ?? '삼성카드');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(
    prefill?.paymentMethod ?? '선입금(가상계좌) 캐시백'
  );
  const [conditionId, setConditionId] = useState<string>('');
  const [amountInput, setAmountInput] = useState<string>(
    prefill?.amount ? String(prefill.amount) : '35000000'
  );
  const [requestMemo, setRequestMemo] = useState(prefill?.requestMemo ?? '');

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  // 현재 기준일자(systemReferenceDate) 기준으로 ACTIVE_NOW 상태인 조건만 제공 (실행일자 전인 예정 조건은 미리 대체하지 않고 이전 조건을 유지!)
  const availableConditions = useMemo(() => {
    return conditions.filter(
      (c) =>
        c.cardCompany === cardCompany &&
        c.paymentMethod === paymentMethod &&
        getConditionLifecycleStatus(c, systemReferenceDate) === 'ACTIVE_NOW'
    );
  }, [conditions, cardCompany, paymentMethod, systemReferenceDate]);

  // 해당 조합에서 아직 실행일자가 도래하지 않은 SCHEDULED 조건이 있는지 안내용 조회
  const scheduledUpcomingConditions = useMemo(() => {
    return conditions.filter(
      (c) =>
        c.cardCompany === cardCompany &&
        c.paymentMethod === paymentMethod &&
        getConditionLifecycleStatus(c, systemReferenceDate) === 'SCHEDULED'
    );
  }, [conditions, cardCompany, paymentMethod, systemReferenceDate]);

  useEffect(() => {
    if (availableConditions.length > 0) {
      if (!availableConditions.some((c) => c.id === conditionId)) {
        setConditionId(availableConditions[0].id);
      }
    } else {
      setConditionId('');
    }
  }, [availableConditions, conditionId]);

  if (!currentUser) return null;

  if (currentUser.role !== 'CM') {
    return (
      <div className="mx-auto max-w-xl rounded-2xl border border-amber-200 bg-white p-8 text-center shadow-sm">
        <AlertCircle className="mx-auto h-10 w-10 text-amber-500" />
        <h2 className="mt-3 text-lg font-bold text-slate-900">CM(카마스터) 전용 화면입니다</h2>
        <p className="mt-1.5 text-sm text-slate-600">
          새 거래 승인 요청 등록은 담당 고객을 진행하는 CM 계정에서만 제출할 수 있습니다. 상단{' '}
          <strong>[시연용 빠른 계정 전환]</strong>에서 CM 계정(예: 김민준)을 선택해 테스트해 보세요.
        </p>
        <Link
          to="/transactions"
          className="mt-5 inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          거래 목록으로 돌아가기
        </Link>
      </div>
    );
  }

  const assignedAg = getAssignedAgForCm(currentUser.id);
  const selectedCondition = availableConditions.find((c) => c.id === conditionId);
  const numericAmount = Number(amountInput.replace(/\D/g, '')) || 0;
  const idPreview = rawIdentifier.trim()
    ? validateAndMaskIdentifier(identifierType, rawIdentifier)
    : null;

  const expectedCustomerCashback = selectedCondition
    ? Math.round((numericAmount * selectedCondition.customerCashbackRate) / 100)
    : 0;
  const expectedCmCommission =
    selectedCondition && selectedCondition.cmCommissionRate !== null
      ? Math.round((numericAmount * selectedCondition.cmCommissionRate) / 100)
      : null;

  const validateForm = (): boolean => {
    const nextErrors: Record<string, string> = {};

    if (!customerName.trim() || customerName.trim().length < 2) {
      nextErrors.customerName = '고객 성명을 2자 이상 정확히 입력해 주세요.';
    }

    const idCheck = validateAndMaskIdentifier(identifierType, rawIdentifier);
    if (!idCheck.valid) {
      nextErrors.rawIdentifier = idCheck.error ?? '고객 식별정보 형식이 올바르지 않습니다.';
    }

    if (!conditionId || !selectedCondition) {
      nextErrors.conditionId =
        '선택한 카드사·거래 방법 조합에서 현재 실행 중인 거래 조건을 선택해 주세요.';
    }

    if (numericAmount <= 0) {
      nextErrors.amount = '신청 금액을 원 단위로 입력해 주세요.';
    } else if (selectedCondition && numericAmount < selectedCondition.minAmount) {
      nextErrors.amount = `선택한 거래 조건의 최소 신청 금액은 ${formatKRW(
        selectedCondition.minAmount
      )}입니다.`;
    } else if (
      selectedCondition &&
      selectedCondition.maxAmount &&
      numericAmount > selectedCondition.maxAmount
    ) {
      nextErrors.amount = `선택한 거래 조건의 최대 신청 한도는 ${formatKRW(
        selectedCondition.maxAmount
      )}입니다.`;
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    if (!validateForm()) return;

    const res = registerTransaction({
      customerName,
      vehicleInfo,
      identifierType,
      rawIdentifier,
      cardCompany,
      paymentMethod,
      conditionId,
      amount: numericAmount,
      requestMemo: prefill?.fromRejectedId
        ? `[이전 반려건 ${prefill.fromRejectedId} 보완 재요청] ${requestMemo}`.trim()
        : requestMemo,
    });

    if (!res.ok) {
      setSubmitError(res.message);
      return;
    }

    if (res.transactionId) {
      navigate(`/transactions/${res.transactionId}`);
    } else {
      navigate('/transactions');
    }
  };

  const fillSampleIdentifier = () => {
    if (identifierType === 'CARD_NUMBER') {
      setRawIdentifier('9410-5821-3904-7721');
    } else {
      setRawIdentifier('880715-1048219');
    }
    setErrors((prev) => ({ ...prev, rawIdentifier: '' }));
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Link
          to="/transactions"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-900"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          내 거래 목록으로 돌아가기
        </Link>
        <div className="mt-2 flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              새 오토캐시백 거래 승인 요청 등록
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              기준일(<strong>{systemReferenceDate}</strong>) 현재 유효한 카드사별 실행 조건이 제공되며,
              담당 AG(<strong className="text-indigo-700">{assignedAg?.name ?? '미배정'}</strong>)에게
              실시간 전달됩니다.
            </p>
          </div>
        </div>
      </div>

      {prefill?.fromRejectedId && (
        <div className="flex items-start gap-3 rounded-xl border border-indigo-200 bg-indigo-50 p-4 text-xs text-indigo-900">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600" />
          <div>
            <p className="font-bold">
              반려된 거래({prefill.fromRejectedId})의 기본 정보를 불러왔습니다
            </p>
            <p className="mt-0.5">
              기존 반려 이력은 그대로 보존되며, 거래 방법·조건 또는 식별정보를 보완해 새로운 승인 요청으로
              제출합니다.
            </p>
          </div>
        </div>
      )}

      {submitError && (
        <div className="flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
          <div>
            <p className="font-bold">승인 요청 제출 불가</p>
            <p className="mt-0.5">{submitError}</p>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Section 1: Customer & Sensitive Identifier */}
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 pb-4">
            <div>
              <h2 className="text-base font-bold text-slate-900">1. 고객 기본 및 식별정보</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                입력한 카드번호 또는 주민등록번호는 권한 정책에 따라 즉시 마스킹되어 안전하게 보호됩니다.
              </p>
            </div>
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
              <ShieldCheck className="h-3.5 w-3.5" />
              민감정보 자동 마스킹
            </span>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold text-slate-700">
                고객 성명 <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                value={customerName}
                onChange={(e) => {
                  setCustomerName(e.target.value);
                  if (errors.customerName) setErrors({ ...errors, customerName: '' });
                }}
                placeholder="예: 박서준"
                className={`mt-1.5 w-full rounded-xl border px-3.5 py-2.5 text-sm focus:outline-none ${
                  errors.customerName
                    ? 'border-rose-400 bg-rose-50/40'
                    : 'border-slate-300 bg-white focus:border-indigo-500'
                }`}
              />
              {errors.customerName && (
                <p className="mt-1 text-xs font-medium text-rose-600">{errors.customerName}</p>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700">
                출고 차량 모델명 (보조 식별정보)
              </label>
              <input
                type="text"
                value={vehicleInfo}
                onChange={(e) => setVehicleInfo(e.target.value)}
                placeholder="예: 현대 디 올 뉴 싼타페 하이브리드"
                className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm focus:border-indigo-500 focus:outline-none"
              />
            </div>

            <div className="sm:col-span-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="block text-xs font-semibold text-slate-700">
                  고객 식별정보 유형 및 번호 <span className="text-rose-500">*</span>
                </label>
                <button
                  type="button"
                  onClick={fillSampleIdentifier}
                  className="text-xs font-semibold text-indigo-600 hover:text-indigo-800"
                >
                  시연용 유효 샘플 번호 자동입력
                </button>
              </div>

              <div className="mt-1.5 flex flex-col gap-3 sm:flex-row">
                <div className="flex rounded-xl border border-slate-300 bg-slate-50 p-1 sm:w-60 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setIdentifierType('CARD_NUMBER');
                      setRawIdentifier('');
                      setErrors((prev) => ({ ...prev, rawIdentifier: '' }));
                    }}
                    className={`flex-1 rounded-lg py-2 text-xs font-semibold transition-colors ${
                      identifierType === 'CARD_NUMBER'
                        ? 'bg-white text-indigo-700 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    카드번호
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIdentifierType('RRN');
                      setRawIdentifier('');
                      setErrors((prev) => ({ ...prev, rawIdentifier: '' }));
                    }}
                    className={`flex-1 rounded-lg py-2 text-xs font-semibold transition-colors ${
                      identifierType === 'RRN'
                        ? 'bg-white text-indigo-700 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    주민등록번호
                  </button>
                </div>

                <div className="flex-1">
                  <input
                    type="text"
                    value={rawIdentifier}
                    onChange={(e) => {
                      const formatted = formatRawIdentifierInput(identifierType, e.target.value);
                      setRawIdentifier(formatted);
                      if (errors.rawIdentifier) setErrors({ ...errors, rawIdentifier: '' });
                    }}
                    placeholder={
                      identifierType === 'CARD_NUMBER'
                        ? '숫자 15~16자리 입력 (예: 9410-1234-5678-3821)'
                        : '주민등록번호 13자리 입력 (예: 880715-1234567)'
                    }
                    className={`w-full rounded-xl border px-3.5 py-2.5 font-mono text-sm focus:outline-none ${
                      errors.rawIdentifier
                        ? 'border-rose-400 bg-rose-50/40'
                        : 'border-slate-300 bg-white focus:border-indigo-500'
                    }`}
                  />
                </div>
              </div>

              {errors.rawIdentifier && (
                <p className="mt-1.5 text-xs font-medium text-rose-600">{errors.rawIdentifier}</p>
              )}

              {idPreview?.valid && (
                <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                  <span>
                    형식 검증 완료 · 목록 및 상세 마스킹 표시값:{' '}
                    <strong className="font-mono text-slate-900">
                      {idPreview.maskedIdentifier}
                    </strong>
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Section 2: Card Company, Payment Method, Dynamic Effective-Date Conditions */}
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="border-b border-slate-100 pb-4">
            <h2 className="text-base font-bold text-slate-900">
              2. 카드사 · 거래 방법 및 실행일자 유효 조건 선택
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              기준일({systemReferenceDate}) 현재 실행 중인 조건만 선택지로 제공되며, 새 조건 실행일자
              도래 전까지는 이전 조건이 유지됩니다.
            </p>
          </div>

          <div className="mt-5 space-y-5">
            {/* Card Company Pills */}
            <div>
              <label className="block text-xs font-semibold text-slate-700">
                카드사 선택 <span className="text-rose-500">*</span>
              </label>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
                {CARD_COMPANIES.map((card) => {
                  const activeCount = conditions.filter(
                    (c) =>
                      c.cardCompany === card &&
                      getConditionLifecycleStatus(c, systemReferenceDate) === 'ACTIVE_NOW'
                  ).length;
                  return (
                    <button
                      key={card}
                      type="button"
                      onClick={() => setCardCompany(card)}
                      className={`flex flex-col items-center justify-center rounded-xl border px-3 py-2.5 text-xs font-semibold transition-all ${
                        cardCompany === card
                          ? 'border-indigo-600 bg-indigo-600 text-white shadow-sm'
                          : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      <span>{card}</span>
                      <span
                        className={`mt-0.5 text-[10px] ${
                          cardCompany === card ? 'text-indigo-200' : 'text-slate-400'
                        }`}
                      >
                        유효 {activeCount}개
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Payment Method Pills */}
            <div>
              <label className="block text-xs font-semibold text-slate-700">
                거래 방법 선택 <span className="text-rose-500">*</span>
              </label>
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {PAYMENT_METHODS.map((method) => {
                  const matchCount = conditions.filter(
                    (c) =>
                      c.cardCompany === cardCompany &&
                      c.paymentMethod === method &&
                      getConditionLifecycleStatus(c, systemReferenceDate) === 'ACTIVE_NOW'
                  ).length;
                  return (
                    <button
                      key={method}
                      type="button"
                      onClick={() => setPaymentMethod(method)}
                      className={`flex items-center justify-between rounded-xl border px-3.5 py-2.5 text-left text-xs font-semibold transition-all ${
                        paymentMethod === method
                          ? 'border-indigo-600 bg-indigo-50 text-indigo-800 ring-1 ring-indigo-600'
                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <span>{method}</span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                          matchCount > 0
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-slate-100 text-slate-400'
                        }`}
                      >
                        {matchCount}건
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Dynamic Filtered Deal Conditions */}
            <div>
              <label className="block text-xs font-semibold text-slate-700">
                현재 적용 중인 표준 거래 조건 ({cardCompany} × {paymentMethod}){' '}
                <span className="text-rose-500">*</span>
              </label>

              {availableConditions.length === 0 ? (
                <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">
                  <p className="font-bold">
                    기준일({systemReferenceDate}) 현재 선택한 조합({cardCompany} · {paymentMethod})에
                    적용 중인 거래 조건이 없습니다.
                  </p>
                  {scheduledUpcomingConditions.length > 0 && (
                    <p className="mt-1 font-medium text-indigo-800">
                      * 실행 예정 조건 안내: {scheduledUpcomingConditions[0].title} (실행일:{' '}
                      {scheduledUpcomingConditions[0].effectiveFrom}부터 선택 가능)
                    </p>
                  )}
                </div>
              ) : (
                <div className="mt-2 grid grid-cols-1 gap-3">
                  {availableConditions.map((cond) => {
                    const selected = cond.id === conditionId;
                    const nextScheduled = getScheduledNextConditionForGroup(
                      cond.conditionGroupCode,
                      systemReferenceDate
                    );
                    return (
                      <label
                        key={cond.id}
                        onClick={() => {
                          setConditionId(cond.id);
                          if (errors.conditionId) setErrors({ ...errors, conditionId: '' });
                        }}
                        className={`flex cursor-pointer items-start justify-between gap-4 rounded-xl border p-4 transition-all ${
                          selected
                            ? 'border-indigo-600 bg-indigo-50/50 ring-1 ring-indigo-600'
                            : 'border-slate-200 bg-white hover:border-slate-300'
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <input
                            type="radio"
                            name="dealCondition"
                            checked={selected}
                            onChange={() => setConditionId(cond.id)}
                            className="mt-1 h-4 w-4 text-indigo-600 focus:ring-indigo-500"
                          />
                          <div>
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="rounded bg-indigo-600 px-2 py-0.5 text-[11px] font-bold text-white">
                                {cond.channelType}
                              </span>
                              <span className="text-sm font-bold text-slate-900">{cond.title}</span>
                              <span className="rounded bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-800">
                                고객 캐시백 {cond.customerCashbackRate}%
                              </span>
                              <span className="rounded bg-indigo-100 px-2 py-0.5 text-[11px] font-bold text-indigo-800">
                                CM 수수료{' '}
                                {cond.cmCommissionRate !== null
                                  ? `${cond.cmCommissionRate}%`
                                  : '건별 운영확정'}
                              </span>
                            </div>

                            {/* Rich Sub-Criteria Pills */}
                            <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                              <span className="rounded-md bg-slate-100 px-2 py-0.5 font-medium text-slate-700">
                                카드종류: {cond.cardKind}
                              </span>
                              <span className="rounded-md bg-slate-100 px-2 py-0.5 font-medium text-slate-700">
                                금액기준: {formatManwonRange(cond.minAmount, cond.maxAmount)}
                              </span>
                              <span className="rounded-md bg-slate-100 px-2 py-0.5 font-medium text-slate-700">
                                선수금: {cond.downPaymentRule}
                              </span>
                              <span className="rounded-md bg-slate-100 px-2 py-0.5 font-medium text-slate-700">
                                할부/결제: {cond.installmentTerms}
                              </span>
                              <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-slate-500">
                                유효기간: {cond.effectiveFrom} ~ {cond.effectiveTo ?? '상시'}
                              </span>
                            </div>

                            <p className="mt-1.5 text-xs text-slate-600">{cond.description}</p>

                            {nextScheduled && (
                              <div className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-800 ring-1 ring-amber-200">
                                <CalendarClock className="h-3.5 w-3.5 shrink-0 text-amber-600" />
                                <span>
                                  예정 공지: <strong>{nextScheduled.effectiveFrom}</strong> 거래승인
                                  건부터 차기 조건(캐시백 {nextScheduled.customerCashbackRate}% / CM{' '}
                                  {nextScheduled.cmCommissionRate}%) 적용 예정 (실행일 전 승인 건은 현재
                                  조건 유지)
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                        <CreditCard
                          className={`h-5 w-5 shrink-0 ${
                            selected ? 'text-indigo-600' : 'text-slate-300'
                          }`}
                        />
                      </label>
                    );
                  })}
                </div>
              )}

              {errors.conditionId && (
                <p className="mt-1.5 text-xs font-medium text-rose-600">{errors.conditionId}</p>
              )}
            </div>
          </div>
        </div>

        {/* Section 3: Request Amount & Memo */}
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="border-b border-slate-100 pb-4">
            <h2 className="text-base font-bold text-slate-900">3. 신청 금액 및 요청 전달사항</h2>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold text-slate-700">
                승인 신청 금액 (원) <span className="text-rose-500">*</span>
              </label>
              <div className="relative mt-1.5">
                <input
                  type="text"
                  value={numericAmount > 0 ? formatNumber(numericAmount) : ''}
                  onChange={(e) => {
                    const digits = e.target.value.replace(/\D/g, '');
                    setAmountInput(digits);
                    if (errors.amount) setErrors({ ...errors, amount: '' });
                  }}
                  placeholder="예: 35,000,000"
                  className={`w-full rounded-xl border py-2.5 pl-3.5 pr-10 text-right font-bold tabular-nums text-sm focus:outline-none ${
                    errors.amount
                      ? 'border-rose-400 bg-rose-50/40'
                      : 'border-slate-300 bg-white focus:border-indigo-500'
                  }`}
                />
                <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-500">
                  원
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {[20000000, 30000000, 40000000, 50000000].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => {
                      setAmountInput(String(preset));
                      setErrors((prev) => ({ ...prev, amount: '' }));
                    }}
                    className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                  >
                    {(preset / 10000).toLocaleString()}만원
                  </button>
                ))}
              </div>
              {errors.amount && (
                <p className="mt-1.5 text-xs font-medium text-rose-600">{errors.amount}</p>
              )}
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-semibold text-slate-600">
                선택 조건 기준 예상 혜택 · 수수료 미리보기
              </p>
              <div className="mt-3 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">신청 원금</span>
                  <span className="font-bold tabular-nums text-slate-900">
                    {formatKRW(numericAmount)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">
                    예상 고객 캐시백 ({selectedCondition?.customerCashbackRate ?? 0}%)
                  </span>
                  <span className="font-bold tabular-nums text-emerald-700">
                    {formatKRW(expectedCustomerCashback)}
                  </span>
                </div>
                <div className="flex items-center justify-between border-t border-slate-200 pt-2">
                  <span className="text-slate-600 font-medium">
                    예상 CM 수수료 (
                    {selectedCondition?.cmCommissionRate !== null &&
                    selectedCondition?.cmCommissionRate !== undefined
                      ? `${selectedCondition.cmCommissionRate}%`
                      : '운영팀 확정'}
                    )
                  </span>
                  <span className="font-bold tabular-nums text-indigo-700">
                    {expectedCmCommission !== null
                      ? formatKRW(expectedCmCommission)
                      : '전표 확정 시 산정'}
                  </span>
                </div>
                <p className="pt-1 text-[11px] text-slate-500">
                  * 예상 수수료이며 최종 거래승인일자 및 진행 결과에 따라 변동될 수 있습니다.
                </p>
              </div>
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-700">
                AG 전달 메모 (출고 예정일 / 특이사항)
              </label>
              <textarea
                rows={2}
                value={requestMemo}
                onChange={(e) => setRequestMemo(e.target.value)}
                placeholder="예: 내일 오전 11시 차량 인도 예정입니다. 가상계좌 입금 안내 문자 발송 부탁드립니다."
                className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm focus:border-indigo-500 focus:outline-none"
              />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3">
          <Link
            to="/transactions"
            className="rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            취소
          </Link>
          <button
            type="submit"
            disabled={availableConditions.length === 0}
            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Send className="h-4 w-4" />
            담당 AG에게 승인 요청 제출
          </button>
        </div>
      </form>
    </div>
  );
};
