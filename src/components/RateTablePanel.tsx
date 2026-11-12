import React, { useEffect, useMemo, useState } from 'react';
import { fixDecimal } from './DecimalInput';
import {
  Check,
  Copy,
  Edit3,
  ExternalLink,
  FileSpreadsheet,
  Gift,
  Image as ImageIcon,
  Lock,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  X,
  ZoomIn,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import {
  GOOGLE_MASTER_SPREADSHEET_TITLE,
  GOOGLE_SHEET_TABS,
  serializePromotionsToTsv,
  serializeRateTableToTsv,
} from '../constants/googleSheetConfig';
import {
  CARD_COMPANY_COLORS,
  CardPromotionItem,
  PROMOTION_PAYMENT_METHODS,
  PromotionPaymentMethod,
  RateTableRowItem,
  SPLIT_CARD_COMPANIES,
  SPLIT_PAYMENT_METHODS,
  SplitCardCompany,
  SplitPaymentMethod,
} from '../types';
import { formatSignedKRW, formatSignedRate } from '../utils/format';

// 오늘 날짜 (YYYY-MM-DD, 브라우저 시간 기준)
const todayStr = () => new Date().toLocaleDateString('sv-SE');

export const RateTablePanel: React.FC<{ onCloseSplit?: () => void }> = ({ onCloseSplit }) => {
  const {
    currentUser,
    rateTableImages,
    rateTableRows,
    cardPromotions,
    addRateTableImage,
    deleteRateTableImage,
    saveRateTableRow,
    deleteRateTableRow,
    saveCardPromotion,
    deleteCardPromotion,
    lastMasterSheetSyncedAt,
    isSyncingMasterSheet,
    pushAllMasterTabsToGoogleSheet,
    pullRateAndPromotionsFromGoogleSheet,
    importRateTableRowsFromSheetTsv,
    importPromotionsFromSheetTsv,
    pushToast,
  } = useApp();

  const [activeTab, setActiveTab] = useState<'DATA' | 'PROMO' | 'IMAGE'>('DATA');
  const [showSheetSyncPanel, setShowSheetSyncPanel] = useState(false);
  const [sheetImportTarget, setSheetImportTarget] = useState<'RATE' | 'PROMO'>('RATE');
  const [sheetImportMode, setSheetImportMode] = useState<'MERGE' | 'REPLACE'>('MERGE');
  const [sheetTsvInput, setSheetTsvInput] = useState('');
  const [cardFilter, setCardFilter] = useState<'ALL' | SplitCardCompany>('ALL');
  const [methodFilter, setMethodFilter] = useState<'ALL' | SplitPaymentMethod>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  // Admin Image Upload Modal/Form state
  const [showImageForm, setShowImageForm] = useState(false);
  const [imgTitle, setImgTitle] = useState('');
  const [imgCardTag, setImgCardTag] = useState('전 카드사 통합');
  const [imgEffectiveDate, setImgEffectiveDate] = useState(todayStr);
  const [imgUrl, setImgUrl] = useState('');
  const [imgFile, setImgFile] = useState<File | null>(null);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [imgNote, setImgNote] = useState('');
  const [zoomedImageUrl, setZoomedImageUrl] = useState<string | null>(null);
  const [confirmDeleteRowId, setConfirmDeleteRowId] = useState<string | null>(null);
  const [confirmDeletePromoId, setConfirmDeletePromoId] = useState<string | null>(null);
  const [confirmDeleteImageId, setConfirmDeleteImageId] = useState<string | null>(null);

  useEffect(() => {
    if (!zoomedImageUrl) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setZoomedImageUrl(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [zoomedImageUrl]);

  // Admin Data Row Modal/Form state (supports Create, Edit, and Copy-to-Modify)
  const [showRowForm, setShowRowForm] = useState(false);
  const [editingRowId, setEditingRowId] = useState<string | undefined>(undefined);
  const [copiedFromRowLabel, setCopiedFromRowLabel] = useState<string | null>(null);
  const [rowCard, setRowCard] = useState<SplitCardCompany>('제휴카드사(삼성)');
  const [rowMethod, setRowMethod] = useState<SplitPaymentMethod>('일시불');
  const [rowCategory, setRowCategory] = useState('일반');
  const [rowTier, setRowTier] = useState('2,000만원 이상');
  const [rowMonths, setRowMonths] = useState('1달');
  const [rowCashback, setRowCashback] = useState('1.9');
  const [rowInterest, setRowInterest] = useState('0');
  const [rowAgRate, setRowAgRate] = useState('0.85');
  const [rowCmRate, setRowCmRate] = useState('0.50');
  const [rowEffectiveDate, setRowEffectiveDate] = useState(todayStr);
  const [rowRemark, setRowRemark] = useState('');

  // Admin Card Promotion Form state (supports Create, Edit, Copy-to-Modify, and -% negative adjustments)
  const [showPromoForm, setShowPromoForm] = useState(false);
  const [editingPromoId, setEditingPromoId] = useState<string | undefined>(undefined);
  const [copiedFromPromoLabel, setCopiedFromPromoLabel] = useState<string | null>(null);
  const [promoCard, setPromoCard] = useState<SplitCardCompany>('제휴카드사(삼성)');
  const [promoTitle, setPromoTitle] = useState('');
  const [promoStartDate, setPromoStartDate] = useState(todayStr);
  const [promoHasEndDate, setPromoHasEndDate] = useState(false);
  const [promoEndDate, setPromoEndDate] = useState('2026-11-30');
  const [promoMethod, setPromoMethod] = useState<PromotionPaymentMethod>('통합');
  const [promoMinAmount, setPromoMinAmount] = useState('30000000');
  const [promoMaxAmount, setPromoMaxAmount] = useState('');
  const [promoAmountLabel, setPromoAmountLabel] = useState('3,000만원 이상');
  const [promoCashbackDelta, setPromoCashbackDelta] = useState('0');
  const [promoInterestDelta, setPromoInterestDelta] = useState('0');
  const [promoAgRate, setPromoAgRate] = useState('0.15');
  const [promoCmRate, setPromoCmRate] = useState('0.10');
  const [promoAgAmount, setPromoAgAmount] = useState('100000');
  const [promoCmAmount, setPromoCmAmount] = useState('50000');
  const [promoBullets, setPromoBullets] = useState(
    '• 프로모션 적용 대상:\n• 인센티브/요율 가감(±%) 기준:\n• 유의사항:'
  );

  // [요구사항 1] 요율표 수정 기능은 오직 ADMIN에게만 부여
  const canEdit = currentUser?.role === 'ADMIN';

  // 요율표 데이터 행 필터링
  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return rateTableRows.filter((r) => {
      if (cardFilter !== 'ALL' && r.cardCompany !== cardFilter) return false;
      if (methodFilter !== 'ALL' && r.paymentMethod !== methodFilter) return false;
      if (q) {
        const hay =
          `${r.cardCompany} ${r.paymentMethod} ${r.category || '일반'} ${r.amountTier} ${r.installmentMonths} ${r.remark}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rateTableRows, cardFilter, methodFilter, searchQuery]);

  // 카드사 프로모션 필터링
  const filteredPromotions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return cardPromotions.filter((p) => {
      if (cardFilter !== 'ALL' && p.cardCompany !== cardFilter) return false;
      if (methodFilter !== 'ALL' && p.paymentMethod !== '통합' && p.paymentMethod !== methodFilter) {
        return false;
      }
      if (q) {
        const hay =
          `${p.cardCompany} ${p.title} ${p.paymentMethod} ${p.amountConditionLabel} ${p.promotionConditionText}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [cardPromotions, cardFilter, methodFilter, searchQuery]);

  if (!currentUser) return null;

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImgFile(file);
    setImgUrl('');
    if (!imgTitle) setImgTitle(file.name.replace(/\.[^/.]+$/, ''));
  };

  const handleAddImage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isUploadingImage) return;
    setIsUploadingImage(true);
    const res = await addRateTableImage({
      title: imgTitle,
      cardCompanyTag: imgCardTag,
      effectiveDate: imgEffectiveDate,
      note: imgNote,
      file: imgFile,
      externalUrl: imgUrl,
    });
    setIsUploadingImage(false);
    if (res.ok) {
      setShowImageForm(false);
      setImgTitle('');
      setImgUrl('');
      setImgFile(null);
      setImgNote('');
    }
  };

  const openNewRowForm = () => {
    setEditingRowId(undefined);
    setCopiedFromRowLabel(null);
    setRowCard('제휴카드사(삼성)');
    setRowMethod('일시불');
    setRowCategory('일반');
    setRowTier('2,000만원 이상');
    setRowMonths('1달');
    setRowCashback('1.90');
    setRowInterest('0');
    setRowAgRate('0.85');
    setRowCmRate('0.50');
    setRowEffectiveDate(todayStr());
    setRowRemark('');
    setShowRowForm(true);
  };

  const openEditRowForm = (row: RateTableRowItem) => {
    setEditingRowId(row.id);
    setCopiedFromRowLabel(null);
    setRowCard(row.cardCompany);
    setRowMethod(row.paymentMethod);
    setRowCategory(row.category || '일반');
    setRowTier(row.amountTier);
    setRowMonths(row.installmentMonths);
    setRowCashback(String(row.cashbackRate));
    setRowInterest(String(row.interestRate));
    setRowAgRate(String(row.agCommissionRate));
    setRowCmRate(String(row.cmCommissionRate));
    setRowEffectiveDate(row.effectiveDate);
    setRowRemark(row.remark);
    setShowRowForm(true);
  };

  // 요율 데이터 복사해서 필요한 부분만 빠르게 수정하여 신규 등록하는 기능 (ADMIN 전용)
  const openCopyRowForm = (row: RateTableRowItem) => {
    setEditingRowId(undefined);
    setCopiedFromRowLabel(`${row.cardCompany} · ${row.paymentMethod} [${row.category || '일반'}] (${row.amountTier})`);
    setRowCard(row.cardCompany);
    setRowMethod(row.paymentMethod);
    setRowCategory(row.category || '일반');
    setRowTier(row.amountTier);
    setRowMonths(row.installmentMonths);
    setRowCashback(String(row.cashbackRate));
    setRowInterest(String(row.interestRate));
    setRowAgRate(String(row.agCommissionRate));
    setRowCmRate(String(row.cmCommissionRate));
    setRowEffectiveDate(row.effectiveDate);
    setRowRemark(row.remark);
    setShowRowForm(true);
  };

  const handleSaveRow = (e: React.FormEvent) => {
    e.preventDefault();
    const res = saveRateTableRow({
      id: editingRowId,
      cardCompany: rowCard,
      paymentMethod: rowMethod,
      category: rowCategory.trim() || '일반',
      amountTier: rowTier,
      installmentMonths: rowMethod === '일시불' ? '1달' : rowMonths,
      cashbackRate: rowMethod === '일시불' ? parseFloat(rowCashback) || 0 : 0,
      interestRate: rowMethod === '일시불' ? 0 : parseFloat(rowInterest) || 0,
      agCommissionRate: parseFloat(rowAgRate) || 0,
      cmCommissionRate: parseFloat(rowCmRate) || 0,
      effectiveDate: rowEffectiveDate,
      remark: rowRemark,
    });
    if (res.ok) {
      setShowRowForm(false);
      setCopiedFromRowLabel(null);
    }
  };

  // 프로모션 폼 열기 (신규 / 수정 / 복사 후 수정)
  const openNewPromoForm = () => {
    setEditingPromoId(undefined);
    setCopiedFromPromoLabel(null);
    setPromoCard('제휴카드사(삼성)');
    setPromoTitle('');
    setPromoStartDate(todayStr());
    setPromoHasEndDate(false);
    setPromoEndDate('2026-11-30');
    setPromoMethod('통합');
    setPromoMinAmount('30000000');
    setPromoMaxAmount('');
    setPromoAmountLabel('3,000만원 이상');
    setPromoCashbackDelta('0');
    setPromoInterestDelta('0');
    setPromoAgRate('0.15');
    setPromoCmRate('0.10');
    setPromoAgAmount('100000');
    setPromoCmAmount('50000');
    setPromoBullets(
      '• 프로모션 적용 대상:\n• 인센티브/요율 가감(±%) 기준:\n• 유의사항:'
    );
    setShowPromoForm(true);
  };

  const openEditPromoForm = (p: CardPromotionItem) => {
    setEditingPromoId(p.id);
    setCopiedFromPromoLabel(null);
    setPromoCard(p.cardCompany);
    setPromoTitle(p.title);
    setPromoStartDate(p.startDate);
    setPromoHasEndDate(Boolean(p.endDate));
    setPromoEndDate(p.endDate || '2026-11-30');
    setPromoMethod(p.paymentMethod);
    setPromoMinAmount(String(p.minAmount));
    setPromoMaxAmount(p.maxAmount ? String(p.maxAmount) : '');
    setPromoAmountLabel(p.amountConditionLabel);
    setPromoCashbackDelta(String(p.cashbackRateDelta ?? 0));
    setPromoInterestDelta(String(p.interestRateDelta ?? 0));
    setPromoAgRate(String(p.agIncentiveRate));
    setPromoCmRate(String(p.cmIncentiveRate));
    setPromoAgAmount(String(p.agIncentiveAmount));
    setPromoCmAmount(String(p.cmIncentiveAmount));
    setPromoBullets(p.promotionConditionText);
    setShowPromoForm(true);
  };

  const openCopyPromoForm = (p: CardPromotionItem) => {
    setEditingPromoId(undefined);
    setCopiedFromPromoLabel(`[${p.cardCompany}] ${p.title}`);
    setPromoCard(p.cardCompany);
    setPromoTitle(`${p.title} (복사본)`);
    setPromoStartDate(p.startDate);
    setPromoHasEndDate(Boolean(p.endDate));
    setPromoEndDate(p.endDate || '2026-11-30');
    setPromoMethod(p.paymentMethod);
    setPromoMinAmount(String(p.minAmount));
    setPromoMaxAmount(p.maxAmount ? String(p.maxAmount) : '');
    setPromoAmountLabel(p.amountConditionLabel);
    setPromoCashbackDelta(String(p.cashbackRateDelta ?? 0));
    setPromoInterestDelta(String(p.interestRateDelta ?? 0));
    setPromoAgRate(String(p.agIncentiveRate));
    setPromoCmRate(String(p.cmIncentiveRate));
    setPromoAgAmount(String(p.agIncentiveAmount));
    setPromoCmAmount(String(p.cmIncentiveAmount));
    setPromoBullets(p.promotionConditionText);
    setShowPromoForm(true);
  };

  const handleSavePromo = (e: React.FormEvent) => {
    e.preventDefault();
    const minAmt = parseInt(promoMinAmount, 10) || 0;
    const maxAmt = promoMaxAmount.trim() ? parseInt(promoMaxAmount, 10) || null : null;
    const res = saveCardPromotion({
      id: editingPromoId,
      cardCompany: promoCard,
      title: promoTitle,
      startDate: promoStartDate,
      endDate: promoHasEndDate ? promoEndDate : null,
      paymentMethod: promoMethod,
      minAmount: minAmt,
      maxAmount: maxAmt,
      amountConditionLabel:
        promoAmountLabel.trim() ||
        `${(minAmt / 10000).toLocaleString()}만원 이상${
          maxAmt ? ` ~ ${(maxAmt / 10000).toLocaleString()}만원 미만` : ''
        }`,
      cashbackRateDelta: parseFloat(promoCashbackDelta) || 0,
      interestRateDelta: parseFloat(promoInterestDelta) || 0,
      agIncentiveRate: parseFloat(promoAgRate) || 0,
      cmIncentiveRate: parseFloat(promoCmRate) || 0,
      agIncentiveAmount: parseInt(promoAgAmount, 10) || 0,
      cmIncentiveAmount: parseInt(promoCmAmount, 10) || 0,
      promotionConditionText: promoBullets,
      isActive: true,
    });
    if (res.ok) {
      setShowPromoForm(false);
      setCopiedFromPromoLabel(null);
    }
  };


  const tabs = [
    { key: 'DATA' as const, label: '요율표', icon: FileSpreadsheet, count: rateTableRows.length },
    { key: 'PROMO' as const, label: '프로모션', icon: Gift, count: cardPromotions.length },
    { key: 'IMAGE' as const, label: '이미지', icon: ImageIcon, count: rateTableImages.length },
  ];
  const chipClass = (selected: boolean) =>
    `inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-xs font-bold transition-colors ${
      selected
        ? 'border-slate-900 bg-slate-900 text-white'
        : 'border-slate-200 bg-white text-slate-600 hover:border-slate-400 hover:text-slate-900'
    }`;
  const sheetLinkClass =
    'inline-flex items-center gap-1 whitespace-nowrap text-xs font-semibold text-slate-500 hover:text-slate-900';

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
      {/* 헤더: 제목 · 동기화 시각 · 닫기 */}
      <div className="border-b border-slate-200 px-5 pt-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-white">
              <FileSpreadsheet className="h-4 w-4" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-extrabold tracking-tight text-slate-900">요율표 · 프로모션</h3>
                <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] font-bold text-slate-600">
                  {canEdit ? <ShieldCheck className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
                  {canEdit ? '편집 가능' : '조회 전용'}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-slate-500">
                {GOOGLE_MASTER_SPREADSHEET_TITLE} · 최근 동기화 {lastMasterSheetSyncedAt}
              </p>
            </div>
          </div>
          {onCloseSplit && (
            <button
              type="button"
              onClick={onCloseSplit}
              aria-label="요율표 닫기"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-900"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        {/* 탭 + 시트 바로가기 */}
        <div className="mt-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
          <div role="tablist" aria-label="요율표 보기 방식" className="-mb-px flex gap-1">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setActiveTab(tab.key)}
                  className={`inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 pb-2.5 pt-1 text-sm font-bold transition-colors ${
                    isActive
                      ? 'border-slate-900 text-slate-900'
                      : 'border-transparent text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {tab.label}
                  <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-slate-600">
                    {tab.count}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-3 pb-2.5">
            <a href={GOOGLE_SHEET_TABS.RATE_TABLE_MASTER.url} target="_blank" rel="noreferrer" className={sheetLinkClass}>
              요율표 시트 <ExternalLink className="h-3 w-3" />
            </a>
            <a href={GOOGLE_SHEET_TABS.PROMOTION_MASTER.url} target="_blank" rel="noreferrer" className={sheetLinkClass}>
              프로모션 시트 <ExternalLink className="h-3 w-3" />
            </a>
            <a href={GOOGLE_SHEET_TABS.REGISTRATION_CONSOLE.url} target="_blank" rel="noreferrer" className={sheetLinkClass}>
              등록 시트 <ExternalLink className="h-3 w-3" />
            </a>
            {canEdit && (
              <button
                type="button"
                onClick={() => setShowSheetSyncPanel((prev) => !prev)}
                aria-expanded={showSheetSyncPanel}
                className={`inline-flex items-center gap-1 whitespace-nowrap rounded-lg border px-2.5 py-1 text-xs font-bold transition-colors ${
                  showSheetSyncPanel
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                <RefreshCw className={`h-3 w-3 ${isSyncingMasterSheet ? 'animate-spin' : ''}`} />
                시트 동기화
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ADMIN 전용: 05_요율표 · 06_프로모션 시트와 주고받기 (Pull / Push / TSV 붙여넣기) */}
      {canEdit && showSheetSyncPanel && (
        <div className="space-y-3 border-b border-slate-200 bg-slate-50 px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h4 className="text-sm font-extrabold text-slate-900">구글 시트 동기화</h4>
              <p className="mt-0.5 text-xs text-slate-500">
                05_요율표 · 06_프로모션 시트와 웹앱 데이터를 주고받습니다.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                disabled={isSyncingMasterSheet}
                onClick={() => pullRateAndPromotionsFromGoogleSheet()}
                className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-800 disabled:opacity-50"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isSyncingMasterSheet ? 'animate-spin' : ''}`} />
                시트에서 불러오기
              </button>
              <button
                type="button"
                disabled={isSyncingMasterSheet}
                onClick={() => pushAllMasterTabsToGoogleSheet('05_요율표 & 06_프로모션 마스터')}
                className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-800 hover:bg-slate-100 disabled:opacity-50"
              >
                <Upload className="h-3.5 w-3.5" />
                시트에 저장
              </button>
              <button
                type="button"
                onClick={() => {
                  const tsv =
                    sheetImportTarget === 'RATE'
                      ? serializeRateTableToTsv(rateTableRows, true)
                      : serializePromotionsToTsv(cardPromotions, true);
                  navigator.clipboard.writeText(tsv);
                  pushToast({
                    type: 'success',
                    title: `${sheetImportTarget === 'RATE' ? '05_요율표_마스터' : '06_카드사별_프로모션_마스터'} TSV 복사 완료`,
                    description: '구글 시트 A1 셀을 선택하고 Ctrl+V를 누르면 표 전체가 그대로 입력됩니다.',
                  });
                }}
                className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-800 hover:bg-slate-100"
              >
                <Copy className="h-3.5 w-3.5" />
                TSV 복사
              </button>
            </div>
          </div>

          <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-bold text-slate-500">붙여넣기 대상</span>
              <button type="button" onClick={() => setSheetImportTarget('RATE')} className={chipClass(sheetImportTarget === 'RATE')}>
                요율표 ({rateTableRows.length}행)
              </button>
              <button type="button" onClick={() => setSheetImportTarget('PROMO')} className={chipClass(sheetImportTarget === 'PROMO')}>
                프로모션 ({cardPromotions.length}건)
              </button>
              <select
                value={sheetImportMode}
                onChange={(e) => setSheetImportMode(e.target.value as 'MERGE' | 'REPLACE')}
                aria-label="붙여넣기 방식"
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-bold text-slate-800"
              >
                <option value="MERGE">기존 데이터에 병합/갱신</option>
                <option value="REPLACE">시트 데이터로 전체 교체</option>
              </select>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <textarea
                rows={2}
                value={sheetTsvInput}
                onChange={(e) => setSheetTsvInput(e.target.value)}
                placeholder={`${sheetImportTarget === 'RATE' ? '05_요율표_마스터' : '06_카드사별_프로모션_마스터'} 시트에서 행을 복사(Ctrl+C)해 붙여넣으세요(Ctrl+V)`}
                className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 font-mono text-xs focus:border-slate-900 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => {
                  if (!sheetTsvInput.trim()) return;
                  const res =
                    sheetImportTarget === 'RATE'
                      ? importRateTableRowsFromSheetTsv(sheetTsvInput, sheetImportMode)
                      : importPromotionsFromSheetTsv(sheetTsvInput, sheetImportMode);
                  if (res.ok) setSheetTsvInput('');
                }}
                className="shrink-0 whitespace-nowrap rounded-lg bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800"
              >
                붙여넣은 행 반영
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 카드사 필터 (요율표 · 프로모션 탭 공통) */}
      {activeTab !== 'IMAGE' && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-100 px-5 py-3">
          <button type="button" onClick={() => setCardFilter('ALL')} className={chipClass(cardFilter === 'ALL')}>
            전체
          </button>
          {SPLIT_CARD_COMPANIES.map((card) => {
            const isSelected = cardFilter === card;
            return (
              <button
                key={card}
                type="button"
                onClick={() => setCardFilter(isSelected ? 'ALL' : card)}
                className={chipClass(isSelected)}
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-full ring-1 ring-black/10"
                  style={{ backgroundColor: CARD_COMPANY_COLORS[card].mainHex }}
                />
                {card}
              </button>
            );
          })}
        </div>
      )}

      {/* =====================================================================
          탭 1: 별도 데이터 표 형식 (카드사별 메인 컬러 적용 + 선택 카드사 하이라이트 + ADMIN 전용 수정)
         ===================================================================== */}
      {activeTab === 'DATA' && (
        <div className="p-4 space-y-3">
          {/* 필터 & Admin 데이터 추가 버튼 (카드사 필터는 상단 브랜드 컬러 바에서 단일 제어) */}
          <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 p-3 rounded-xl border border-slate-200/80">
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={methodFilter}
                onChange={(e) => setMethodFilter(e.target.value as 'ALL' | SplitPaymentMethod)}
                aria-label="요율표 결제방법 필터"
                className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-bold text-slate-700"
              >
                <option value="ALL">결제방법 전체</option>
                {SPLIT_PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>

              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="구간·비고 검색..."
                  className="pl-8 pr-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs w-44 focus:outline-none focus:border-slate-500"
                />
              </div>
            </div>

            {canEdit && (
              <button
                type="button"
                onClick={openNewRowForm}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold shadow-sm transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                신규 요율 등록
              </button>
            )}
          </div>

          {/* ADMIN 전용 요율 행 추가 / 수정 / [복사 후 수정 등록] 인라인 폼 */}
          {showRowForm && canEdit && (
            <form
              onSubmit={handleSaveRow}
              className={`rounded-xl p-4 space-y-3 border ${
                copiedFromRowLabel
                  ? 'bg-amber-50/60 border-amber-300'
                  : 'bg-slate-50 border-slate-200'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  {copiedFromRowLabel ? (
                    <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-900">
                      <Copy className="w-3 h-3" />
                      복사하여 신규 등록 모드
                    </span>
                  ) : null}
                  <span className="text-xs font-extrabold text-slate-900">
                    {editingRowId
                      ? '기존 요율 데이터 행 수정 (ADMIN)'
                      : copiedFromRowLabel
                      ? `복사 원본 [${copiedFromRowLabel}] 기반 → 필요한 항목만 수정 후 신규 등록`
                      : '신규 요율표 데이터 행 등록 (ADMIN)'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowRowForm(false);
                    setCopiedFromRowLabel(null);
                  }}
                  className="text-xs font-bold text-slate-500 hover:text-slate-800"
                >
                  취소
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <div>
                  <label htmlFor="rt-card-select" className="block text-xs font-bold text-slate-700 mb-1">카드사</label>
                  <select
                    id="rt-card-select"
                    value={rowCard}
                    onChange={(e) => setRowCard(e.target.value as SplitCardCompany)}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-semibold"
                  >
                    {SPLIT_CARD_COMPANIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="rt-method-select" className="block text-xs font-bold text-slate-700 mb-1">결제방법</label>
                  <select
                    id="rt-method-select"
                    value={rowMethod}
                    onChange={(e) => {
                      const next = e.target.value as SplitPaymentMethod;
                      setRowMethod(next);
                      if (next === '일시불') {
                        setRowMonths('1달');
                        setRowInterest('0');
                      } else {
                        setRowMonths('24 / 36 / 48개월');
                        setRowCashback('0');
                      }
                    }}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-semibold"
                  >
                    {SPLIT_PAYMENT_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="rt-category-input" className="block text-xs font-bold text-slate-700 mb-1">
                    구분 (유형 옵션)
                  </label>
                  <input
                    id="rt-category-input"
                    type="text"
                    list="rt-category-presets"
                    value={rowCategory}
                    onChange={(e) => setRowCategory(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-bold"
                    placeholder="예: 기본, 저금리, 선입금(가상계좌)"
                  />
                  <datalist id="rt-category-presets">
                    <option value="기본" />
                    <option value="저금리" />
                    <option value="고금리(고수수료)" />
                    <option value="선입금(가상계좌)" />
                    <option value="신용한도" />
                    <option value="중도상환면제" />
                    <option value="신규발급특판" />
                  </datalist>
                </div>
                <div>
                  <label htmlFor="rt-tier-input" className="block text-xs font-bold text-slate-700 mb-1">금액 구간</label>
                  <input
                    id="rt-tier-input"
                    type="text"
                    value={rowTier}
                    onChange={(e) => setRowTier(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-bold"
                    placeholder="예: 3,000만원 이상"
                  />
                </div>
                <div>
                  <label htmlFor="rt-months-input" className="block text-xs font-bold text-slate-700 mb-1">
                    할부개월 (일시불 1달)
                  </label>
                  <input
                    id="rt-months-input"
                    type="text"
                    value={rowMethod === '일시불' ? '1달' : rowMonths}
                    disabled={rowMethod === '일시불'}
                    onChange={(e) => setRowMonths(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white disabled:bg-slate-100 text-xs"
                  />
                </div>
                <div>
                  <label htmlFor="rt-cashback-input" className="block text-xs font-bold text-slate-700 mb-1">
                    캐시백 % (일시불 전용)
                  </label>
                  <input
                    id="rt-cashback-input"
                    type="text"
                    inputMode="decimal"
                    value={rowMethod === '일시불' ? rowCashback : '0'}
                    disabled={rowMethod !== '일시불'}
                    onChange={(e) => setRowCashback(fixDecimal(e.target.value))}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white disabled:bg-slate-100 text-xs font-bold text-slate-700"
                  />
                </div>
                <div>
                  <label htmlFor="rt-interest-input" className="block text-xs font-bold text-slate-700 mb-1">
                    할부 금리 % (할부 전용)
                  </label>
                  <input
                    id="rt-interest-input"
                    type="text"
                    inputMode="decimal"
                    value={rowMethod === '일시불' ? '0' : rowInterest}
                    disabled={rowMethod === '일시불'}
                    onChange={(e) => setRowInterest(fixDecimal(e.target.value))}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white disabled:bg-slate-100 text-xs font-bold text-slate-900"
                  />
                </div>
                <div>
                  <label htmlFor="rt-cm-rate-input" className="block text-xs font-bold text-slate-700 mb-1">
                    CM 수수료율 (%)
                  </label>
                  <input
                    id="rt-cm-rate-input"
                    type="text"
                    inputMode="decimal"
                    value={rowCmRate}
                    onChange={(e) => setRowCmRate(fixDecimal(e.target.value))}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-bold text-slate-700"
                  />
                </div>
                <div>
                  <label htmlFor="rt-ag-rate-input" className="block text-xs font-bold text-slate-700 mb-1">
                    AG 수수료율 (%)
                  </label>
                  <input
                    id="rt-ag-rate-input"
                    type="text"
                    inputMode="decimal"
                    value={rowAgRate}
                    onChange={(e) => setRowAgRate(fixDecimal(e.target.value))}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-bold text-slate-800"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <input
                  type="date"
                  aria-label="요율 실행일자"
                  value={rowEffectiveDate}
                  onChange={(e) => setRowEffectiveDate(e.target.value)}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs"
                />
                <input
                  type="text"
                  aria-label="요율 비고 및 세부조건"
                  value={rowRemark}
                  onChange={(e) => setRowRemark(e.target.value)}
                  placeholder="비고 및 세부 조건 안내"
                  className="flex-1 min-w-[180px] px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs"
                />
                <button
                  type="submit"
                  className="inline-flex items-center gap-1 px-3.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold"
                >
                  <Check className="w-3.5 h-3.5" />
                  {editingRowId
                    ? '수정 저장'
                    : copiedFromRowLabel
                    ? '복사본 신규 등록'
                    : '신규 등록'}
                </button>
              </div>
            </form>
          )}

          {/* 데이터 표 */}
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold text-slate-500">
                  <th className="whitespace-nowrap px-3 py-2.5">카드사</th>
                  <th className="whitespace-nowrap px-2.5 py-2.5">결제방법</th>
                  <th className="whitespace-nowrap px-2.5 py-2.5">적용구간 / 개월</th>
                  <th className="whitespace-nowrap px-2.5 py-2.5 text-right">캐시백</th>
                  <th className="whitespace-nowrap px-2.5 py-2.5 text-right">할부금리</th>
                  <th className="whitespace-nowrap px-2.5 py-2.5 text-right">CM 수수료</th>
                  <th className="whitespace-nowrap px-2.5 py-2.5 text-right">AG 수수료</th>
                  <th className="whitespace-nowrap px-3 py-2.5">비고 / 실행일</th>
                  {canEdit && <th className="px-2.5 py-2.5 text-right"><span className="sr-only">관리</span></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {filteredRows.length === 0 && (
                  <tr>
                    <td colSpan={canEdit ? 9 : 8} className="py-10 text-center text-xs font-semibold text-slate-400">
                      조건에 맞는 요율이 없습니다.
                    </td>
                  </tr>
                )}
                {filteredRows.map((row) => {
                  const isLump = row.paymentMethod === '일시불';
                  return (
                    <tr key={row.id} className="transition-colors hover:bg-slate-50">
                      <td className="whitespace-nowrap px-3 py-3">
                        <span className="inline-flex items-center gap-1.5 font-bold text-slate-900">
                          <span
                            className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-black/10"
                            style={{ backgroundColor: CARD_COMPANY_COLORS[row.cardCompany].mainHex }}
                          />
                          {row.cardCompany}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-2.5 py-3">
                        <span className="font-bold text-slate-800">{row.paymentMethod}</span>
                        <span className="ml-1.5 rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600">
                          {row.category || '일반'}
                        </span>
                      </td>
                      <td className="px-2.5 py-3">
                        <div className="font-bold text-slate-900">{row.amountTier}</div>
                        <div className="text-[11px] text-slate-500">{row.installmentMonths}</div>
                      </td>
                      <td className="whitespace-nowrap px-2.5 py-3 text-right font-extrabold tabular-nums text-slate-900">
                        {isLump ? `${row.cashbackRate.toFixed(2)}%` : <span className="text-slate-300">-</span>}
                      </td>
                      <td className="whitespace-nowrap px-2.5 py-3 text-right font-extrabold tabular-nums text-slate-900">
                        {!isLump ? `${row.interestRate.toFixed(2)}%` : <span className="text-slate-300">-</span>}
                      </td>
                      <td className="whitespace-nowrap px-2.5 py-3 text-right font-bold tabular-nums text-slate-700">
                        {row.cmCommissionRate.toFixed(2)}%
                      </td>
                      <td className="whitespace-nowrap px-2.5 py-3 text-right font-bold tabular-nums text-slate-700">
                        {row.agCommissionRate.toFixed(2)}%
                      </td>
                      <td className="px-3 py-3 text-[11px] text-slate-600">
                        <div>{row.remark}</div>
                        <div className="text-slate-400">실행 {row.effectiveDate}</div>
                      </td>
                      {canEdit && (
                        <td className="whitespace-nowrap px-2.5 py-3 text-right">
                          {confirmDeleteRowId === row.id ? (
                            <span className="inline-flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-2 py-1">
                              <button
                                type="button"
                                onClick={() => {
                                  deleteRateTableRow(row.id);
                                  setConfirmDeleteRowId(null);
                                }}
                                className="text-xs font-bold text-rose-700 hover:underline"
                              >
                                삭제
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteRowId(null)}
                                className="text-xs font-semibold text-slate-500 hover:text-slate-800"
                              >
                                취소
                              </button>
                            </span>
                          ) : (
                            <div className="inline-flex items-center gap-0.5">
                              <button
                                type="button"
                                onClick={() => openCopyRowForm(row)}
                                aria-label="복사해서 새 요율 등록"
                                title="이 행을 복사해 필요한 부분만 고쳐 새로 등록"
                                className="flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                              >
                                <Copy className="h-4 w-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => openEditRowForm(row)}
                                aria-label="요율 행 수정"
                                title="수정"
                                className="flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                              >
                                <Edit3 className="h-4 w-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteRowId(row.id)}
                                aria-label="요율 행 삭제"
                                title="삭제"
                                className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* =====================================================================
          탭 2: 카드사 별 프로모션 (ADMIN 전용 수정 + 캐시백/금리/AG/CM ±% 마이너스 반영 지원 + 카드사 컬러 적용)
         ===================================================================== */}
      {activeTab === 'PROMO' && (
        <div className="p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 p-3 rounded-xl border border-slate-200">
            <span className="text-xs text-slate-600">
              위 카드사 필터로 좁혀 볼 수 있습니다. 요율 반영은 <strong>+%</strong>와{' '}
              <strong className="text-rose-600">-%</strong> 모두 지원합니다.
            </span>

            {canEdit && (
              <button
                type="button"
                onClick={openNewPromoForm}
                className="inline-flex items-center gap-1.5 whitespace-nowrap px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                카드사 프로모션 추가
              </button>
            )}
          </div>

          {/* ADMIN 전용 프로모션 등록 / 수정 / 복사 등록 폼 (+% 및 -% 마이너스 요율 반영 지원) */}
          {showPromoForm && canEdit && (
            <form
              onSubmit={handleSavePromo}
              className={`rounded-xl p-4 space-y-3 border ${
                copiedFromPromoLabel
                  ? 'bg-amber-50/60 border-amber-300'
                  : 'bg-slate-50 border-slate-200'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-extrabold text-slate-900">
                  {editingPromoId
                    ? '카드사 프로모션 수정 (ADMIN · ±% 마이너스 반영 지원)'
                    : copiedFromPromoLabel
                    ? `프로모션 복사 등록 (원본: ${copiedFromPromoLabel})`
                    : '신규 카드사 별 프로모션 등록 (ADMIN · ±% 마이너스 반영 지원)'}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setShowPromoForm(false);
                    setCopiedFromPromoLabel(null);
                  }}
                  className="text-xs font-bold text-slate-500"
                >
                  취소
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">카드사</label>
                  <select
                    value={promoCard}
                    onChange={(e) => setPromoCard(e.target.value as SplitCardCompany)}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-bold"
                  >
                    {SPLIT_CARD_COMPANIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    프로모션 제목
                  </label>
                  <input
                    type="text"
                    required
                    value={promoTitle}
                    onChange={(e) => setPromoTitle(e.target.value)}
                    placeholder="예: 삼성 다이렉트할부 저금리(-0.5%) 특판 (AG/CM 마이너스 요율 반영)"
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-bold"
                  />
                </div>
              </div>

              {/* 기간 & 결제방법 */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    프로모션 시작일
                  </label>
                  <input
                    type="date"
                    value={promoStartDate}
                    onChange={(e) => setPromoStartDate(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[11px] font-bold text-slate-700">
                      마감일 (미지정 시 계속 진행)
                    </label>
                    <label className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={!promoHasEndDate}
                        onChange={(e) => setPromoHasEndDate(!e.target.checked)}
                      />
                      계속 진행
                    </label>
                  </div>
                  {promoHasEndDate ? (
                    <input
                      type="date"
                      value={promoEndDate}
                      onChange={(e) => setPromoEndDate(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs"
                    />
                  ) : (
                    <input
                      type="text"
                      disabled
                      value="마감일 없음 (계속 진행)"
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-slate-100 text-xs font-bold text-slate-600"
                    />
                  )}
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    결제방법 (일시불/할부/다이렉트할부/통합)
                  </label>
                  <select
                    value={promoMethod}
                    onChange={(e) => setPromoMethod(e.target.value as PromotionPaymentMethod)}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-bold"
                  >
                    {PROMOTION_PAYMENT_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* 금액조건 */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    최소 금액 (원)
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={promoMinAmount}
                    onChange={(e) => setPromoMinAmount(fixDecimal(e.target.value))}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-bold"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    최대 금액 (원, 비워두면 제한없음)
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={promoMaxAmount}
                    onChange={(e) => setPromoMaxAmount(fixDecimal(e.target.value))}
                    placeholder="제한 없음"
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    금액조건 라벨 (금액대 지정 표기)
                  </label>
                  <input
                    type="text"
                    value={promoAmountLabel}
                    onChange={(e) => setPromoAmountLabel(e.target.value)}
                    placeholder="예: 3,000만원 이상 ~ 5,000만원 미만"
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-bold"
                  />
                </div>
              </div>

              {/* [요구사항 2] 기존 캐시백·금리·AG·CM 요율에 + % 또는 - % (마이너스 반영) 설정 */}
              <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[11px] font-extrabold text-slate-800">
                    요율 가감 설정 (±% : 양수 입력 시 가산, <strong className="text-rose-600">음수 - 입력 시 기존 캐시백·금리·AG·CM 요율에 마이너스 반영</strong>)
                  </span>
                  <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                    예: -0.20 입력 시 기존 요율에서 -0.20% 차감 반영
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      캐시백 요율 변동 (±%)
                    </label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={promoCashbackDelta}
                      onChange={(e) => setPromoCashbackDelta(fixDecimal(e.target.value))}
                      placeholder="예: -0.20 또는 0.15"
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-extrabold text-slate-700"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      할부 금리 변동 (±%)
                    </label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={promoInterestDelta}
                      onChange={(e) => setPromoInterestDelta(fixDecimal(e.target.value))}
                      placeholder="예: -0.50 (금리인하)"
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-extrabold text-slate-900"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      CM 요율 변동 (±%)
                    </label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={promoCmRate}
                      onChange={(e) => setPromoCmRate(fixDecimal(e.target.value))}
                      placeholder="예: 0.10 또는 -0.10"
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-extrabold text-slate-700"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      AG 요율 변동 (±%)
                    </label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={promoAgRate}
                      onChange={(e) => setPromoAgRate(fixDecimal(e.target.value))}
                      placeholder="예: 0.15 또는 -0.20"
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-extrabold text-slate-700"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      CM 추가/차감 인센티브 정액 (원, ± 가능)
                    </label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={promoCmAmount}
                      onChange={(e) => setPromoCmAmount(fixDecimal(e.target.value))}
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-bold text-slate-700"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      AG 추가/차감 인센티브 정액 (원, ± 가능)
                    </label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={promoAgAmount}
                      onChange={(e) => setPromoAgAmount(fixDecimal(e.target.value))}
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-bold text-slate-700"
                    />
                  </div>
                </div>
              </div>

              {/* 프로모션 조건 (불릿포인트 식 장문 텍스트 설명) */}
              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">
                  프로모션 조건 상세 (불릿포인트 • 식 장문 텍스트 설명)
                </label>
                <textarea
                  rows={4}
                  value={promoBullets}
                  onChange={(e) => setPromoBullets(e.target.value)}
                  placeholder="• 대상 결제방법: ...&#10;• 인센티브/마이너스 요율 반영 기준: ...&#10;• 유의사항: ..."
                  className="w-full rounded-lg border border-slate-300 bg-white p-2.5 text-xs leading-relaxed"
                />
              </div>

              <div className="flex justify-end">
                <button
                  type="submit"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 px-4 py-2 text-xs font-extrabold text-white"
                >
                  <Check className="w-3.5 h-3.5" />
                  {editingPromoId
                    ? '프로모션 수정 저장'
                    : copiedFromPromoLabel
                    ? '복사본 프로모션 등록'
                    : '프로모션 등록'}
                </button>
              </div>
            </form>
          )}

          {/* 프로모션 카드 목록 (카드사별 메인 컬러 + ±% 마이너스 요율 표시) */}
          <div className="space-y-3">
            {filteredPromotions.length === 0 && (
              <p className="rounded-xl border border-dashed border-slate-200 py-10 text-center text-xs font-semibold text-slate-400">
                등록된 프로모션이 없습니다.
              </p>
            )}
            {filteredPromotions.map((p) => {
              const cardColor = CARD_COMPANY_COLORS[p.cardCompany];
              const cbDelta = Number(p.cashbackRateDelta) || 0;
              const intDelta = Number(p.interestRateDelta) || 0;
              const hasNegativeRate =
                cbDelta < 0 || intDelta < 0 || p.agIncentiveRate < 0 || p.cmIncentiveRate < 0;

              return (
                <div
                  key={p.id}
                  className="rounded-xl border border-slate-200 bg-white p-4 transition-all hover:border-slate-300"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="inline-flex items-center gap-1.5 pr-1 text-xs font-bold text-slate-900">
                          <span
                            className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-black/10"
                            style={{ backgroundColor: cardColor.mainHex }}
                          />
                          {p.cardCompany}
                        </span>
                        <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-800">
                          결제방법: {p.paymentMethod}
                        </span>
                        <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-700">
                          금액조건: {p.amountConditionLabel}
                        </span>
                        <span
                          className={`rounded-md px-2 py-0.5 text-xs font-bold ${
                            p.endDate
                              ? 'bg-slate-100 text-slate-700'
                              : 'bg-emerald-50 text-emerald-700'
                          }`}
                        >
                          기간: {p.startDate} ~ {p.endDate ? p.endDate : '계속 진행'}
                        </span>
                        {hasNegativeRate && (
                          <span className="rounded-md bg-rose-50 px-2 py-0.5 text-xs font-bold text-rose-700">
                            -% 마이너스 요율 반영
                          </span>
                        )}
                      </div>
                      <h4 className="text-sm font-black text-slate-900 pt-0.5">{p.title}</h4>
                    </div>

                    <div className="flex items-center gap-1.5">
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => openCopyPromoForm(p)}
                          aria-label="복사해서 새 프로모션 등록"
                          title="이 프로모션을 복사해 필요한 부분만 고쳐 새로 등록"
                          className="flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                        >
                          <Copy className="h-4 w-4" />
                        </button>
                      )}
                      {canEdit && (
                        <button
                          type="button"
                          aria-label="프로모션 수정"
                          onClick={() => openEditPromoForm(p)}
                          className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-slate-200 text-slate-600 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
                          title="수정"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                      )}
                      {canEdit &&
                        (confirmDeletePromoId === p.id ? (
                          <span className="inline-flex items-center gap-1.5 rounded-md bg-rose-50 border border-rose-200 px-2 py-1">
                            <button
                              type="button"
                              onClick={() => {
                                deleteCardPromotion(p.id);
                                setConfirmDeletePromoId(null);
                              }}
                              className="text-xs font-bold text-rose-700 hover:underline"
                            >
                              삭제확인
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeletePromoId(null)}
                              className="text-xs text-slate-500 hover:text-slate-800"
                            >
                              취소
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            aria-label="프로모션 삭제"
                            onClick={() => setConfirmDeletePromoId(p.id)}
                            className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-rose-100 text-slate-400 hover:text-rose-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
                            title="삭제"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        ))}
                    </div>
                  </div>

                  {/* 캐시백 / 금리 / AG / CM 요율 변동 (±% 마이너스 반영 포함) 및 정액 배지 */}
                  <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs">
                    {cbDelta !== 0 && (
                      <div
                        className={`rounded-lg border px-2.5 py-1.5 font-extrabold ${
                          cbDelta < 0
                            ? 'bg-rose-50 border-rose-200 text-rose-800'
                            : 'bg-slate-50 border-slate-200 text-slate-800'
                        }`}
                      >
                        캐시백 요율 반영: <strong>{formatSignedRate(cbDelta)}</strong>
                      </div>
                    )}
                    {intDelta !== 0 && (
                      <div
                        className={`rounded-lg border px-2.5 py-1.5 font-extrabold ${
                          intDelta < 0
                            ? 'bg-rose-50 border-rose-200 text-rose-800'
                            : 'bg-slate-50 border-slate-200 text-slate-800'
                        }`}
                      >
                        할부 금리 반영: <strong>{formatSignedRate(intDelta)}</strong>
                      </div>
                    )}
                    <div
                      className={`rounded-lg border px-3 py-1.5 font-bold ${
                        p.cmIncentiveRate < 0 || p.cmIncentiveAmount < 0
                          ? 'bg-rose-50 border-rose-200 text-rose-900'
                          : 'bg-slate-50 border-slate-200 text-slate-800'
                      }`}
                    >
                      CM 요율 반영:{' '}
                      <strong
                        className={
                          p.cmIncentiveRate < 0 ? 'text-rose-700' : 'text-slate-900'
                        }
                      >
                        {formatSignedRate(p.cmIncentiveRate)}
                      </strong>
                      {p.cmIncentiveAmount !== 0 && (
                        <>
                          {' '}
                          · 정액 <strong>{formatSignedKRW(p.cmIncentiveAmount)}</strong>
                        </>
                      )}
                    </div>
                      <div
                        className={`rounded-lg border px-3 py-1.5 font-bold ${
                          p.agIncentiveRate < 0 || p.agIncentiveAmount < 0
                            ? 'bg-rose-50 border-rose-200 text-rose-900'
                            : 'bg-slate-50 border-slate-200 text-slate-800'
                        }`}
                      >
                        AG 요율 반영:{' '}
                        <strong
                          className={
                            p.agIncentiveRate < 0 ? 'text-rose-700' : 'text-slate-900'
                          }
                        >
                          {formatSignedRate(p.agIncentiveRate)}
                        </strong>
                        {p.agIncentiveAmount !== 0 && (
                          <>
                            {' '}
                            · 정액 <strong>{formatSignedKRW(p.agIncentiveAmount)}</strong>
                          </>
                        )}
                      </div>
                  </div>

                  {/* 불릿포인트 장문 설명 */}
                  <div className="mt-2.5 rounded-lg bg-slate-50 p-3 text-xs text-slate-700 whitespace-pre-line leading-relaxed">
                    {p.promotionConditionText}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* =====================================================================
          탭 3: 이미지 형식 (ADMIN 전용 등록·삭제)
         ===================================================================== */}
      {activeTab === 'IMAGE' && (
        <div className="p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 p-3 rounded-xl border border-slate-200">
            <div className="text-xs text-slate-600">
              관리자(Admin)가 업로드한 카드사 공식 요율표 및 프로모션 이미지 원본입니다. 이미지를 클릭하면 크게 확대됩니다.
            </div>
            {canEdit && (
              <button
                type="button"
                onClick={() => setShowImageForm((v) => !v)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold"
              >
                <Upload className="w-3.5 h-3.5" />
                요율표 이미지 추가 (ADMIN)
              </button>
            )}
          </div>

          {showImageForm && canEdit && (
            <form
              onSubmit={handleAddImage}
              className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-extrabold text-slate-900">
                  신규 요율표 이미지 등록 (ADMIN 전용 · 파일 업로드 또는 이미지 URL)
                </span>
                <button
                  type="button"
                  onClick={() => setShowImageForm(false)}
                  className="text-xs text-slate-500"
                >
                  닫기
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <input
                  type="text"
                  required
                  value={imgTitle}
                  onChange={(e) => setImgTitle(e.target.value)}
                  placeholder="요율표 제목 (예: 11월 2차 신한·국민 요율표)"
                  className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs"
                />
                <input
                  type="text"
                  value={imgCardTag}
                  onChange={(e) => setImgCardTag(e.target.value)}
                  placeholder="카드사 태그 (예: 신한·국민)"
                  className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs"
                />
                <input
                  type="date"
                  value={imgEffectiveDate}
                  onChange={(e) => setImgEffectiveDate(e.target.value)}
                  className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <label className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-dashed border-slate-300 bg-white text-xs font-bold text-slate-700 cursor-pointer hover:bg-slate-50">
                  <Upload className="w-4 h-4" />
                  {imgFile ? `선택됨: ${imgFile.name}` : '내 PC에서 요율표 이미지 파일 선택 (PNG/JPG/WebP)'}
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </label>
                <input
                  type="text"
                  value={imgUrl}
                  onChange={(e) => {
                    setImgUrl(e.target.value);
                    setImgFile(null);
                  }}
                  placeholder="또는 이미지 URL 직접 붙여넣기"
                  className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs"
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={imgNote}
                  onChange={(e) => setImgNote(e.target.value)}
                  placeholder="안내 메모 (선택)"
                  className="flex-1 px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs"
                />
                <button
                  type="submit"
                  disabled={isUploadingImage}
                  className="px-4 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold disabled:opacity-60"
                >
                  {isUploadingImage ? '업로드 중…' : '이미지 등록'}
                </button>
              </div>
            </form>
          )}

          <div className="space-y-4">
            {rateTableImages.map((img) => {
              return (
                <div
                  key={img.id}
                  className="border border-slate-200 rounded-xl overflow-hidden bg-slate-900/5"
                >
                  <div className="bg-white px-4 py-2.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 text-[11px] font-bold">
                          {img.cardCompanyTag}
                        </span>
                        <span className="text-xs font-extrabold text-slate-900">{img.title}</span>
                      </div>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        실행일: {img.effectiveDate} · 등록: {img.uploadedBy} ({img.uploadedAt}) · {img.note}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setZoomedImageUrl(img.imageUrl)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold"
                      >
                        <ZoomIn className="w-3.5 h-3.5" />
                        확대보기
                      </button>
                      {canEdit &&
                        (confirmDeleteImageId === img.id ? (
                          <span className="inline-flex items-center gap-1 rounded bg-rose-50 border border-rose-200 px-2 py-1">
                            <button
                              type="button"
                              onClick={() => {
                                deleteRateTableImage(img.id);
                                setConfirmDeleteImageId(null);
                              }}
                              className="text-xs font-bold text-rose-700 hover:underline"
                            >
                              삭제확인
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteImageId(null)}
                              className="text-xs text-slate-500 hover:text-slate-800"
                            >
                              취소
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteImageId(img.id)}
                            className="p-1.5 rounded-lg hover:bg-rose-50 text-slate-400 hover:text-rose-600"
                            title="이미지 삭제"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        ))}
                    </div>
                  </div>
                  <div
                    role="button"
                    tabIndex={0}
                    aria-label={`${img.title} 이미지 원본 확대보기`}
                    onClick={() => setZoomedImageUrl(img.imageUrl)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setZoomedImageUrl(img.imageUrl);
                      }
                    }}
                    className="p-3 bg-slate-900 flex justify-center cursor-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
                  >
                    <img
                      src={img.imageUrl}
                      alt={img.title}
                      loading="lazy"
                      decoding="async"
                      className="max-h-[420px] w-auto rounded-lg shadow border border-slate-700"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 이미지 원본 확대 모달 */}
      {zoomedImageUrl && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="요율표 이미지 원본 확대보기"
          onClick={() => setZoomedImageUrl(null)}
          className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative max-w-5xl w-full bg-slate-900 rounded-2xl border border-slate-700 p-4 shadow-2xl"
          >
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-800">
              <span className="text-sm font-bold text-white">요율표 이미지 원본 확대보기</span>
              <button
                type="button"
                aria-label="확대 모달 닫기"
                onClick={() => setZoomedImageUrl(null)}
                className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-200 hover:bg-rose-600 text-xs font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
              >
                닫기 (ESC)
              </button>
            </div>
            <div className="overflow-auto max-h-[80vh] flex justify-center">
              <img src={zoomedImageUrl} alt="요율표 확대" className="max-w-full h-auto rounded-lg" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
