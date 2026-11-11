/**
 * ============================================================================
 * 카나다라 (KANADARA) 오토캐시백 통합 마스터 구글 시트 전용 Google Apps Script (Code.gs)
 * ============================================================================
 * 대상 스프레드시트: 카나다라_오토캐시백_요율표_거래내역_통합마스터_2026
 * 입력 콘솔 시트명 : 00_조건_요율_프로모션_등록 (#gid=1057963902)
 *
 * [버튼(도형)에 연결할 스크립트 함수명 안내]
 * 1) [SECTION 1] 05_요율표_마스터 관련 버튼
 *    - 요율표 등록/수정 실행 버튼 : registerRateRow
 *    - 최근 요율 복사 불러오기    : loadLatestRateToForm
 *    - 요율 입력폼 초기화         : clearRateForm
 *
 * 2) [SECTION 2] 06_카드사별_프로모션_마스터 관련 버튼 (±% 마이너스 요율 반영 지원)
 *    - 프로모션 등록/수정 실행 버튼 : registerPromotionRow
 *    - 최근 프로모션 복사 불러오기  : loadLatestPromotionToForm
 *    - 프로모션 입력폼 초기화       : clearPromotionForm
 *
 * 3) [SECTION 3] 01_거래조건_마스터 관련 버튼 (새 실행일 기준 이전 버전 종료일 자동 마감)
 *    - 거래조건 등록/수정 실행 버튼 : registerDealConditionRow
 *    - 최근 거래조건 복사 불러오기  : loadLatestConditionToForm
 *    - 거래조건 입력폼 초기화       : clearConditionForm
 * ============================================================================
 */

var SHEET_NAMES = {
  CONSOLE: '00_조건_요율_프로모션_등록',
  CONDITION_MASTER: '01_거래조건_마스터',
  AUDIT_LOG: '04_동기화_감사로그',
  RATE_MASTER: '05_요율표_마스터',
  PROMO_MASTER: '06_카드사별_프로모션_마스터',
};

// 카드사별 메인 브랜드 컬러 및 배지 텍스트 컬러 정의
var CARD_BRAND_COLORS = {
  '국민': { bg: '#faba07', fg: '#1e293b' },
  '농협': { bg: '#1fb25a', fg: '#ffffff' },
  '롯데': { bg: '#e70012', fg: '#ffffff' },
  '신한': { bg: '#0046ff', fg: '#ffffff' },
  '우리': { bg: '#0c73b8', fg: '#ffffff' },
  '하나': { bg: '#009591', fg: '#ffffff' },
  '제휴카드사(삼성)': { bg: '#172a88', fg: '#ffffff' },
};

/**
 * 시트 열기 시 상단 메뉴바에 [🚀 카나다라 마스터 등록] 커스텀 메뉴 자동 생성
 */
function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('🚀 카나다라 마스터 등록')
    .addItem('🟢 [1] 요율표 마스터 등록/수정 (registerRateRow)', 'registerRateRow')
    .addItem('🔄 [1-복사] 최근 요율 불러와 수정하기 (loadLatestRateToForm)', 'loadLatestRateToForm')
    .addItem('🧹 [1-초기화] 요율 입력폼 비우기 (clearRateForm)', 'clearRateForm')
    .addSeparator()
    .addItem('🟣 [2] 카드사 프로모션 등록/수정 (registerPromotionRow)', 'registerPromotionRow')
    .addItem('🔄 [2-복사] 최근 프로모션 불러와 수정하기 (loadLatestPromotionToForm)', 'loadLatestPromotionToForm')
    .addItem('🧹 [2-초기화] 프로모션 입력폼 비우기 (clearPromotionForm)', 'clearPromotionForm')
    .addSeparator()
    .addItem('🔵 [3] 거래조건 버전 등록/수정 (registerDealConditionRow)', 'registerDealConditionRow')
    .addItem('🔄 [3-복사] 최근 거래조건 불러와 수정하기 (loadLatestConditionToForm)', 'loadLatestConditionToForm')
    .addItem('🧹 [3-초기화] 거래조건 입력폼 비우기 (clearConditionForm)', 'clearConditionForm')
    .addToUi();
}

