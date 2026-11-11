// 웹훅 프록시 토큰·URL 처리 검사 (가짜 Apps Script). 실행: node scripts/check-webhook-token.mjs
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createServer } from 'vite';
const server = await createServer({ server: { middlewareMode: true }, optimizeDeps: { noDiscovery: true, include: [] }, logLevel: 'error' });
const call = async (name, method, body, url = '/') => {
  const mod = await server.ssrLoadModule(`/api/gsheets/${name}.ts`);
  const req = Readable.from(body ? [JSON.stringify(body)] : []); req.method = method; req.url = url;
  const out = { status: 0, body: '' };
  const res = { setHeader() {}, set statusCode(v) { out.status = v; }, end(b) { out.body = JSON.parse(b); } };
  await mod.default(req, res); return out;
};
const seen = [];
globalThis.fetch = async (u, o) => { seen.push({ u: String(u), body: o?.body && JSON.parse(o.body) });
  return new Response(JSON.stringify({ ok: true, data: { x: [] } })); };
try {
  delete process.env.GSHEETS_WEBHOOK_URL; delete process.env.GSHEETS_WEBHOOK_TOKEN;
  assert.equal((await call('pull', 'GET')).status, 503);                       // 설정 없으면 거부
  process.env.GSHEETS_WEBHOOK_URL = 'https://script.google.com/macros/s/REAL/exec';
  assert.equal((await call('pull', 'GET')).status, 503);                       // 토큰 없으면 거부
  process.env.GSHEETS_WEBHOOK_TOKEN = 'tok-123';
  const p = await call('pull', 'GET', null, '/?webhookUrl=https://script.google.com/macros/s/EVIL/exec');
  assert.equal(p.status, 200);
  assert.equal(seen.at(-1).u, 'https://script.google.com/macros/s/REAL/exec?token=tok-123'); // 클라이언트 URL 무시
  const w = await call('push', 'POST', { batchOps: [1], webhookUrl: 'https://script.google.com/macros/s/EVIL/exec' });
  assert.equal(w.status, 200);
  assert.equal(seen.at(-1).u, 'https://script.google.com/macros/s/REAL/exec');
  assert.equal(seen.at(-1).body.token, 'tok-123');
  assert.ok(seen.every((s) => !s.u.includes('EVIL')));
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: false, error: 'Error: unauthorized' }));
  const bad = await call('push', 'POST', { batchOps: [] });
  assert.equal(bad.status, 502); assert.match(bad.body.error, /unauthorized/);   // 토큰 불일치 → 실패로 전달
  console.log('OK: token checks passed');
} finally { await server.close(); }
