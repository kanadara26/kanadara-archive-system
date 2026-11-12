import {
  APPROVAL_STATUS_META,
  CARD_COMPANY_COLORS,
  CardPromotionItem,
  RateTableImageItem,
  PromotionPaymentMethod,
  RateTableRowItem,
  SPLIT_CARD_COMPANIES,
  SPLIT_PAYMENT_METHODS,
  SplitCardCompany,
  SplitPaymentMethod,
  Transaction,
  User,
} from '../types';
import {
  calcExpectedAgCommission,
  calcExpectedCashback,
  calcExpectedCommission,
  nowFormatted,
} from '../utils/format';

export const GOOGLE_MASTER_SPREADSHEET_ID = '1fGq9OKWroDBovIlkvdrkYmDFZp-HTkeJem5sirv6vvs';
export const GOOGLE_MASTER_SPREADSHEET_TITLE =
  '카나다라_오토캐시백_요율표_거래내역_통합마스터_2026';
export const GOOGLE_MASTER_SPREADSHEET_BASE_URL = `https://docs.google.com/spreadsheets/d/${GOOGLE_MASTER_SPREADSHEET_ID}/edit`;

export const GOOGLE_SHEET_TABS = {
  REGISTRATION_CONSOLE: {
    id: 1057963902,
    title: '00_조건_요율_프로모션_등록',
    url: `${GOOGLE_MASTER_SPREADSHEET_BASE_URL}#gid=1057963902`,
    desc: 'GAS 버튼 원클릭으로 조건·요율표(05)·프로모션(06)을 각각 등록하는 입력 콘솔',
  },
  RATE_TABLE_MASTER: {
    id: 584667537,
    title: '05_요율표_마스터',
    url: `${GOOGLE_MASTER_SPREADSHEET_BASE_URL}#gid=584667537`,
    desc: '카드사별 메인 컬러 및 일시불/할부/다이렉트할부 요율표 마스터 (ADMIN 전용 관리)',
  },
  PROMOTION_MASTER: {
    id: 98215369,
    title: '06_카드사별_프로모션_마스터',
    url: `${GOOGLE_MASTER_SPREADSHEET_BASE_URL}#gid=98215369`,
    desc: '카드사별 프로모션 마스터 (+% 인센티브 및 -% 마이너스 요율 조정·불릿포인트 조건)',
  },
  TRANSACTION_MASTER: {
    id: 753275814,
    title: '07_거래내역_통합마스터',
    url: `${GOOGLE_MASTER_SPREADSHEET_BASE_URL}#gid=753275814`,
    desc: 'AG 거래승인 요청 6단계 상태 + CM 6항목 자동연동 + 카드사고정 분할결제·수수료 통합 마스터',
  },
  SPLIT_PAYMENT_DB: {
    id: 628666182,
    title: '08_분할결제_상세행_DB',
    url: `${GOOGLE_MASTER_SPREADSHEET_BASE_URL}#gid=628666182`,
    desc: '복합 분할결제 건별 상세 행 데이터베이스 (일시불+할부 개별 집계용)',
  },
  USER_CM_MASTER: {
    id: 2084826623,
    title: '09_사용자_CM_마스터',
    url: `${GOOGLE_MASTER_SPREADSHEET_BASE_URL}#gid=2084826623`,
    desc: 'AG 및 CM 사용자 계정 원장 (로그인 계정 및 CM 프로필 실시간 영구 연동 DB)',
  },
} as const;

// 10_요율표_이미지: 웹훅(Apps Script)이 직접 관리하는 탭. 웹앱은 읽기만 하고 등록·삭제는 /api/images 로.
export const RATE_IMAGE_TAB = '10_요율표_이미지';

export function parseRateImagesFrom2D(rows: unknown[][] = []): RateTableImageItem[] {
  return rows
    .slice(1)
    .map((r) => r.map((c) => String(c ?? '').trim()))
    .filter((r) => r[0])
    .map(([id, title, cardCompanyTag, effectiveDate, note, uploadedBy, uploadedAt, fileId, , externalUrl]) => ({
      id,
      title,
      cardCompanyTag: cardCompanyTag || '전 카드사',
      effectiveDate,
      note,
      uploadedBy,
      uploadedAt,
      imageUrl: fileId ? `/api/images/file?id=${encodeURIComponent(id)}` : externalUrl || '',
    }))
    .reverse(); // 최근 등록이 위로
}