/**
 * ============================================================================
 * [SECTION 1] 05_요율표_마스터 원클릭 등록/수정 (입력셀: C6:C18, 1-5 구분 포함)
 * ============================================================================
 */
function registerRateRow() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var consoleSheet = ss.getSheetByName(SHEET_NAMES.CONSOLE);
  var rateSheet = ss.getSheetByName(SHEET_NAMES.RATE_MASTER);

  if (!consoleSheet || !rateSheet) {
    SpreadsheetApp.getUi().alert('오류: [00_조건_요율_프로모션_등록] 또는 [05_요율표_마스터] 시트를 찾을 수 없습니다.');
    return;
  }

  var actor = String(consoleSheet.getRange('C3').getValue() || 'ADMIN').trim();
  var vals = consoleSheet.getRange('C6:C18').getValues().map(function(r) { return r[0]; });

  var rawId = String(vals[0] || '').trim();
  var cardCompany = String(vals[1] || '').trim() || '제휴카드사(삼성)';
  var paymentMethod = String(vals[3] || '').trim() || '일시불';
  var category = String(vals[4] || '').trim() || '일반';
  var amountTier = String(vals[5] || '').trim() || '2,000만원 이상';
  var rawMonths = String(vals[6] || '').trim() || '24 / 36 / 48개월';
  var rawCashback = parseFloat(vals[7]) || 0;
  var rawInterest = parseFloat(vals[8]) || 0;
  var agRate = parseFloat(vals[9]) || 0;
  var cmRate = parseFloat(vals[10]) || 0;
  var effectiveDate = formatDateStr_(vals[11]) || formatDateStr_(new Date());
  var remark = String(vals[12] || '').trim();

  // 결제방법 규칙 자동 보정 (일시불 -> 1달 & 금리 0% / 할부·다이렉트할부 -> 캐시백 0%)
  var isLumpSum = (paymentMethod === '일시불');
  var installmentMonths = isLumpSum ? '1달' : rawMonths;
  var cashbackRate = isLumpSum ? Number(rawCashback.toFixed(2)) : 0;
  var interestRate = isLumpSum ? 0 : Number(rawInterest.toFixed(2));

  var colorMeta = CARD_BRAND_COLORS[cardCompany] || CARD_BRAND_COLORS['제휴카드사(삼성)'];

  var lastRow = rateSheet.getLastRow();
  var existingRowIndex = -1;

  if (rawId && lastRow >= 2) {
    var ids = rateSheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (String(ids[i][0]).trim() === rawId) {
        existingRowIndex = i + 2;
        break;
      }
    }
  }

  var finalId = rawId || ('rt-row-' + Math.max(1, lastRow));
  if (!rawId && existingRowIndex === -1) {
    finalId = 'rt-row-' + lastRow + '-' + Utilities.formatDate(new Date(), 'Asia/Seoul', 'HHmmss');
  }

  var rowData = [
    finalId,
    cardCompany,
    colorMeta.bg,
    paymentMethod,
    category,
    amountTier,
    installmentMonths,
    cashbackRate,
    interestRate,
    Number(agRate.toFixed(2)),
    Number(cmRate.toFixed(2)),
    effectiveDate,
    remark,
  ];

  var targetRow = existingRowIndex > 0 ? existingRowIndex : (lastRow + 1);
  rateSheet.getRange(targetRow, 1, 1, rowData.length).setValues([rowData]);

  // 카드사 및 컬러코드 셀(B~C열)에 브랜드 메인 컬러 서식 즉시 입히기
  rateSheet.getRange(targetRow, 2, 1, 2)
    .setBackground(colorMeta.bg)
    .setFontColor(colorMeta.fg)
    .setFontWeight('bold');

  var actionLabel = existingRowIndex > 0 ? '수정(Update)' : '신규등록(Insert)';
  var statusMsg = '[' + nowStr_() + '] 05_요율표 ' + actionLabel + ' 완료: ' + finalId + ' (' + cardCompany + ' · ' + paymentMethod + ' · ' + category + ')';
  consoleSheet.getRange('E3').setValue(statusMsg);

  appendAuditLog_(
    ss,
    actor,
    'GAS [00_등록콘솔] → 05_요율표_마스터 ' + actionLabel,
    existingRowIndex > 0 ? 0 : 1,
    existingRowIndex > 0 ? 1 : 0,
    finalId + ' | ' + cardCompany + '(' + colorMeta.bg + ') | ' + paymentMethod + ' [' + category + '] | ' + amountTier + ' | 캐시백 ' + cashbackRate + '% / 금리 ' + interestRate + '% / AG ' + agRate + '% / CM ' + cmRate + '%'
  );

  ss.toast(statusMsg, '✅ 05_요율표_마스터 반영 완료', 5);
}

