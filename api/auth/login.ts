import type { IncomingMessage, ServerResponse } from 'http';
import {
  HttpError,
  USERS_TAB,
  handleError,
  parseAccounts,
  readJsonBody,
  readSheet,
  safeEqual,
  send,
  setSessionCookie,
} from '../_lib.js';

// 아이디별 실패 기록: 15분 안에 5번 틀리면 15분간 잠금
// ponytail: 서버 인스턴스 메모리라 인스턴스가 여러 개면 한도가 그만큼 늘어남. 더 막아야 하면 Vercel Firewall 레이트리밋 추가.
const MAX_FAILS = 5;
const WINDOW_MS = 15 * 60_000;
const failures = new Map<string, { count: number; first: number }>();

function checkLocked(loginId: string) {
  const f = failures.get(loginId);
  if (!f) return;
  if (Date.now() - f.first > WINDOW_MS) failures.delete(loginId);
  else if (f.count >= MAX_FAILS) {
    const min = Math.ceil((f.first + WINDOW_MS - Date.now()) / 60_000);
    throw new HttpError(429, `로그인 실패가 ${MAX_FAILS}번 이어져 잠겼습니다. ${min}분 뒤에 다시 시도해 주세요.`);
  }
}

function recordFailure(loginId: string) {
  const f = failures.get(loginId);
  if (f && Date.now() - f.first <= WINDOW_MS) f.count += 1;
  else failures.set(loginId, { count: 1, first: Date.now() });
}

// 시트 09 탭 기준으로 서버에서 아이디·비밀번호를 확인하고 세션 쿠키 발급
export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'Method Not Allowed' });
  try {
    const body = await readJsonBody(req);
    const loginId = String(body.loginId || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (!loginId || !password) throw new HttpError(400, '아이디와 비밀번호를 모두 입력해 주세요.');
    checkLocked(loginId);

    const account = parseAccounts((await readSheet())[USERS_TAB]).find(
      (a) => a.loginId.toLowerCase() === loginId
    );
    if (!account || !account.password || !safeEqual(account.password, password)) {
      recordFailure(loginId);
      throw new HttpError(401, '아이디 또는 비밀번호가 일치하지 않습니다.');
    }
    if (!account.isActive) throw new HttpError(403, '비활성화된 계정입니다. 관리자에게 문의해 주세요.');
    if (account.role !== 'ADMIN' && account.role !== 'AG') {
      throw new HttpError(403, '관리자(ADMIN)와 AG 계정만 로그인할 수 있습니다.');
    }

    failures.delete(loginId);
    setSessionCookie(res, account.id, account.role);
    return send(res, 200, { ok: true, user: { id: account.id, role: account.role, name: account.name } });
  } catch (err) {
    return handleError(res, err);
  }
}
