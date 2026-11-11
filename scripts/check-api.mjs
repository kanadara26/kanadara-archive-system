// API(로그인·세션·시트 프록시) 검사. 실행: node scripts/check-api.mjs
// Vercel처럼 api/*.ts를 파일 단위로 ESM 변환 후 순수 Node로 실행 → import 경로 오류도 잡힘.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const out = fs.mkdtempSync(path.join(os.tmpdir(), 'kanadara-api-'));
const entries = ['api/_lib.ts', 'api/auth/login.ts', 'api/auth/logout.ts', 'api/gsheets/pull.ts', 'api/gsheets/push.ts',
  'api/images/upload.ts', 'api/images/delete.ts', 'api/images/file.ts'];
await build({ entryPoints: entries, outdir: out, outbase: 'api', format: 'esm', platform: 'node', bundle: false, logLevel: 'error' });
fs.writeFileSync(path.join(out, 'package.json'), '{"type":"module"}');
const load = async (p) => (await import(pathToFileURL(path.join(out, p)).href)).default;
const [login, logout, pull, push, upload, removeImage, imageFile] = await Promise.all(
  ['auth/login.js', 'auth/logout.js', 'gsheets/pull.js', 'gsheets/push.js', 'images/upload.js', 'images/delete.js', 'images/file.js'].map(load)
);