// 1. 05_요율표_마스터 헤더 및 직렬화/역직렬화
export const RATE_TABLE_SHEET_HEADERS = [
  '요율행ID',
  '카드사',
  '메인컬러코드',
  '결제방법',
  '구분',
  '적용금액구간',
  '할부개월(일시불1달)',
  '캐시백율(%)',
  '할부금리(%)',
  'AG수수료율(%)',
  'CM수수료율(%)',
  '실행일자',
  '비고 및 세부조건',
];

export function serializeRateTableTo2D(rows: RateTableRowItem[]): (string | number)[][] {
  const body = rows.map((r) => [
    r.id,
    r.cardCompany,
    CARD_COMPANY_COLORS[r.cardCompany]?.mainHex || '#172a88',
    r.paymentMethod,
    r.category || '일반',
    r.amountTier,
    r.installmentMonths,
    r.cashbackRate,
    r.interestRate,
    r.agCommissionRate,
    r.cmCommissionRate,
    r.effectiveDate,
    r.remark,
  ]);
  return [RATE_TABLE_SHEET_HEADERS, ...body];
}

export function serializeRateTableToTsv(rows: RateTableRowItem[], includeHeader = true): string {
  const matrix = serializeRateTableTo2D(rows);
  const target = includeHeader ? matrix : matrix.slice(1);
  return target.map((row) => row.map((cell) => String(cell ?? '').replace(/\t|\n/g, ' ')).join('\t')).join('\n');
}

// 붙여넣기(TSV/CSV) 입력용. 시트에서 받은 2차원 데이터는 parseRateTableFrom2D 사용 (셀 안 줄바꿈 보존).
export function parseRateTableFromTsv(rawText: string): {
  rows: RateTableRowItem[];
  errors: string[];
} {
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return parseRateTableFrom2D(lines.map((line) => (line.includes('\t') ? line.split('\t') : line.split(','))));
}

export function parseRateTableFrom2D(table: unknown[][] = []): {
  rows: RateTableRowItem[];
  errors: string[];
} {
  const lines = table.filter((r) => r.some((c) => String(c ?? '').trim()));
  const rows: RateTableRowItem[] = [];
  const errors: string[] = [];

  lines.forEach((line, idx) => {
    const cols = line.map((c) => String(c ?? ''));
    const first = (cols[0] || '').trim();
    if (first === '요율행ID' || first.toLowerCase() === 'id' || cols[1] === '카드사') {
      return; // skip header row
    }

    // 지원 포맷 A(신규 표준): 13컬럼 (요율행ID, 카드사, 메인컬러코드, 결제방법, 구분, 적용금액구간, 할부개월, 캐시백율, 할부금리, AG수수료율, CM수수료율, 실행일자, 비고)
    // 지원 포맷 B(구버전 호환): 12컬럼 (구분 컬럼 없는 경우) / 11컬럼 (메인컬러코드 없는 경우)
    const hasColorCol = (cols[2] || '').trim().startsWith('#');
    const offset = hasColorCol ? 0 : -1;

    const id = first || `rt-row-sheet-${Date.now()}-${idx}`;
    const rawCard = (cols[1] || '').trim();
    const cardCompany: SplitCardCompany = SPLIT_CARD_COMPANIES.includes(rawCard as SplitCardCompany)
      ? (rawCard as SplitCardCompany)
      : rawCard.includes('삼성') || rawCard.includes('제휴')
      ? '제휴카드사(삼성)'
      : '신한';

    const rawMethod = (cols[3 + offset] || '').trim();
    let paymentMethod: SplitPaymentMethod = '일시불';
    if (rawMethod.includes('다이렉트')) {
      paymentMethod = '다이렉트할부';
    } else if (rawMethod.includes('할부')) {
      paymentMethod = '할부';
    } else {
      paymentMethod = '일시불';
    }

    const col5 = (cols[5 + offset] || '').trim();
    const col6 = (cols[6 + offset] || '').trim();
    const isLegacyNoCategory =
      cols.length <= 12 + offset && /달|개월/.test(col5) && !/달|개월/.test(col6);
    const catOffset = offset + (isLegacyNoCategory ? 0 : 1);
    const rawCat = isLegacyNoCategory
      ? '일반'
      : (cols[4 + offset] || '일반').trim() || '일반';
    const category = rawCat === '기본' ? '일반' : rawCat;

    const amountTier = (cols[4 + catOffset] || (paymentMethod === '일시불' ? '1,000만원 이상' : '전액할부')).trim();
    const installmentMonths = (cols[5 + catOffset] || (paymentMethod === '일시불' ? '1달' : '24 / 36개월')).trim();
    const cashbackRate = Number(cols[6 + catOffset]) || 0;
    const interestRate = paymentMethod === '일시불' ? 0 : Number(cols[7 + catOffset]) || 0;
    const agCommissionRate = Number(cols[8 + catOffset]) || 0;
    const cmCommissionRate = Number(cols[9 + catOffset]) || 0;
    const effectiveDate = (cols[10 + catOffset] || '2026-11-01').trim();
    const remark = (cols[11 + catOffset] || '').trim();

    if (!rawCard) {
      errors.push(`${idx + 1}행: 카드사 누락`);
      return;
    }

    rows.push({
      id,
      cardCompany,
      paymentMethod,
      category,
      amountTier,
      installmentMonths,
      cashbackRate,
      interestRate,
      agCommissionRate,
      cmCommissionRate,
      effectiveDate,
      remark,
    });
  });

  return { rows, errors };
}