/**
 * [05_요율표_마스터]의 가장 마지막 행(또는 C6에 입력한 ID 행)을 폼에 불러와 복사·수정하기
 */
function loadLatestRateToForm() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var consoleSheet = ss.getSheetByName(SHEET_NAMES.CONSOLE);
  var rateSheet = ss.getSheetByName(SHEET_NAMES.RATE_MASTER);
  var lastRow = rateSheet.getLastRow();
  if (lastRow < 2) {
    ss.toast('불러올 요율표 데이터가 없습니다.', '안내', 4);
    return;
  }

  var targetId = String(consoleSheet.getRange('C6').getValue() || '').trim();
  var rowToLoad = lastRow;

  if (targetId) {
    var ids = rateSheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (String(ids[i][0]).trim() === targetId) {
        rowToLoad = i + 2;
        break;
      }
    }
  }

  var data = rateSheet.getRange(rowToLoad, 1, 1, 13).getValues()[0];
  // 복사 후 신규 등록이 쉽도록 ID 칸(C6)은 비워두고 나머지 값만 채움
  consoleSheet.getRange('C6').setValue('');
  consoleSheet.getRange('C7').setValue(data[1]);
  consoleSheet.getRange('C9').setValue(data[3]);
  consoleSheet.getRange('C10').setValue(data[4] || '일반');
  consoleSheet.getRange('C11').setValue(data[5]);
  consoleSheet.getRange('C12').setValue(data[6]);
  consoleSheet.getRange('C13').setValue(data[7]);
  consoleSheet.getRange('C14').setValue(data[8]);
  consoleSheet.getRange('C15').setValue(data[9]);
  consoleSheet.getRange('C16').setValue(data[10]);
  consoleSheet.getRange('C17').setValue(formatDateStr_(data[11]));
  consoleSheet.getRange('C18').setValue(data[12] + ' (복사수정)');

  consoleSheet.getRange('E3').setValue('[' + nowStr_() + '] 요율표(' + data[0] + ') 데이터를 복사해 입력폼에 불러왔습니다.');
  ss.toast('필요한 항목만 수정한 뒤 [요율표 등록/수정 실행] 버튼을 누르면 신규 행으로 등록됩니다.', '🔄 요율 데이터 복사 불러오기 완료', 5);
}

function clearRateForm() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var consoleSheet = ss.getSheetByName(SHEET_NAMES.CONSOLE);
  consoleSheet.getRange('C6').setValue('');
  consoleSheet.getRange('C7').setValue('제휴카드사(삼성)');
  consoleSheet.getRange('C9').setValue('일시불');
  consoleSheet.getRange('C10').setValue('일반');
  consoleSheet.getRange('C11').setValue('2,000만원 이상');
  consoleSheet.getRange('C12').setValue('1달');
  consoleSheet.getRange('C13').setValue(1.9);
  consoleSheet.getRange('C14').setValue(0);
  consoleSheet.getRange('C15').setValue(0.85);
  consoleSheet.getRange('C16').setValue(0.5);
  consoleSheet.getRange('C17').setValue(formatDateStr_(new Date()));
  consoleSheet.getRange('C18').setValue('');
  ss.toast('요율표 입력폼이 기본값으로 초기화되었습니다.', '🧹 초기화 완료', 3);
}

