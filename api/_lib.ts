import type { IncomingMessage, ServerResponse } from 'http';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

// ───────── 응답 ─────────
export function send(res: ServerResponse, status: number, payload: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

export async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  // Vercel은 body를 미리 파싱해 둘 수 있음
  const preParsed = (req as IncomingMessage & { body?: unknown }).body;
  if (preParsed && typeof preParsed === 'object') return preParsed as Record<string, unknown>;
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return JSON.parse(raw || '{}');
}

// ───────── 구글 시트 웹훅 (URL·토큰은 서버 환경변수에서만) ─────────
export const SPREADSHEET_ID = '1fGq9OKWroDBovIlkvdrkYmDFZp-HTkeJem5sirv6vvs';
export const USERS_TAB = '09_사용자_CM_마스터';
export const WRITABLE_TABS = [
  '05_요율표_마스터',
  '06_카드사별_프로모션_마스터',
  '07_거래내역_통합마스터',
  '08_분할결제_상세행_DB',
  USERS_TAB,
];
export type SheetTabs = Record<string, string[][]>;

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function getWebhookConfig() {
  const url = String(process.env.GSHEETS_WEBHOOK_URL || '').trim();
  const token = String(process.env.GSHEETS_WEBHOOK_TOKEN || '').trim();
  if (!url.startsWith('https://script.google.com/macros/s/') || !token) {
    throw new HttpError(
      503,
      '서버에 GSHEETS_WEBHOOK_URL / GSHEETS_WEBHOOK_TOKEN 환경변수가 설정되지 않았습니다.'
    );
  }
  return { url, token };
}

export async function readSheet(): Promise<SheetTabs> {
  const { url, token } = getWebhookConfig();
  const resp = await fetch(`${url}?token=${encodeURIComponent(token)}`);
  const json = (await resp.json()) as { ok?: boolean; data?: SheetTabs; error?: string };
  if (!resp.ok || !json.ok || !json.data) {
    throw new HttpError(502, json.error || `시트 읽기 실패 (HTTP ${resp.status})`);
  }
  return json.data;
}

export async function writeSheet(batchOps: unknown[]): Promise<string> {
  const { url, token } = getWebhookConfig();
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, spreadsheetId: SPREADSHEET_ID, batchOps }),
  });
  const json = (await resp.json()) as { ok?: boolean; error?: string; syncedAt?: string };
  if (!resp.ok || !json.ok) {
    throw new HttpError(502, json.error || `시트 쓰기 실패 (HTTP ${resp.status})`);
  }
  return json.syncedAt || new Date().toISOString();
}

// ───────── 09 탭 계정 ─────────
export interface SheetAccount {
  id: string;
  role: string;
  name: string;
  loginId: string;
  password: string;
  isActive: boolean;
}

// 헤더 이름으로 열 위치를 찾고, 없으면 표준 위치(A,B,C,D,E,K) 사용
export function userColumns(header: string[] = []) {
  const at = (name: string, fallback: number) => {
    const i = header.findIndex((h) => String(h).trim() === name);
    return i >= 0 ? i : fallback;
  };
  return {
    id: at('사용자ID', 0),
    role: at('구분(ROLE)', 1),
    name: at('이름', 2),
    loginId: at('로그인ID', 3),
    password: at('비밀번호', 4),
    active: at('활성상태', 10),
  };
}

export function parseAccounts(rows: string[][] = []): SheetAccount[] {
  const c = userColumns(rows[0]);
  return rows
    .slice(1)
    .map((r) => {
      const active = String(r[c.active] ?? '').trim().toUpperCase();
      return {
        id: String(r[c.id] ?? '').trim(),
        role: String(r[c.role] ?? '').trim().toUpperCase(),
        name: String(r[c.name] ?? '').trim(),
        loginId: String(r[c.loginId] ?? '').trim(),
        password: String(r[c.password] ?? '').trim(),
        isActive: active !== 'N' && active !== 'FALSE' && active !== '0',
      };
    })
    .filter((a) => a.id && a.loginId);
}

export function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

// ───────── 세션 쿠키 (HMAC 서명, 서버 저장소 없음) ─────────
const COOKIE = 'kn_session';
const SESSION_HOURS = 12;

// ponytail: 서명 키를 웹훅 토큰에서 파생 → 별도 환경변수 불필요. 토큰을 바꾸면 전원 로그아웃됨.
function sessionKey(): Buffer {
  return createHash('sha256').update(`kanadara-session:${getWebhookConfig().token}`).digest();
}

export interface Session {
  uid: string;
  role: string;
  exp: number;
}

export function setSessionCookie(res: ServerResponse, uid: string, role: string) {
  const payload = Buffer.from(
    JSON.stringify({ uid, role, exp: Date.now() + SESSION_HOURS * 3600_000 })
  ).toString('base64url');
  const sig = createHmac('sha256', sessionKey()).update(payload).digest('base64url');
  res.setHeader(
    'Set-Cookie',
    `${COOKIE}=${payload}.${sig}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_HOURS * 3600}`
  );
}

export function clearSessionCookie(res: ServerResponse) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
}

export function getSession(req: IncomingMessage): Session | null {
  const raw = (req.headers.cookie || '')
    .split(';')
    .map((p) => p.trim())
    .find((p) => p.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
  if (!raw) return null;
  const [payload, sig] = raw.split('.');
  if (!payload || !sig) return null;
  const expected = createHmac('sha256', sessionKey()).update(payload).digest('base64url');
  if (!safeEqual(sig, expected)) return null;
  try {
    const s = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Session;
    return s.exp > Date.now() ? s : null;
  } catch {
    return null;
  }
}

// 세션이 유효하고, 시트 기준으로 계정이 아직 활성 상태인지 확인
export function requireActiveAccount(session: Session | null, tabs: SheetTabs): SheetAccount {
  if (!session) throw new HttpError(401, '로그인이 필요합니다.');
  const account = parseAccounts(tabs[USERS_TAB]).find((a) => a.id === session.uid);
  if (!account || !account.isActive || account.role !== session.role) {
    throw new HttpError(401, '계정이 비활성화되었거나 권한이 변경되었습니다. 다시 로그인해 주세요.');
  }
  return account;
}

export function handleError(res: ServerResponse, err: unknown) {
  if (err instanceof HttpError) {
    if (err.status === 401) clearSessionCookie(res);
    return send(res, err.status, { ok: false, error: err.message });
  }
  return send(res, 500, { ok: false, error: err instanceof Error ? err.message : '서버 오류' });
}
