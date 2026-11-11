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

  console.log('OK: sheet round-trip checks passed');
} finally {
  await server.close();
}