// 2. 06_카드사별_프로모션_마스터 헤더 및 직렬화/역직렬화
export const PROMOTION_SHEET_HEADERS = [
  '프로모션ID',
  '카드사',
  '메인컬러코드',
  '프로모션명',
  '시작일',
  '마감일(없을시_계속진행)',
  '결제방법(일시불/할부/다이렉트할부/통합)',
  '최소금액(원)',
  '최대금액(원_빈값무제한)',
  '금액조건라벨',
  '캐시백요율변동(±%)',
  '할부금리변동(±%)',
  'AG요율변동(±%)',
  'CM요율변동(±%)',
  'AG추가정액(±원)',
  'CM추가정액(±원)',
  '프로모션조건(불릿포인트설명)',
  '사용여부',
  '최종수정일시',
];

export function serializePromotionsTo2D(promos: CardPromotionItem[]): (string | number)[][] {
  const body = promos.map((p) => [
    p.id,
    p.cardCompany,
    CARD_COMPANY_COLORS[p.cardCompany]?.mainHex || '#172a88',
    p.title,
    p.startDate,
    p.endDate || '계속 진행',
    p.paymentMethod,
    p.minAmount,
    p.maxAmount ?? '',
    p.amountConditionLabel,
    p.cashbackRateDelta ?? 0,
    p.interestRateDelta ?? 0,
    p.agIncentiveRate,
    p.cmIncentiveRate,
    p.agIncentiveAmount,
    p.cmIncentiveAmount,
    p.promotionConditionText,
    p.isActive ? 'TRUE' : 'FALSE',
    p.updatedAt,
  ]);
  return [PROMOTION_SHEET_HEADERS, ...body];
}

export function serializePromotionsToTsv(promos: CardPromotionItem[], includeHeader = true): string {
  const matrix = serializePromotionsTo2D(promos);
  const target = includeHeader ? matrix : matrix.slice(1);
  return target
    .map((row) =>
      row
        .map((cell) =>
          String(cell ?? '')
            .replace(/\t/g, ' ')
            .replace(/\r?\n/g, ' / ')
        )
        .join('\t')
    )
    .join('\n');
}

// 붙여넣기(TSV/CSV) 입력용. 시트에서 받은 2차원 데이터는 parsePromotionsFrom2D 사용 (셀 안 줄바꿈 보존).
export function parsePromotionsFromTsv(rawText: string): {
  promotions: CardPromotionItem[];
  errors: string[];
} {
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return parsePromotionsFrom2D(lines.map((line) => (line.includes('\t') ? line.split('\t') : line.split(','))));
}