/**
 * ============================================================================
 * [SECTION 2] 06_카드사별_프로모션_마스터 원클릭 등록/수정 (입력셀: C21:C38)
 *  - 캐시백/금리/AG/CM 요율에 +% 인센티브뿐 아니라 -% 마이너스 반영 완벽 지원!
 * ============================================================================
 */
function registerPromotionRow() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var consoleSheet = ss.getSheetByName(SHEET_NAMES.CONSOLE);
  var promoSheet = ss.getSheetByName(SHEET_NAMES.PROMO_MASTER);

  if (!consoleSheet || !promoSheet) {
    SpreadsheetApp.getUi().alert('오류: [00_조건_요율_프로모션_등록] 또는 [06_카드사별_프로모션_마스터] 시트를 찾을 수 없습니다.');
    return;
  }

  var actor = String(consoleSheet.getRange('C3').getValue() || 'ADMIN').trim();
  var vals = consoleSheet.getRange('C21:C38').getValues().map(function(r) { return r[0]; });

  var rawId = String(vals[0] || '').trim();
  var cardCompany = String(vals[1] || '').trim() || '제휴카드사(삼성)';
  var title = String(vals[3] || '').trim();
  if (!title) {
    SpreadsheetApp.getUi().alert('프로모션명(C24 셀)을 입력해 주세요.');
    return;
  }

  var startDate = formatDateStr_(vals[4]) || formatDateStr_(new Date());
  var rawEndDate = String(vals[5] || '').trim();
  var endDate = (!rawEndDate || rawEndDate === '계속 진행' || rawEndDate === '-') ? '계속 진행' : formatDateStr_(vals[5]);
  var paymentMethod = String(vals[6] || '').trim() || '통합';
  var minAmount = Math.round(Number(vals[7]) || 0);
  var maxAmount = (vals[8] === '' || vals[8] === null) ? '' : Math.round(Number(vals[8]));
  var amountConditionLabel = String(vals[9] || '').trim();
  if (!amountConditionLabel) {
    amountConditionLabel = Math.round(minAmount / 10000).toLocaleString() + '만원 이상' +
      (maxAmount ? (' ~ ' + Math.round(Number(maxAmount) / 10000).toLocaleString() + '만원 미만') : ' (제한없음)');
  }

  // ±% 마이너스 요율 반영 지원 (음수/양수 그대로 보존)
  var cashbackRateDelta = Number((parseFloat(vals[10]) || 0).toFixed(2));
  var interestRateDelta = Number((parseFloat(vals[11]) || 0).toFixed(2));
  var agIncentiveRate = Number((parseFloat(vals[12]) || 0).toFixed(2));
  var cmIncentiveRate = Number((parseFloat(vals[13]) || 0).toFixed(2));
  var agIncentiveAmount = Math.round(Number(vals[14]) || 0);
  var cmIncentiveAmount = Math.round(Number(vals[15]) || 0);
  var promotionConditionText = String(vals[16] || '• 프로모션 세부 조건').trim();
  var isActive = String(vals[17] || 'TRUE').trim().toUpperCase() !== 'FALSE' ? 'TRUE' : 'FALSE';
  var updatedAt = nowStr_();

  var colorMeta = CARD_BRAND_COLORS[cardCompany] || CARD_BRAND_COLORS['제휴카드사(삼성)'];

  var lastRow = promoSheet.getLastRow();
  var existingRowIndex = -1;

  if (rawId && lastRow >= 2) {
    var ids = promoSheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (String(ids[i][0]).trim() === rawId) {
        existingRowIndex = i + 2;
        break;
      }
    }
  }

  var finalId = rawId || ('promo-' + lastRow + '-' + Utilities.formatDate(new Date(), 'Asia/Seoul', 'HHmmss'));

  var rowData = [
    finalId,
    cardCompany,
    colorMeta.bg,
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
  ];

  var targetRow = existingRowIndex > 0 ? existingRowIndex : (lastRow + 1);
  promoSheet.getRange(targetRow, 1, 1, rowData.length).setValues([rowData]);

  // 카드사 및 컬러코드 셀(B~C열)에 브랜드 메인 컬러 서식 입히기
  promoSheet.getRange(targetRow, 2, 1, 2)
    .setBackground(colorMeta.bg)
    .setFontColor(colorMeta.fg)
    .setFontWeight('bold');

  // 마이너스(-%) 요율 셀 시각적 강조 (음수일 때 붉은 글씨 강조)
  var rateCols = [11, 12, 13, 14]; // K, L, M, N열
  var rateVals = [cashbackRateDelta, interestRateDelta, agIncentiveRate, cmIncentiveRate];
  for (var idx = 0; idx < rateCols.length; idx++) {
    var cell = promoSheet.getRange(targetRow, rateCols[idx]);
    if (rateVals[idx] < 0) {
      cell.setFontColor('#dc2626').setFontWeight('bold');
    } else if (rateVals[idx] > 0) {
      cell.setFontColor('#047857').setFontWeight('bold');
    }
  }

  var actionLabel = existingRowIndex > 0 ? '수정(Update)' : '신규등록(Insert)';
  var statusMsg = '[' + updatedAt + '] 06_프로모션 ' + actionLabel + ' 완료: ' + finalId + ' (' + cardCompany + ' / AG ' + formatSigned_(agIncentiveRate) + '% · CM ' + formatSigned_(cmIncentiveRate) + '%)';
  consoleSheet.getRange('E3').setValue(statusMsg);

  appendAuditLog_(
    ss,
    actor,
    'GAS [00_등록콘솔] → 06_카드사별_프로모션_마스터 ' + actionLabel,
    existingRowIndex > 0 ? 0 : 1,
    existingRowIndex > 0 ? 1 : 0,
    finalId + ' | [' + cardCompany + '] ' + title + ' | 캐시백 ' + formatSigned_(cashbackRateDelta) + '% · 금리 ' + formatSigned_(interestRateDelta) + '% · AG ' + formatSigned_(agIncentiveRate) + '% · CM ' + formatSigned_(cmIncentiveRate) + '%'
  );

  ss.toast(statusMsg, '✅ 06_카드사별_프로모션_마스터 반영 완료', 5);
}