// ── 가짜 Apps Script (토큰 검증 + 메모리 시트) ──
const TOKEN = 'test-token';
const H = ['사용자ID', '구분(ROLE)', '이름', '로그인ID', '비밀번호', '소속/대리점', '연락처', '사업자등록번호', '주민등록번호', '사번', '활성상태', '생성일시'];
const row = (id, role, loginId, pw, active = 'Y') => [id, role, id, loginId, pw, '', '', '', '', '', active, '2026-01-01 9:00'];
const sheet = {
  '05_요율표_마스터': [['요율행ID']], '06_카드사별_프로모션_마스터': [['프로모션ID']],
  '07_거래내역_통합마스터': [['거래ID']], '08_분할결제_상세행_DB': [['분할행ID']],
  '09_사용자_CM_마스터': [H, row('adm', 'ADMIN', 'admin', 'Admin#Pass1'), row('ag1', 'AG', 'ag', 'AgPass#123'),
    row('cm1', 'CM', 'cm', 'CmPass#123'), row('ag2', 'AG', 'old', 'OldPass#123', 'N'),
    [...row('ag3', 'AG', 'num', 12345678), ].map((c, i) => (i === 10 ? true : c))], // 숫자 비밀번호·불리언 활성값
};
const images = new Map(); // 가짜 Drive: 이미지ID → { mimeType, base64 }
const fakeFetch = async (url, opts = {}) => {
  const reply = (o) => new Response(JSON.stringify(o));
  if (!opts.method || opts.method === 'GET') {
    const q = new URL(url).searchParams;
    if (q.get('token') !== TOKEN) return reply({ ok: false, error: 'unauthorized' });
    if (q.get('action') === 'image') {
      const img = images.get(q.get('id'));
      return reply(img ? { ok: true, ...img } : { ok: false, error: '이미지를 찾을 수 없습니다.' });
    }
    return reply({ ok: true, data: structuredClone(sheet) });
  }
  const body = JSON.parse(opts.body);
  if (body.token !== TOKEN) return reply({ ok: false, error: 'unauthorized' });
  if (body.action === 'uploadImage') {
    if (body.base64) images.set(body.meta.id, { mimeType: body.mimeType, base64: body.base64 });
    return reply({ ok: true });
  }
  if (body.action === 'deleteImage') {
    images.delete(body.id);
    return reply({ ok: true });
  }
  for (const op of body.batchOps) sheet[op.range.replace(/'/g, '').split('!')[0]] = op.data;
  return reply({ ok: true, syncedAt: 'now' });
};
globalThis.fetch = fakeFetch;
process.env.GSHEETS_WEBHOOK_URL = 'https://script.google.com/macros/s/TEST/exec';
process.env.GSHEETS_WEBHOOK_TOKEN = TOKEN;

const call = async (handler, { method = 'GET', body, cookie, url = '/' } = {}) => {
  const req = Readable.from(body ? [JSON.stringify(body)] : []);
  Object.assign(req, { method, url, headers: cookie ? { cookie } : {} });
  const r = { status: 0, headers: {}, body: null };
  await handler(req, {
    set statusCode(v) { r.status = v; },
    setHeader(k, v) { r.headers[k.toLowerCase()] = v; },
    end(b) {
      try { r.body = JSON.parse(b); } catch { r.body = b; } // 이미지는 바이너리
    },
  });
  r.cookie = String(r.headers['set-cookie'] || '').split(';')[0];
  return r;
};
const users = () => sheet['09_사용자_CM_마스터'];
// 실제 클라이언트처럼 방금 불러온 탭 버전을 함께 보냄
const pushAs = async (cookie, body) =>
  call(push, { method: 'POST', cookie, body: { baseVersions: (await call(pull, { cookie })).body.versions, ...body } });
const pwOf = (id) => users().find((r) => r[0] === id)?.[4];

// 1) 로그인
assert.equal((await call(pull)).status, 401, '세션 없이 pull 불가');
assert.equal((await call(login, { method: 'POST', body: { loginId: 'admin', password: 'wrong' } })).status, 401);
assert.equal((await call(login, { method: 'POST', body: { loginId: 'admin', password: '' } })).status, 400);
assert.equal((await call(login, { method: 'POST', body: { loginId: 'cm', password: 'CmPass#123' } })).status, 403, 'CM 로그인 차단');
assert.equal((await call(login, { method: 'POST', body: { loginId: 'old', password: 'OldPass#123' } })).status, 403, '비활성 차단');
const adm = await call(login, { method: 'POST', body: { loginId: 'ADMIN', password: 'Admin#Pass1' } });
assert.equal(adm.status, 200);
assert.match(String(adm.headers['set-cookie']), /HttpOnly; Secure; SameSite=Lax/);

// 2) pull: 비밀번호 제거 + 본인 정보
const p = await call(pull, { cookie: adm.cookie });
assert.equal(p.status, 200);
assert.deepEqual(p.body.me, { id: 'adm', role: 'ADMIN' });
assert.ok(p.body.data['09_사용자_CM_마스터'].slice(1).every((r) => r[4] === ''), '비밀번호가 내려가면 안 됨');
assert.equal((await call(pull, { cookie: adm.cookie.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')) })).status, 401, '위조 쿠키 거부');

// 3) push(ADMIN): 빈 비밀번호는 유지, 입력한 비밀번호는 변경
const u = p.body.data['09_사용자_CM_마스터'];
const w = (data, tab = '09_사용자_CM_마스터', op = 'write') => ({ batchOps: [{ op, range: `'${tab}'!A1`, data }] });
assert.equal((await pushAs(adm.cookie, w(u))).status, 200);
assert.equal(pwOf('adm'), 'Admin#Pass1');
assert.equal(pwOf('ag1'), 'AgPass#123');
const withNewPw = u.map((r) => (r[0] === 'ag1' ? r.map((c, j) => (j === 4 ? 'NewAg#Pass1' : c)) : r));
assert.equal((await pushAs(adm.cookie, w(withNewPw))).status, 200);
assert.equal(pwOf('ag1'), 'NewAg#Pass1');

// 4) 허용되지 않은 탭/명령 차단
assert.equal((await pushAs(adm.cookie, w([['x']], '00_조건_요율_프로모션_등록'))).status, 400);
assert.equal((await pushAs(adm.cookie, w([], '05_요율표_마스터', 'clear'))).status, 400);

// 5) AG: CM 추가는 가능, ADMIN/AG 변경·권한상승은 불가
const ag = await call(login, { method: 'POST', body: { loginId: 'ag', password: 'NewAg#Pass1' } });
assert.equal(ag.status, 200);
const agView = (await call(pull, { cookie: ag.cookie })).body.data['09_사용자_CM_마스터'];
assert.equal((await pushAs(ag.cookie, w([...agView, row('cm2', 'CM', 'cm2', 'Cm2#Pass12')]))).status, 200);
const escalate = agView.map((r) => (r[0] === 'ag1' ? r.map((c, j) => (j === 1 ? 'ADMIN' : c)) : r));
assert.equal((await pushAs(ag.cookie, w(escalate))).status, 403, 'AG 권한상승 차단');
assert.equal((await pushAs(ag.cookie, w([...agView, row('x', 'ADMIN', 'x', 'X#Pass1234')]))).status, 403);
assert.equal((await pushAs(ag.cookie, w(agView.filter((r) => r[0] !== 'adm')))).status, 403, 'ADMIN 삭제 차단');
assert.equal(users().find((r) => r[0] === 'ag1')[1], 'AG');

// 6) 관리자가 AG를 비활성화하면 기존 AG 세션도 즉시 무효
const deactivated = (await call(pull, { cookie: adm.cookie })).body.data['09_사용자_CM_마스터']
  .map((r) => (r[0] === 'ag1' ? r.map((c, j) => (j === 10 ? 'N' : c)) : r));
assert.equal((await pushAs(adm.cookie, w(deactivated))).status, 200);
assert.equal((await call(pull, { cookie: ag.cookie })).status, 401);

// 7) 동시 수정: 05/06/09는 버전이 다르면 409, 07/08은 거래 단위 병합
const fresh = await call(pull, { cookie: adm.cookie });
const v0 = fresh.body.versions;
assert.ok(v0['05_요율표_마스터'], 'pull이 탭 버전을 줘야 함');
const rates = [['요율행ID'], ['R1']];
const r1 = await call(push, { method: 'POST', cookie: adm.cookie, body: { ...w(rates, '05_요율표_마스터'), baseVersions: v0 } });
assert.equal(r1.status, 200);
// 저장 직후 받은 버전으로 다시 저장 → 자기 저장과 충돌하면 안 됨
const rates2 = [['요율행ID'], ['R1'], ['R2']];
const r2 = await call(push, { method: 'POST', cookie: adm.cookie, body: { ...w(rates2, '05_요율표_마스터'), baseVersions: r1.body.versions } });
assert.equal(r2.status, 200, '방금 받은 버전으로는 충돌 없이 저장');
sheet['05_요율표_마스터'].push(['R-콘솔등록']); // 시트 콘솔(Code.gs)에서 직접 추가
const r3 = await call(push, { method: 'POST', cookie: adm.cookie, body: { ...w([['요율행ID'], ['R1']], '05_요율표_마스터'), baseVersions: r2.body.versions } });
assert.equal(r3.status, 409, '시트에서 바뀐 탭은 덮어쓰지 않음');
assert.ok(sheet['05_요율표_마스터'].some((r) => r[0] === 'R-콘솔등록'), '콘솔 등록 행 보존');
assert.equal((await call(push, { method: 'POST', cookie: adm.cookie, body: { ...w(rates, '05_요율표_마스터') } })).status, 409, '버전 없으면 거부');

const J = '웹앱원본데이터(JSON)';
const tx = (id, updatedAt, note = '') => [id, JSON.stringify({ id, updatedAt, note })];
const sp = (id) => [`${id}-s1`, id];
const tw = (r07, r08, baseTxIds) => ({ baseTxIds, batchOps: [
  { op: 'write', range: "'07_거래내역_통합마스터'!A1", data: [['거래ID', J], ...r07] },
  { op: 'write', range: "'08_분할결제_상세행_DB'!A1", data: [['분할행ID', '거래ID'], ...r08] },
] });
// 시트 현재: A(다른 사용자가 11:00에 수정), B, D(다른 사용자가 새로 추가). E는 다른 사용자가 이미 삭제.
sheet['07_거래내역_통합마스터'] = [['거래ID', J], tx('A', '2026-11-11 11:00', 'theirs'), tx('B', '2026-11-11 09:00'), tx('D', '2026-11-11 10:30')];
sheet['08_분할결제_상세행_DB'] = [['분할행ID', '거래ID'], sp('A'), sp('B'), sp('D')];
// 나: A,B,E를 불러온 상태에서 A를 10:00에 수정, B 삭제, C 추가
const m = await call(push, { method: 'POST', cookie: adm.cookie,
  body: tw([tx('A', '2026-11-11 10:00', 'mine'), tx('E', '2026-11-11 08:00'), tx('C', '2026-11-11 10:45')], [sp('A'), sp('E'), sp('C')], ['A', 'B', 'E']) });
assert.equal(m.status, 200);
const ids07 = sheet['07_거래내역_통합마스터'].slice(1).map((r) => r[0]).sort();
assert.deepEqual(ids07, ['A', 'C', 'D'], 'B 삭제·E 부활 안 함·C 추가·D 유지');
assert.match(sheet['07_거래내역_통합마스터'].find((r) => r[0] === 'A')[1], /theirs/, '더 최근 수정본 유지');
assert.deepEqual(sheet['08_분할결제_상세행_DB'].slice(1).map((r) => r[1]).sort(), ['A', 'C', 'D'], '08도 같이 맞춰짐');
assert.ok(sheet['07_거래내역_통합마스터'].every((r) => r.length === 2), '행 너비 통일');
assert.equal((await call(push, { method: 'POST', cookie: adm.cookie, body: { batchOps: [tw([], [], []).batchOps[0]] } })).status, 400, '07만 단독 저장 불가');

// 8) 시트 원래 값: 숫자로 저장된 비밀번호·불리언 활성값도 로그인 가능
assert.equal((await call(login, { method: 'POST', body: { loginId: 'num', password: '12345678' } })).status, 200);

// 9) 요율표 이미지: ADMIN만 등록·삭제, SVG 거부, 로그인한 사용자만 열람
const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').toString('base64');
const agNow = await call(login, { method: 'POST', body: { loginId: 'num', password: '12345678' } });
assert.equal((await call(upload, { method: 'POST', cookie: agNow.cookie, body: { title: 't', mimeType: 'image/png', base64: png } })).status, 403, 'AG 업로드 불가');
assert.equal((await call(upload, { method: 'POST', cookie: adm.cookie, body: { title: 't', mimeType: 'image/svg+xml', base64: png } })).status, 400, 'SVG 거부');
assert.equal((await call(upload, { method: 'POST', cookie: adm.cookie, body: { title: '', mimeType: 'image/png', base64: png } })).status, 400, '제목 필수');
assert.equal((await call(upload, { method: 'POST', cookie: adm.cookie, body: { title: 't', externalUrl: 'http://x' } })).status, 400, 'https만');
const up = await call(upload, { method: 'POST', cookie: adm.cookie, body: { title: '11월 요율표', mimeType: 'image/png', base64: png } });
assert.equal(up.status, 200);
assert.match(up.body.image.uploadedBy, /admin|adm/);
const url = up.body.image.imageUrl;
assert.ok(url.startsWith('/api/images/file?id='));
assert.equal((await call(imageFile, { url })).status, 401, '로그인 없이 열람 불가');
const f = await call(imageFile, { url, cookie: agNow.cookie });
assert.equal(f.status, 200, 'AG도 열람 가능');
assert.equal(f.headers['content-type'], 'image/png');
assert.equal(f.headers['x-content-type-options'], 'nosniff');
assert.deepEqual(Buffer.from(f.body), Buffer.from(png, 'base64'));
assert.equal((await call(removeImage, { method: 'POST', cookie: agNow.cookie, body: { id: up.body.image.id } })).status, 403, 'AG 삭제 불가');
assert.equal((await call(removeImage, { method: 'POST', cookie: adm.cookie, body: { id: up.body.image.id } })).status, 200);
assert.equal((await call(imageFile, { url, cookie: adm.cookie })).status, 502, '삭제 후 열람 불가');

// 9-1) 같은 아이디로 5번 틀리면 맞는 비밀번호도 15분간 잠김 (다른 아이디는 영향 없음)
for (let i = 0; i < 5; i++) {
  assert.equal((await call(login, { method: 'POST', body: { loginId: 'num', password: 'bad' } })).status, 401);
}
assert.equal((await call(login, { method: 'POST', body: { loginId: 'NUM', password: '12345678' } })).status, 429, '잠금');
assert.equal((await call(login, { method: 'POST', body: { loginId: 'admin', password: 'Admin#Pass1' } })).status, 200, '다른 아이디는 정상');

// 10) 로그아웃 쿠키 삭제, 설정 누락 시 거부, 웹훅 토큰 불일치는 실패로 전달
assert.match(String((await call(logout, { method: 'POST' })).headers['set-cookie']), /Max-Age=0/);
process.env.GSHEETS_WEBHOOK_TOKEN = 'wrong-token';
assert.equal((await call(login, { method: 'POST', body: { loginId: 'admin', password: 'Admin#Pass1' } })).status, 502);
delete process.env.GSHEETS_WEBHOOK_TOKEN;
assert.equal((await call(login, { method: 'POST', body: { loginId: 'admin', password: 'Admin#Pass1' } })).status, 503);

fs.rmSync(out, { recursive: true, force: true });
console.log('OK: api checks passed');