export function parsePromotionsFrom2D(table: unknown[][] = []): {
  promotions: CardPromotionItem[];
  errors: string[];
} {
  const lines = table.filter((r) => r.some((c) => String(c ?? '').trim()));
  const promotions: CardPromotionItem[] = [];
  const errors: string[] = [];

  lines.forEach((line, idx) => {
    const cols = line.map((c) => String(c ?? ''));
    const first = (cols[0] || '').trim();
    if (first === '프로모션ID' || cols[1] === '카드사') {
      return;
    }

    const hasColorCol = (cols[2] || '').trim().startsWith('#');
    const offset = hasColorCol ? 0 : -1;

    const id = first || `promo-sheet-${Date.now()}-${idx}`;
    const rawCard = (cols[1] || '').trim();
    const cardCompany: SplitCardCompany = SPLIT_CARD_COMPANIES.includes(rawCard as SplitCardCompany)
      ? (rawCard as SplitCardCompany)
      : '제휴카드사(삼성)';
    const title = (cols[3 + offset] || `${cardCompany} 시트 연동 프로모션`).trim();
    const startDate = (cols[4 + offset] || '2026-11-01').trim();
    const rawEnd = (cols[5 + offset] || '').trim();
    const endDate = !rawEnd || rawEnd === '계속 진행' || rawEnd === '-' ? null : rawEnd;

    const rawMethod = (cols[6 + offset] || '통합').trim() as PromotionPaymentMethod;
    const paymentMethod: PromotionPaymentMethod = ['일시불', '할부', '다이렉트할부', '통합'].includes(
      rawMethod
    )
      ? rawMethod
      : '통합';

    const minAmount = Number(String(cols[7 + offset] || '0').replace(/,/g, '')) || 0;
    const rawMax = String(cols[8 + offset] || '').replace(/,/g, '').trim();
    const maxAmount = rawMax ? Number(rawMax) : null;
    const amountConditionLabel =
      (cols[9 + offset] || '').trim() ||
      `${Math.round(minAmount / 10000).toLocaleString('ko-KR')}만원 이상`;

    const cashbackRateDelta = Number(cols[10 + offset]) || 0;
    const interestRateDelta = Number(cols[11 + offset]) || 0;
    const agIncentiveRate = Number(cols[12 + offset]) || 0;
    const cmIncentiveRate = Number(cols[13 + offset]) || 0;
    const agIncentiveAmount = Number(String(cols[14 + offset] || '0').replace(/,/g, '')) || 0;
    const cmIncentiveAmount = Number(String(cols[15 + offset] || '0').replace(/,/g, '')) || 0;
    const rawConditionText = (cols[16 + offset] || '• 시트 동기화 프로모션 조건').trim();
    const promotionConditionText = rawConditionText.replace(/\s*\/\s*•/g, '\n•');
    const rawActive = (cols[17 + offset] || 'TRUE').trim().toUpperCase();
    const isActive = rawActive !== 'FALSE' && rawActive !== 'N' && rawActive !== '0';
    const updatedAt = (cols[18 + offset] || nowFormatted()).trim();

    promotions.push({
      id,
      cardCompany,
      title,
      startDate,
      endDate,
      paymentMethod,
      minAmount,
      maxAmount,
      amountConditionLabel,
      cashbackRateDelta,
      interestRateDelta,
      agIncentiveRate,
      cmIncentiveRate,
      agIncentiveAmount,
      cmIncentiveAmount,
      promotionConditionText,
      isActive,
      updatedAt,
    });
  });

  return { promotions, errors };
}

// 3. 07_거래내역_통합마스터 직렬화
export const TRANSACTION_MASTER_SHEET_HEADERS = [
  '거래ID',
  '고객이름',
  '요청일자',
  '진행상황',
  '정산상황',
  '승인일자',
  'CM이름',
  'CM주민등록번호',
  'CM사업자등록번호',
  'CM전화번호',
  'CM소속',
  'CM사번',
  '기준카드사(분할고정)',
  '카드사컬러코드',
  '분할건수',
  '결제방법요약',
  '총결제금액(원)',
  '분할결제상세내역',
  '적용프로모션내역',
  '평균캐시백율(%)',
  '고객캐시백합계(원)',
  '평균AG수수료율(%)',
  'AG수수료합계(원)',
  '평균CM수수료율(%)',
  'CM수수료합계(원)',
  '담당AG',
  '전표승인번호/시트상태',
  '비고',
];

// 07 탭 마지막 열: 거래 원본 JSON. 시트에서 거래를 손실 없이 복원하는 유일한 근거.
// ponytail: 셀당 5만자 한도. 거래 history가 그 이상 커지면 별도 탭으로 분리.
export const TX_RAW_JSON_HEADER = '웹앱원본데이터(JSON)';