function loadLatestPromotionToForm() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var consoleSheet = ss.getSheetByName(SHEET_NAMES.CONSOLE);
  var promoSheet = ss.getSheetByName(SHEET_NAMES.PROMO_MASTER);
  var lastRow = promoSheet.getLastRow();
  if (lastRow < 2) {
    ss.toast('불러올 프로모션 데이터가 없습니다.', '안내', 4);
    return;
  }

  var targetId = String(consoleSheet.getRange('C21').getValue() || '').trim();
  var rowToLoad = lastRow;

  if (targetId) {
    var ids = promoSheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (String(ids[i][0]).trim() === targetId) {
        rowToLoad = i + 2;
        break;
      }
    }
  }

  var data = promoSheet.getRange(rowToLoad, 1, 1, 19).getValues()[0];
  consoleSheet.getRange('C21').setValue('');
  consoleSheet.getRange('C22').setValue(data[1]);
  consoleSheet.getRange('C24').setValue(data[3] + ' (복사본)');
  consoleSheet.getRange('C25').setValue(formatDateStr_(data[4]));
  consoleSheet.getRange('C26').setValue(data[5] || '계속 진행');
  consoleSheet.getRange('C27').setValue(data[6]);
  consoleSheet.getRange('C28').setValue(data[7]);
  consoleSheet.getRange('C29').setValue(data[8]);
  consoleSheet.getRange('C30').setValue(data[9]);
  consoleSheet.getRange('C31').setValue(data[10]);
  consoleSheet.getRange('C32').setValue(data[11]);
  consoleSheet.getRange('C33').setValue(data[12]);
  consoleSheet.getRange('C34').setValue(data[13]);
  consoleSheet.getRange('C35').setValue(data[14]);
  consoleSheet.getRange('C36').setValue(data[15]);
  consoleSheet.getRange('C37').setValue(data[16]);
  consoleSheet.getRange('C38').setValue(data[17]);

  consoleSheet.getRange('E3').setValue('[' + nowStr_() + '] 프로모션(' + data[0] + ')을 복사해 입력폼에 불러왔습니다.');
  ss.toast('필요한 항목(±% 요율 등)만 수정한 뒤 [프로모션 등록/수정 실행]을 클릭하세요.', '🔄 프로모션 복사 불러오기 완료', 5);
}

