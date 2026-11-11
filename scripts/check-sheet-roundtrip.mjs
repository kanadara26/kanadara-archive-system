// 07 탭 직렬화 ↔ 복원 왕복 검사. 실행: node scripts/check-sheet-roundtrip.mjs
import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({
  server: { middlewareMode: true },
  optimizeDeps: { noDiscovery: true, include: [] },
  logLevel: 'error',
});
try {
  const cfg = await server.ssrLoadModule('/src/constants/googleSheetConfig.ts');
  const tx = {
    id: 'tx-1', cmId: 'cm-1', agId: 'ag-1', customerName: '홍길동\t탭\n줄바꿈',
    requestDate: '2026-11-11', approvalDate: '', amount: 1000000, status: 'REQUESTED',
    cmProfile: { name: 'CM' }, paymentSplits: [], conditionSnapshot: {}, sheetSync: { status: 'PENDING' },
    history: [{ at: 'x', note: '"따옴표"' }], cardApplication: {},
  };

  // 1) 쓰기 → 시트 표시값(문자열) → 복원 시 원본과 동일
  const rows = cfg.serializeTransactionsTo2D([tx], [], false).map((r) => r.map(String));
  const back = cfg.parseTransactionsFrom2D(rows);
  assert.equal(back.legacyRowCount, 0);
  assert.deepEqual(back.transactions, [tx]);

  // 2) JSON 열 없는 구형 행 → 복원 불가로 감지 (자동 저장 중지 근거)
  const legacy = cfg.parseTransactionsFrom2D([['거래ID', '고객이름'], ['tx-old', '김철수']]);
  assert.equal(legacy.legacyRowCount, 1);

  // 3) CM용 출력에는 원본 JSON(AG 정보 포함)이 섞이지 않음
  const cmRows = cfg.serializeTransactionsTo2D([tx], [], true);
  assert.ok(!cmRows[0].includes(cfg.TX_RAW_JSON_HEADER));

  // 4) 빈 시트 → 0건, 오류 없음
  assert.equal(cfg.parseTransactionsFrom2D([]).transactions.length, 0);

  // 5) 셀 안 줄바꿈: 시트 1행은 웹앱에서도 1건 (예전엔 줄마다 가짜 프로모션이 생겼음)
  const promoRow = ['promo-1', '신한', '#0046ff', '11월 프로모션', '2026-11-01', '계속 진행', '통합', '30000000', '', '3,000만원 이상',
    '0', '0', '0.15', '0.1', '0', '0', '• 대상:\n• 기준:\n• 유의사항:', 'FALSE', '2026-11-11 10:00'];
  const promos = cfg.parsePromotionsFrom2D([cfg.PROMOTION_SHEET_HEADERS, promoRow]).promotions;
  assert.equal(promos.length, 1);
  assert.equal(promos[0].promotionConditionText, '• 대상:\n• 기준:\n• 유의사항:');
  assert.equal(promos[0].isActive, false, '줄바꿈 뒤 열(사용여부)도 제자리');
  assert.equal(promos[0].updatedAt, '2026-11-11 10:00');
  // 웹앱이 쓴 06 탭을 다시 읽어도 그대로
  const again = cfg.parsePromotionsFrom2D(cfg.serializePromotionsTo2D(promos).map((r) => r.map(String))).promotions;
  assert.deepEqual(again, promos);
  const rateRows = cfg.parseRateTableFrom2D([cfg.RATE_TABLE_SHEET_HEADERS,
    ['rt-1', '신한', '#0046ff', '일시불', '일반', '2,000만원 이상', '1달', '1.9', '0', '0.85', '0.5', '2026-11-01', '비고 1줄\n비고 2줄']]).rows;
  assert.equal(rateRows.length, 1);

  console.log('OK: sheet round-trip checks passed');
} finally {
  await server.close();
}
