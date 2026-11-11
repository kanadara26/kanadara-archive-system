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

// 시트 09 탭 기준으로 서버에서 아이디·비밀번호를 확인하고 세션 쿠키 발급
export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'Method Not Allowed' });
  try {
    const body = await readJsonBody(req);
    const loginId = String(body.loginId || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (!loginId || !password) throw new HttpError(400, '아이디와 비밀번호를 모두 입력해 주세요.');

    const account = parseAccounts((await readSheet())[USERS_TAB]).find(
      (a) => a.loginId.toLowerCase() === loginId
    );
    // ponytail: 시도 횟수 제한 없음. 무차별 대입이 보이면 Vercel Firewall 레이트리밋 추가.
    if (!account || !account.password || !safeEqual(account.password, password)) {
      throw new HttpError(401, '아이디 또는 비밀번호가 일치하지 않습니다.');
    }
    if (!account.isActive) throw new HttpError(403, '비활성화된 계정입니다. 관리자에게 문의해 주세요.');
    if (account.role !== 'ADMIN' && account.role !== 'AG') {
      throw new HttpError(403, '관리자(ADMIN)와 AG 계정만 로그인할 수 있습니다.');
    }

    setSessionCookie(res, account.id, account.role);
    return send(res, 200, { ok: true, user: { id: account.id, role: account.role, name: account.name } });
  } catch (err) {
    return handleError(res, err);
  }
}