function clearPromotionForm() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var consoleSheet = ss.getSheetByName(SHEET_NAMES.CONSOLE);
  consoleSheet.getRange('C21').setValue('');
  consoleSheet.getRange('C22').setValue('제휴카드사(삼성)');
  consoleSheet.getRange('C24').setValue('');
  consoleSheet.getRange('C25').setValue(formatDateStr_(new Date()));
  consoleSheet.getRange('C26').setValue('계속 진행');
  consoleSheet.getRange('C27').setValue('통합');
  consoleSheet.getRange('C28').setValue(30000000);
  consoleSheet.getRange('C29').setValue('');
  consoleSheet.getRange('C30').setValue('3,000만원 이상');
  consoleSheet.getRange('C31').setValue(0);
  consoleSheet.getRange('C32').setValue(0);
  consoleSheet.getRange('C33').setValue(0.15);
  consoleSheet.getRange('C34').setValue(0.1);
  consoleSheet.getRange('C35').setValue(0);
  consoleSheet.getRange('C36').setValue(0);
  consoleSheet.getRange('C37').setValue('• 프로모션 대상:\n• 요율 가감(±%) 기준:\n• 유의사항:');
  consoleSheet.getRange('C38').setValue('TRUE');
  ss.toast('프로모션 입력폼이 초기화되었습니다.', '🧹 초기화 완료', 3);
}

/**
 * ============================================================================
 * [SECTION 3] 01_거래조건_마스터 원클릭 등록/버전 갱신 (입력셀: C41:C57)
 *  - 동일 조건그룹코드(B열)의 직전 버전 행 종료일자(Q열)를 (새 실행일자 - 1일)로 자동 마감!
 * ============================================================================
 */
