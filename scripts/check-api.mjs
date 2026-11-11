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
const entries = ['api/_lib.ts', 'api/auth/login.ts', 'api/auth/logout.ts', 'api/gsheets/pull.ts', 'api/gsheets/push.ts'];
await build({ entryPoints: entries, outdir: out, outbase: 'api', format: 'esm', platform: 'node', bundle: false, logLevel: 'error' });
fs.writeFileSync(path.join(out, 'package.json'), '{"type":"module"}');
const load = async (p) => (await import(pathToFileURL(path.join(out, p)).href)).default;
const [login, logout, pull, push] = await Promise.all(
  ['auth/login.js', 'auth/logout.js', 'gsheets/pull.js', 'gsheets/push.js'].map(load)
);

// ── 가짜 Apps Script (토큰 검증 + 메모리 시트) ──
const TOKEN = 'test-token';
const H = ['사용자ID', '구분(ROLE)', '이름', '로그인ID', '비밀번호', '소속/대리점', '연락처', '사업자등록번호', '주민등록번호', '사번', '활성상태', '생성일시'];
const row = (id, role, loginId, pw, active = 'Y') => [id, role, id, loginId, pw, '', '', '', '', '', active, '2026-01-01 9:00'];
const sheet = {
  '05_요율표_마스터': [['요율행ID']], '06_카드사별_프로모션_마스터': [['프로모션ID']],
  '07_거래내역_통합마스터': [['거래ID']], '08_분할결제_상세행_DB': [['분할행ID']],
  '09_사용자_CM_마스터': [H, row('adm', 'ADMIN', 'admin', 'Admin#Pass1'), row('ag1', 'AG', 'ag', 'AgPass#123'),
    row('cm1', 'CM', 'cm', 'CmPass#123'), row('ag2', 'AG', 'old', 'OldPass#123', 'N')],
};
const fakeFetch = async (url, opts = {}) => {
  const reply = (o) => new Response(JSON.stringify(o));
  if (!opts.method || opts.method === 'GET') {
    if (new URL(url).searchParams.get('token') !== TOKEN) return reply({ ok: false, error: 'unauthorized' });
    return reply({ ok: true, data: structuredClone(sheet) });
  }
  const body = JSON.parse(opts.body);
  if (body.token !== TOKEN) return reply({ ok: false, error: 'unauthorized' });
  for (const op of body.batchOps) sheet[op.range.replace(/'/g, '').split('!')[0]] = op.data;
  return reply({ ok: true, syncedAt: 'now' });
};
globalThis.fetch = fakeFetch;
process.env.GSHEETS_WEBHOOK_URL = 'https://script.google.com/macros/s/TEST/exec';
process.env.GSHEETS_WEBHOOK_TOKEN = TOKEN;

const call = async (handler, { method = 'GET', body, cookie } = {}) => {
  const req = Readable.from(body ? [JSON.stringify(body)] : []);
  Object.assign(req, { method, url: '/', headers: cookie ? { cookie } : {} });
  const r = { status: 0, headers: {}, body: null };
  await handler(req, {
    set statusCode(v) { r.status = v; },
    setHeader(k, v) { r.headers[k.toLowerCase()] = v; },
    end(b) { r.body = JSON.parse(b); },
  });
  r.cookie = String(r.headers['set-cookie'] || '').split(';')[0];
  return r;
};
const users = () => sheet['09_사용자_CM_마스터'];
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
assert.equal((await call(push, { method: 'POST', cookie: adm.cookie, body: w(u) })).status, 200);
assert.equal(pwOf('adm'), 'Admin#Pass1');
assert.equal(pwOf('ag1'), 'AgPass#123');
const withNewPw = u.map((r) => (r[0] === 'ag1' ? r.map((c, j) => (j === 4 ? 'NewAg#Pass1' : c)) : r));
assert.equal((await call(push, { method: 'POST', cookie: adm.cookie, body: w(withNewPw) })).status, 200);
assert.equal(pwOf('ag1'), 'NewAg#Pass1');

// 4) 허용되지 않은 탭/명령 차단
assert.equal((await call(push, { method: 'POST', cookie: adm.cookie, body: w([['x']], '00_조건_요율_프로모션_등록') })).status, 400);
assert.equal((await call(push, { method: 'POST', cookie: adm.cookie, body: w([], '05_요율표_마스터', 'clear') })).status, 400);

// 5) AG: CM 추가는 가능, ADMIN/AG 변경·권한상승은 불가
const ag = await call(login, { method: 'POST', body: { loginId: 'ag', password: 'NewAg#Pass1' } });
assert.equal(ag.status, 200);
const agView = (await call(pull, { cookie: ag.cookie })).body.data['09_사용자_CM_마스터'];
assert.equal((await call(push, { method: 'POST', cookie: ag.cookie, body: w([...agView, row('cm2', 'CM', 'cm2', 'Cm2#Pass12')]) })).status, 200);
const escalate = agView.map((r) => (r[0] === 'ag1' ? r.map((c, j) => (j === 1 ? 'ADMIN' : c)) : r));
assert.equal((await call(push, { method: 'POST', cookie: ag.cookie, body: w(escalate) })).status, 403, 'AG 권한상승 차단');
assert.equal((await call(push, { method: 'POST', cookie: ag.cookie, body: w([...agView, row('x', 'ADMIN', 'x', 'X#Pass1234')]) })).status, 403);
assert.equal((await call(push, { method: 'POST', cookie: ag.cookie, body: w(agView.filter((r) => r[0] !== 'adm')) })).status, 403, 'ADMIN 삭제 차단');
assert.equal(users().find((r) => r[0] === 'ag1')[1], 'AG');

// 6) 관리자가 AG를 비활성화하면 기존 AG 세션도 즉시 무효
const deactivated = (await call(pull, { cookie: adm.cookie })).body.data['09_사용자_CM_마스터']
  .map((r) => (r[0] === 'ag1' ? r.map((c, j) => (j === 10 ? 'N' : c)) : r));
assert.equal((await call(push, { method: 'POST', cookie: adm.cookie, body: w(deactivated) })).status, 200);
assert.equal((await call(pull, { cookie: ag.cookie })).status, 401);

// 7) 로그아웃 쿠키 삭제, 설정 누락 시 거부, 웹훅 토큰 불일치는 실패로 전달
assert.match(String((await call(logout, { method: 'POST' })).headers['set-cookie']), /Max-Age=0/);
process.env.GSHEETS_WEBHOOK_TOKEN = 'wrong-token';
assert.equal((await call(login, { method: 'POST', body: { loginId: 'admin', password: 'Admin#Pass1' } })).status, 502);
delete process.env.GSHEETS_WEBHOOK_TOKEN;
assert.equal((await call(login, { method: 'POST', body: { loginId: 'admin', password: 'Admin#Pass1' } })).status, 503);

fs.rmSync(out, { recursive: true, force: true });
console.log('OK: api checks passed');
