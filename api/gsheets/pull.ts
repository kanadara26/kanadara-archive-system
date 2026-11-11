import type { IncomingMessage, ServerResponse } from 'http';
import {
  HttpError,
  USERS_TAB,
  getSession,
  handleError,
  readSheet,
  requireActiveAccount,
  send,
  tabVersions,
  userColumns,
} from '../_lib.js';

// 로그인한 ADMIN/AG에게만 05~09 탭 전달. 비밀번호 열은 항상 비워서 내려보냄.
export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    const session = getSession(req);
    if (!session) throw new HttpError(401, '로그인이 필요합니다.');
    const tabs = await readSheet();
    const me = requireActiveAccount(session, tabs);
    const versions = tabVersions(tabs); // 비밀번호 제거 전 원본 기준

    const users = tabs[USERS_TAB] || [];
    const pwCol = userColumns(users[0]).password;
    tabs[USERS_TAB] = users.map((r, i) => (i === 0 ? r : r.map((c, j) => (j === pwCol ? '' : c))));

    return send(res, 200, { ok: true, data: tabs, versions, me: { id: me.id, role: me.role } });
  } catch (err) {
    return handleError(res, err);
  }
}