function registerDealConditionRow() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var consoleSheet = ss.getSheetByName(SHEET_NAMES.CONSOLE);
  var condSheet = ss.getSheetByName(SHEET_NAMES.CONDITION_MASTER);

  if (!consoleSheet || !condSheet) {
    SpreadsheetApp.getUi().alert('오류: [00_조건_요율_프로모션_등록] 또는 [01_거래조건_마스터] 시트를 찾을 수 없습니다.');
    return;
  }

  var actor = String(consoleSheet.getRange('C3').getValue() || 'ADMIN').trim();
  var vals = consoleSheet.getRange('C41:C57').getValues().map(function(r) { return r[0]; });

  var rawRowId = String(vals[0] || '').trim();
  var groupCode = String(vals[1] || '').trim();
  if (!groupCode) {
    SpreadsheetApp.getUi().alert('조건그룹코드(C42 셀, 예: SH-ONE-2000)를 입력해 주세요.');
    return;
  }

  var rawVersion = vals[2];
  var effectiveFrom = formatDateStr_(vals[3]) || formatDateStr_(new Date());
  var cardCompany = String(vals[4] || '').trim() || '신한카드';
  var paymentMethod = String(vals[5] || '').trim() || '일시불 오토캐시백';
  var channelType = String(vals[6] || '').trim() || 'AG다이렉트';
  var cardKind = String(vals[7] || '').trim() || '개인 신용';
  var minAmount = Math.round(Number(vals[8]) || 0);
  var maxAmount = (vals[9] === '' || vals[9] === null) ? 100000000 : Math.round(Number(vals[9]));
  var downPaymentRule = String(vals[10] || '').trim() || '선수금 제한 없음';
  var installmentTerms = String(vals[11] || '').trim() || '일시불';
  var title = String(vals[12] || '').trim();
  if (!title) {
    SpreadsheetApp.getUi().alert('표준조건명(C53 셀)을 입력해 주세요.');
    return;
  }
  var customerCashbackRate = Number((parseFloat(vals[13]) || 0).toFixed(2));
  var cmCommissionRate = Number((parseFloat(vals[14]) || 0).toFixed(2));
  var description = String(vals[15] || '').trim();
  var isActive = String(vals[16] || 'TRUE').trim().toUpperCase() !== 'FALSE' ? 'TRUE' : 'FALSE';

  var lastRow = condSheet.getLastRow();
  var maxVersionInGroup = 0;
  var prevVersionRowIndex = -1;
  var prevVersionDate = '';

  if (lastRow >= 2) {
    var allData = condSheet.getRange(2, 1, lastRow - 1, 20).getValues();
    for (var i = 0; i < allData.length; i++) {
      var rGroup = String(allData[i][1]).trim();
      var rVer = parseInt(allData[i][2], 10) || 0;
      var rEffFrom = formatDateStr_(allData[i][3]);
      if (rGroup === groupCode) {
        if (rVer > maxVersionInGroup) {
          maxVersionInGroup = rVer;
        }
        if (rEffFrom < effectiveFrom && rEffFrom >= prevVersionDate) {
          prevVersionDate = rEffFrom;
          prevVersionRowIndex = i + 2;
        }
      }
    }
  }

  var versionNo = (rawVersion !== '' && rawVersion !== null) ? parseInt(rawVersion, 10) : (maxVersionInGroup + 1);
  var finalRowId = rawRowId || ('COND-ROW-' + String(lastRow).padStart(3, '0'));

  // 직전 버전의 자동종료일자(Q열, 17번째 열)를 (새 실행일자 - 1일)로 자동 업데이트!
  var autoClosedCount = 0;
  if (prevVersionRowIndex > 0) {
    var prevEndDate = subtractOneDay_(effectiveFrom);
    condSheet.getRange(prevVersionRowIndex, 17).setValue(prevEndDate);
    autoClosedCount = 1;
  }

  var todayStr = formatDateStr_(new Date());
  var lifecycleLabel = (effectiveFrom > todayStr) ? '실행예정(이전조건유지)' : '현재적용중';

  var newRowData = [
    finalRowId,
    groupCode,
    versionNo,
    effectiveFrom,
    cardCompany,
    paymentMethod,
    channelType,
    cardKind,
    minAmount,
    maxAmount,
    downPaymentRule,
    installmentTerms,
    title,
    customerCashbackRate,
    cmCommissionRate,
    description,
    '', // 자동종료일자 (신규 최신 버전은 공란 = 상시 유지)
    lifecycleLabel,
    '정상',
    isActive,
  ];

  var targetRow = lastRow + 1;
  condSheet.getRange(targetRow, 1, 1, newRowData.length).setValues([newRowData]);

  var statusMsg = '[' + nowStr_() + '] 01_거래조건 등록 완료: ' + finalRowId + ' (' + groupCode + ' v' + versionNo + ', 실행일 ' + effectiveFrom + (autoClosedCount ? ', 직전버전 종료일 자동마감' : '') + ')';
  consoleSheet.getRange('E3').setValue(statusMsg);

  appendAuditLog_(
    ss,
    actor,
    'GAS [00_등록콘솔] → 01_거래조건_마스터 버전 등록',
    1,
    autoClosedCount,
    finalRowId + ' | ' + groupCode + ' v' + versionNo + ' (' + effectiveFrom + ' 실행) | ' + title + ' | 캐시백 ' + customerCashbackRate + '% / CM ' + cmCommissionRate + '%'
  );

  ss.toast(statusMsg, '✅ 01_거래조건_마스터 반영 완료', 5);
}