export function serializeTransactionsTo2D(
  transactions: Transaction[],
  users: User[],
  hideAgColumnsForCm = false
): (string | number)[][] {
  const headers = hideAgColumnsForCm
    ? TRANSACTION_MASTER_SHEET_HEADERS.filter(
        (h) => h !== '평균AG수수료율(%)' && h !== 'AG수수료합계(원)'
      )
    : [...TRANSACTION_MASTER_SHEET_HEADERS, TX_RAW_JSON_HEADER];

  const rows = transactions.map((tx) => {
    const splits = tx.paymentSplits || [];
    const primaryCard = splits[0]?.cardCompany || '제휴카드사(삼성)';
    const cardHex = CARD_COMPANY_COLORS[primaryCard]?.mainHex || '#172a88';
    const agUser = users.find((u) => u.id === tx.agId);

    const splitSummary = splits
      .map((s, i) => {
        const rateDetail =
          s.paymentMethod === '일시불'
            ? `1달, 캐시백 ${s.cashbackRate}%`
            : `${s.installmentMonths}개월, 금리 ${s.interestRate}%`;
        const commDetail = hideAgColumnsForCm
          ? `CM ${s.cmCommissionRate}%`
          : `AG ${s.agCommissionRate}%, CM ${s.cmCommissionRate}%`;
        const catTag = s.rateCategory ? `[${s.rateCategory}]` : '';
        return `[#${i + 1}] ${s.cardCompany}·${s.paymentMethod}${catTag} ${s.amount.toLocaleString(
          'ko-KR'
        )}원(${rateDetail}, ${commDetail})`;
      })
      .join(' + ');

    const promoSummary =
      tx.appliedPromotions && tx.appliedPromotions.length > 0
        ? tx.appliedPromotions
            .map((p) =>
              hideAgColumnsForCm
                ? `${p.title}(CM ${p.cmIncentiveRate >= 0 ? '+' : ''}${p.cmIncentiveRate}%)`
                : `${p.title}(AG ${p.agIncentiveRate >= 0 ? '+' : ''}${p.agIncentiveRate}%, CM ${
                    p.cmIncentiveRate >= 0 ? '+' : ''
                  }${p.cmIncentiveRate}%)`
            )
            .join(' | ')
        : '미적용';

    const slipStatusLabel = tx.slip
      ? `전표제출완료(#${tx.slip.approvalNumber}) / 시트:${tx.sheetSync.status}`
      : `전표미제출 / 시트:${tx.sheetSync.status}`;

    const cmUser = users.find((u) => u.id === tx.cmId);
    const cmName = tx.cmProfile?.name || cmUser?.name || '';
    const cmRrn = tx.cmProfile?.rrn || cmUser?.rrn || '';
    const cmBiz = tx.cmProfile?.businessNumber || cmUser?.businessNumber || '';
    const cmPhone = tx.cmProfile?.phone || cmUser?.phone || '';
    const cmAff = tx.cmProfile?.affiliation || cmUser?.affiliation || '';
    const cmEmpId = tx.cmProfile?.employeeId || cmUser?.employeeId || '';

    const totalAmount = tx.amount ?? splits.reduce((acc, s) => acc + (s.amount || 0), 0);
    const customerCashbackRate =
      tx.conditionSnapshot?.customerCashbackRate ?? (splits[0]?.cashbackRate || 0);

    let calculatedCashback = 0;
    try {
      calculatedCashback = calcExpectedCashback(tx);
    } catch {
      calculatedCashback = Math.round((totalAmount * customerCashbackRate) / 100);
    }

    const baseRow: (string | number)[] = [
      tx.id,
      tx.customerName,
      tx.requestDate,
      APPROVAL_STATUS_META[tx.status]?.label || tx.status,
      tx.settlementStatus || '정산 대기',
      tx.approvalDate || '',
      cmName,
      cmRrn,
      cmBiz,
      cmPhone,
      cmAff,
      cmEmpId,
      primaryCard,
      cardHex,
      `${splits.length}건`,
      Array.from(new Set(splits.map((s) => s.paymentMethod))).join(' + '),
      totalAmount,
      splitSummary,
      promoSummary,
      customerCashbackRate,
      calculatedCashback,
    ];

    let agComm = 0;
    try {
      agComm = calcExpectedAgCommission(tx);
    } catch {
      agComm = Math.round((totalAmount * (splits[0]?.agCommissionRate || 0.85)) / 100);
    }

    let cmComm = 0;
    try {
      cmComm = calcExpectedCommission(tx);
    } catch {
      cmComm = Math.round((totalAmount * (splits[0]?.cmCommissionRate || 0.5)) / 100);
    }

    if (!hideAgColumnsForCm) {
      baseRow.push(
        tx.conditionSnapshot?.agCommissionRate ?? (splits[0]?.agCommissionRate ?? 0.85),
        agComm
      );
    }

    baseRow.push(
      tx.conditionSnapshot?.cmCommissionRate ?? (splits[0]?.cmCommissionRate ?? 0.5),
      cmComm,
      agUser ? `${agUser.name}(${agUser.affiliation})` : tx.agId,
      slipStatusLabel,
      tx.requestMemo || tx.vehicleInfo || ''
    );

    if (!hideAgColumnsForCm) {
      baseRow.push(JSON.stringify(tx));
    }

    return baseRow;
  });

  return [headers, ...rows];
}

