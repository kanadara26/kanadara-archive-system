// 로컬 디자인 검토용 가짜 구글 시트 (Apps Script Webhook.gs와 같은 응답 형식)
// 실제 시트·개인정보를 건드리지 않고 로그인·등록·정산 화면을 확인할 수 있음.
//   1) node scripts/fake-sheet.mjs        (http://127.0.0.1:8787, 데이터는 scripts/fake-sheet.local.json에 저장)
//   2) .env.local 에 GSHEETS_WEBHOOK_URL=http://127.0.0.1:8787 / GSHEETS_WEBHOOK_TOKEN=local-dev-token
//   3) npm run dev → admin / Admin#1234 또는 ag / Agent#1234 로 로그인
// 데이터를 처음 상태로 되돌리려면 scripts/fake-sheet.local.json 을 지우고 다시 실행.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const PORT = 8787;
const TOKEN = 'local-dev-token';
const dir = path.dirname(fileURLToPath(import.meta.url));
const DB = path.join(dir, 'fake-sheet.local.json');
const IMAGE_TAB = '10_요율표_이미지';

async function seed() {
  // 웹앱과 같은 직렬화 함수로 시트 형식의 초기 데이터를 만듦
  const out = path.join(dir, '.fake-sheet-config.local.mjs');
  await build({
    entryPoints: [path.join(dir, '../src/constants/googleSheetConfig.ts')],
    bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent',
  });
  const cfg = await import(pathToFileURL(out).href);
  fs.rmSync(out, { force: true });

  const user = (id, role, name, loginId, password, extra = {}) => ({
    id, role, name, loginId, password, affiliation: '테스트', phone: '010-0000-0000',
    rrn: '', businessNumber: '', employeeId: '', isActive: true, createdAt: '2026-01-01 09:00', ...extra,
  });
  const users = [
    user('usr-admin', 'ADMIN', '테스트 관리자', 'admin', 'Admin#1234'),
    user('usr-ag', 'AG', '테스트 AG', 'ag', 'Agent#1234'),
    user('usr-cm-1', 'CM', '김정상 (가상)', 'cm1', '', { rrn: '900101-1******', affiliation: '가상 대리점' }),
    user('usr-cm-2', 'CM', '이누락 (가상)', 'cm2', '', { affiliation: '정보 누락 예시' }),
  ];
  const rate = (id, cardCompany, paymentMethod, cashbackRate, interestRate, months) => ({
    id, cardCompany, paymentMethod, category: '일반', amountTier: '2,000만원 이상', installmentMonths: months,
    cashbackRate, interestRate, agCommissionRate: 0.85, cmCommissionRate: 0.5, effectiveDate: '2026-11-01', remark: '가상 요율',
  });
  const rates = [
    rate('rt-1', '제휴카드사(삼성)', '일시불', 1.9, 0, '1달'),
    rate('rt-2', '제휴카드사(삼성)', '할부', 0, 3.5, '36개월'),
  ];
  const t = cfg.GOOGLE_SHEET_TABS;
  return {
    [t.RATE_TABLE_MASTER.title]: cfg.serializeRateTableTo2D(rates),
    [t.PROMOTION_MASTER.title]: cfg.serializePromotionsTo2D([]),
    [t.TRANSACTION_MASTER.title]: cfg.serializeTransactionsTo2D([], users, false),
    [t.SPLIT_PAYMENT_DB.title]: cfg.serializeSplitsTo2D([], false),
    [t.USER_CM_MASTER.title]: cfg.serializeUsersTo2D(users),
    [IMAGE_TAB]: [['이미지ID', '제목', '카드사태그', '실행일자', '안내메모', '등록자', '등록일시', 'Drive파일ID', '파일형식', '외부URL']],
  };
}

const db = fs.existsSync(DB) ? JSON.parse(fs.readFileSync(DB, 'utf8')) : { tabs: await seed(), files: {} };
const save = () => fs.writeFileSync(DB, JSON.stringify(db));
save();

http.createServer(async (req, res) => {
  const reply = (o) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(o));
  };
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  if (req.method === 'GET') {
    if (url.searchParams.get('token') !== TOKEN) return reply({ ok: false, error: 'unauthorized' });
    if (url.searchParams.get('action') === 'image') {
      const f = db.files[url.searchParams.get('id')];
      return reply(f ? { ok: true, ...f } : { ok: false, error: '이미지를 찾을 수 없습니다.' });
    }
    return reply({ ok: true, data: db.tabs });
  }
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw || '{}');
  if (body.token !== TOKEN) return reply({ ok: false, error: 'unauthorized' });
  if (body.action === 'uploadImage') {
    const m = body.meta || {};
    const fileId = body.base64 ? `fake-${m.id}` : '';
    if (fileId) db.files[m.id] = { mimeType: body.mimeType, base64: body.base64 };
    db.tabs[IMAGE_TAB].push([m.id, m.title, m.cardCompanyTag, m.effectiveDate, m.note, m.uploadedBy, m.uploadedAt, fileId, body.mimeType || '', body.externalUrl || '']);
  } else if (body.action === 'deleteImage') {
    db.tabs[IMAGE_TAB] = db.tabs[IMAGE_TAB].filter((r, i) => i === 0 || r[0] !== body.id);
    delete db.files[body.id];
  } else {
    for (const op of body.batchOps || []) {
      if (op.op === 'write') db.tabs[op.range.replace(/'/g, '').split('!')[0]] = op.data;
    }
  }
  save();
  return reply({ ok: true, syncedAt: new Date().toISOString() });
}).listen(PORT, '127.0.0.1', () => console.log(`가짜 시트 실행 중: http://127.0.0.1:${PORT} (토큰 ${TOKEN})`));