function loadLatestConditionToForm() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var consoleSheet = ss.getSheetByName(SHEET_NAMES.CONSOLE);
  var condSheet = ss.getSheetByName(SHEET_NAMES.CONDITION_MASTER);
  var lastRow = condSheet.getLastRow();
  if (lastRow < 2) {
    ss.toast('불러올 거래조건 데이터가 없습니다.', '안내', 4);
    return;
  }

  var data = condSheet.getRange(lastRow, 1, 1, 20).getValues()[0];
  consoleSheet.getRange('C41').setValue('');
  consoleSheet.getRange('C42').setValue(data[1]);
  consoleSheet.getRange('C43').setValue(''); // 자동 MAX+1 채번 유도
  consoleSheet.getRange('C44').setValue(formatDateStr_(data[3]));
  consoleSheet.getRange('C45').setValue(data[4]);
  consoleSheet.getRange('C46').setValue(data[5]);
  consoleSheet.getRange('C47').setValue(data[6]);
  consoleSheet.getRange('C48').setValue(data[7]);
  consoleSheet.getRange('C49').setValue(data[8]);
  consoleSheet.getRange('C50').setValue(data[9]);
  consoleSheet.getRange('C51').setValue(data[10]);
  consoleSheet.getRange('C52').setValue(data[11]);
  consoleSheet.getRange('C53').setValue(data[12]);
  consoleSheet.getRange('C54').setValue(data[13]);
  consoleSheet.getRange('C55').setValue(data[14]);
  consoleSheet.getRange('C56').setValue(data[15]);
  consoleSheet.getRange('C57').setValue(data[19]);

  consoleSheet.getRange('E3').setValue('[' + nowStr_() + '] 거래조건(' + data[0] + ')을 복사해 입력폼에 불러왔습니다.');
  ss.toast('새 실행일자와 변경할 요율만 수정한 뒤 [거래조건 버전 등록 실행]을 클릭하세요.', '🔄 거래조건 복사 불러오기 완료', 5);
}

function clearConditionForm() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var consoleSheet = ss.getSheetByName(SHEET_NAMES.CONSOLE);
  consoleSheet.getRange('C41').setValue('');
  consoleSheet.getRange('C42').setValue('SH-ONE-2000');
  consoleSheet.getRange('C43').setValue('');
  consoleSheet.getRange('C44').setValue(formatDateStr_(new Date()));
  consoleSheet.getRange('C45').setValue('신한카드');
  consoleSheet.getRange('C46').setValue('일시불 오토캐시백');
  consoleSheet.getRange('C47').setValue('AG다이렉트');
  consoleSheet.getRange('C48').setValue('개인 신용');
  consoleSheet.getRange('C49').setValue(20000000);
  consoleSheet.getRange('C50').setValue(100000000);
  consoleSheet.getRange('C51').setValue('선수금 제한 없음');
  consoleSheet.getRange('C52').setValue('일시불');
  consoleSheet.getRange('C53').setValue('');
  consoleSheet.getRange('C54').setValue(1.85);
  consoleSheet.getRange('C55').setValue(0.5);
  consoleSheet.getRange('C56').setValue('');
  consoleSheet.getRange('C57').setValue('TRUE');
  ss.toast('거래조건 입력폼이 초기화되었습니다.', '🧹 초기화 완료', 3);
}

/**
 * ============================================================================
 * 내부 유틸리티 함수 (04_동기화_감사로그 자동 기록 및 날짜 포맷팅)
 * ============================================================================
 */
function appendAuditLog_(ss, actor, sourceLabel, addedCount, updatedCount, summary) {
  var logSheet = ss.getSheetByName(SHEET_NAMES.AUDIT_LOG);
  if (!logSheet) return;
  var nextRow = logSheet.getLastRow() + 1;
  var logId = 'GSYNC-' + Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyyMMdd-HHmmss');
  logSheet.getRange(nextRow, 1, 1, 7).setValues([[
    logId,
    nowStr_(),
    actor,
    sourceLabel,
    addedCount,
    updatedCount,
    summary,
  ]]);
}

function formatDateStr_(val) {
  if (!val) return '';
  if (Object.prototype.toString.call(val) === '[object Date]' && !isNaN(val.getTime())) {
    return Utilities.formatDate(val, 'Asia/Seoul', 'yyyy-MM-dd');
  }
  var s = String(val).trim();
  return s.slice(0, 10);
}

function subtractOneDay_(dateStr) {
  var parts = String(dateStr).split('-');
  if (parts.length !== 3) return dateStr;
  var dt = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  dt.setDate(dt.getDate() - 1);
  return Utilities.formatDate(dt, 'Asia/Seoul', 'yyyy-MM-dd');
}

function nowStr_() {
  return Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm');
}

function formatSigned_(num) {
  var n = Number(num) || 0;
  return (n > 0 ? '+' : '') + n;
}