// 07 탭 → 거래 목록 복원. JSON 열이 없는 거래 행은 복원 불가(legacy)로 집계.
export function parseTransactionsFrom2D(rows: unknown[][]): {
  transactions: Transaction[];
  legacyRowCount: number;
} {
  const [header = [], ...body] = rows || [];
  const jsonCol = header.findIndex((h) => String(h).trim() === TX_RAW_JSON_HEADER);
  const transactions: Transaction[] = [];
  let legacyRowCount = 0;
  for (const r of body) {
    if (!String(r[0] ?? '').trim()) continue;
    try {
      transactions.push(JSON.parse(String(r[jsonCol])) as Transaction);
    } catch {
      legacyRowCount++;
    }
  }
  return { transactions, legacyRowCount };
}

// 웹앱 상태 → 시트 5개 탭 전체 쓰기 명령
export function buildMasterBatchOps(
  rates: RateTableRowItem[],
  promos: CardPromotionItem[],
  transactions: Transaction[],
  users: User[]
) {
  return [
    { op: 'write', range: `'${GOOGLE_SHEET_TABS.RATE_TABLE_MASTER.title}'!A1`, data: serializeRateTableTo2D(rates) },
    { op: 'write', range: `'${GOOGLE_SHEET_TABS.PROMOTION_MASTER.title}'!A1`, data: serializePromotionsTo2D(promos) },
    { op: 'write', range: `'${GOOGLE_SHEET_TABS.TRANSACTION_MASTER.title}'!A1`, data: serializeTransactionsTo2D(transactions, users, false) },
    { op: 'write', range: `'${GOOGLE_SHEET_TABS.SPLIT_PAYMENT_DB.title}'!A1`, data: serializeSplitsTo2D(transactions, false) },
    { op: 'write', range: `'${GOOGLE_SHEET_TABS.USER_CM_MASTER.title}'!A1`, data: serializeUsersTo2D(users) },
  ];
}

// 4. 08_분할결제_상세행_DB 직렬화
export const SPLIT_DB_SHEET_HEADERS = [
  '분할행ID',
  '거래ID',
  '분할순번',
  '고객이름',
  '상태(6단계)',
  '요청일자',
  '승인일자',
  'CM이름',
  'CM사번',
  '고정카드사',
  '카드사컬러코드',
  '결제방법',
  '구분',
  '분할결제금액(원)',
  '할부개월(일시불1달)',
  '캐시백율(%)',
  '캐시백금액(원)',
  '할부금리(%)',
  'AG수수료율(%)',
  'AG수수료금액(원)',
  'CM수수료율(%)',
  'CM수수료금액(원)',
  '별도조건메모',
];

