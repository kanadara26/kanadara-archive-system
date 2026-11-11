import type { IncomingMessage, ServerResponse } from 'http';
import {
  HttpError,
  USERS_TAB,
  WRITABLE_TABS,
  getSession,
  handleError,
  parseAccounts,
  readJsonBody,
  readSheet,
  requireActiveAccount,
  send,
  userColumns,
  writeSheet,
} from '../_lib.js';

interface WriteOp {
  op: 'write';
  range: string;
  data: string[][];
}

const tabOf = (range: string) => range.replace(/'/g, '').split('!')[0];

// 허용된 5개 탭에 대한 write 명령만 통과
function validateOps(raw: unknown): WriteOp[] {
  if (!Array.isArray(raw)) throw new HttpError(400, 'batchOps 형식 오류');
  return raw.map((o) => {
    const op = o as Partial<WriteOp>;
    if (op.op !== 'write' || typeof op.range !== 'string' || !Array.isArray(op.data)) {
      throw new HttpError(400, '허용되지 않은 시트 명령입니다.');
    }
    if (!WRITABLE_TABS.includes(tabOf(op.range))) {
      throw new HttpError(400, `쓰기가 허용되지 않은 탭입니다: ${tabOf(op.range)}`);
    }
    return { op: 'write', range: op.range, data: op.data.map((r) => r.map((c) => String(c ?? ''))) };
  });
}

// 09 탭: 비어 있는 비밀번호는 시트의 기존 값 유지. ADMIN이 아니면 ADMIN/AG 계정은 건드릴 수 없음.
export function mergeUsersTab(next: string[][], current: string[][], isAdmin: boolean): string[][] {
  const pwCol = userColumns(next[0]).password;
  const currentById = new Map(parseAccounts(current).map((a) => [a.id, a]));
  const idCol = userColumns(next[0]).id;
  const merged = next.map((r, i) => {
    if (i === 0 || String(r[pwCol] ?? '').trim()) return r;
    const existing = currentById.get(String(r[idCol]).trim());
    return r.map((c, j) => (j === pwCol ? existing?.password ?? '' : c));
  });

  if (!isAdmin) {
    const key = (a: { id: string; role: string; loginId: string; password: string; isActive: boolean }) =>
      `${a.id}|${a.role}|${a.loginId}|${a.password}|${a.isActive}`;
    const privileged = (rows: string[][]) =>
      parseAccounts(rows)
        .filter((a) => a.role === 'ADMIN' || a.role === 'AG')
        .map(key)
        .sort()
        .join('\n');
    if (privileged(merged) !== privileged(current)) {
      throw new HttpError(403, 'ADMIN/AG 계정의 추가·수정·삭제는 관리자(ADMIN)만 할 수 있습니다.');
    }
  }
  return merged;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'Method Not Allowed' });
  try {
    const session = getSession(req);
    if (!session) throw new HttpError(401, '로그인이 필요합니다.');
    const ops = validateOps((await readJsonBody(req)).batchOps);

    const current = await readSheet();
    const me = requireActiveAccount(session, current);
    if (me.role !== 'ADMIN' && me.role !== 'AG') throw new HttpError(403, '시트 저장 권한이 없습니다.');

    for (const op of ops) {
      if (tabOf(op.range) === USERS_TAB) {
        op.data = mergeUsersTab(op.data, current[USERS_TAB] || [], me.role === 'ADMIN');
      }
    }
    const syncedAt = await writeSheet(ops);
    return send(res, 200, { ok: true, syncedAt });
  } catch (err) {
    return handleError(res, err);
  }
}