export function serializeSplitsTo2D(
  transactions: Transaction[],
  hideAgColumnsForCm = false
): (string | number)[][] {
  const headers = hideAgColumnsForCm
    ? SPLIT_DB_SHEET_HEADERS.filter((h) => h !== 'AG수수료율(%)' && h !== 'AG수수료금액(원)')
    : SPLIT_DB_SHEET_HEADERS;

  const rows: (string | number)[][] = [];
  transactions.forEach((tx) => {
    const splits = tx.paymentSplits || [];
    splits.forEach((s, idx) => {
      const isLump = s.paymentMethod === '일시불';
      const cbAmt = isLump ? Math.round((s.amount * (s.cashbackRate || 0)) / 100) : 0;
      const agRate = s.agCommissionRate ?? 0;
      const cmRate = s.cmCommissionRate ?? 0;
      const agAmt = Math.round((s.amount * agRate) / 100);
      const cmAmt = Math.round((s.amount * cmRate) / 100);

      const row: (string | number)[] = [
        s.id,
        tx.id,
        `결제 #${idx + 1}`,
        tx.customerName,
        APPROVAL_STATUS_META[tx.status]?.label || tx.status,
        tx.requestDate,
        tx.approvalDate || '',
        tx.cmProfile?.name || '',
        tx.cmProfile?.employeeId || '',
        s.cardCompany,
        CARD_COMPANY_COLORS[s.cardCompany]?.mainHex || '#172a88',
        s.paymentMethod,
        s.rateCategory || '일반',
        s.amount,
        s.installmentMonths || (isLump ? '1달' : '24개월'),
        s.cashbackRate || 0,
        cbAmt,
        s.interestRate || 0,
      ];

      if (!hideAgColumnsForCm) {
        row.push(agRate, agAmt);
      }

      row.push(cmRate, cmAmt, s.customConditionNote || '');
      rows.push(row);
    });
  });

  return [headers, ...rows];
}

// 5. 09_사용자_CM_마스터 헤더 및 직렬화/역직렬화
export const USER_CM_SHEET_HEADERS = [
  '사용자ID',
  '구분(ROLE)',
  '이름',
  '로그인ID',
  '비밀번호',
  '소속/대리점',
  '연락처',
  '사업자등록번호',
  '주민등록번호',
  '사번',
  '활성상태',
  '생성일시',
  // 새 열은 항상 맨 뒤에 추가 (기존 시트 열 위치 유지)
  '사업자여부',
  '계좌은행',
  '계좌번호',
];

export function serializeUsersTo2D(users: User[]): (string | number)[][] {
  const body = users.map((u) => [
    u.id,
    u.role,
    u.name,
    u.loginId,
    u.password,
    u.affiliation || '',
    u.phone || '',
    u.businessNumber || '',
    u.rrn || '',
    u.employeeId || '',
    u.isActive ? 'Y' : 'N',
    u.createdAt || nowFormatted(),
    u.isBusiness === undefined ? '' : u.isBusiness ? 'Y' : 'N',
    u.bankName || '',
    u.bankAccount || '',
  ]);
  return [USER_CM_SHEET_HEADERS, ...body];
}

export function parseUsersFrom2D(rows: (string | number)[][]): User[] {
  if (!rows || rows.length <= 1) return [];
  const result: User[] = [];
  const body = rows.slice(1);
  for (const r of body) {
    const id = String(r[0] || '').trim();
    const roleRaw = String(r[1] || '').trim().toUpperCase();
    const name = String(r[2] || '').trim();
    const loginId = String(r[3] || '').trim();
    if (!id || !name || !loginId) continue;
    const role = (roleRaw === 'ADMIN' ? 'ADMIN' : roleRaw === 'AG' ? 'AG' : 'CM') as User['role'];
    const password = String(r[4] || '').trim();
    const affiliation = String(r[5] || '').trim();
    const phone = String(r[6] || '').trim();
    const businessNumber = String(r[7] || '').trim() || undefined;
    const rrn = String(r[8] || '').trim() || undefined;
    const employeeId = String(r[9] || '').trim() || undefined;
    const activeStr = String(r[10] || '').trim().toUpperCase();
    const isActive = activeStr !== 'N' && activeStr !== 'FALSE' && activeStr !== '0';
    const createdAt = String(r[11] || '').trim() || nowFormatted();
    const bizFlag = String(r[12] ?? '').trim().toUpperCase();
    // 사업자여부 칸이 비어 있으면 사업자번호 유무로 추정
    const isBusiness = bizFlag ? bizFlag === 'Y' : businessNumber ? true : rrn ? false : undefined;
    const bankName = String(r[13] ?? '').trim() || undefined;
    const bankAccount = String(r[14] ?? '').trim() || undefined;

    result.push({
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
      isBusiness,
      bankName,
      bankAccount,
      isActive,
      createdAt,
    });
  }
  return result;
}

