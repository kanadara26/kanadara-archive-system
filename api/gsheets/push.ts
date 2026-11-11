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
  tabVersion,
  tabVersions,
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

const TX_TAB = '07_거래내역_통합마스터';
const SPLIT_TAB = '08_분할결제_상세행_DB';
const TX_JSON_HEADER = '웹앱원본데이터(JSON)';

// 07/08 탭: 탭 전체를 덮어쓰지 않고 거래 단위로 병합.
// - 다른 사용자가 새로 추가한 거래 → 유지
// - 내가 불러왔던(base) 거래를 내가 지움 → 삭제 / 다른 사용자가 지움 → 삭제 유지
// - 양쪽에 다 있음 → updatedAt이 더 최근인 쪽 (같으면 내 것)
// 08 분할행은 해당 거래를 가져온 쪽 것을 그대로 따라감.
export function mergeTransactionTabs(
  client07: string[][],
  client08: string[][],
  current07: string[][] = [],
  current08: string[][] = [],
  baseTxIds: Set<string>
): { rows07: string[][]; rows08: string[][] } {
  const index = (rows: string[][]) => {
    const col = (rows[0] || []).findIndex((h) => String(h).trim() === TX_JSON_HEADER);
    const map = new Map<string, { row: string[]; updatedAt: string }>();
    for (const r of rows.slice(1)) {
      const id = String(r[0] ?? '').trim();
      if (!id) continue;
      let updatedAt = '';
      try {
        updatedAt = String(JSON.parse(r[col]).updatedAt || '');
      } catch {
        // JSON 없는 행: 비교 불가 → 내 것 우선
      }
      map.set(id, { row: r, updatedAt });
    }
    return map;
  };
  const splitsByTx = (rows: string[][]) => {
    const map = new Map<string, string[][]>();
    for (const r of rows.slice(1)) {
      const id = String(r[1] ?? '').trim();
      map.set(id, [...(map.get(id) || []), r]);
    }
    return map;
  };
  const mine = index(client07);
  const theirs = index(current07);
  const mineSplits = splitsByTx(client08);
  const theirSplits = splitsByTx(current08);

  const rows07 = [client07[0]];
  const rows08 = [client08[0]];
  const take = (id: string, fromMine: boolean) => {
    rows07.push((fromMine ? mine : theirs).get(id)!.row);
    rows08.push(...((fromMine ? mineSplits : theirSplits).get(id) || []));
  };
  for (const [id, m] of mine) {
    const t = theirs.get(id);
    if (!t) {
      if (!baseTxIds.has(id)) take(id, true); // 새 거래 (불러온 뒤 다른 사람이 지운 거래는 다시 살리지 않음)
    } else {
      take(id, !(t.updatedAt > m.updatedAt));
    }
  }
  for (const id of theirs.keys()) {
    if (!mine.has(id) && !baseTxIds.has(id)) take(id, false);
  }
  // setValues는 모든 행의 열 수가 같아야 함 → 헤더 너비에 맞춤
  const fit = (rows: string[][]) =>
    rows.map((r) => Array.from({ length: rows[0].length }, (_, i) => r[i] ?? ''));
  return { rows07: fit(rows07), rows08: fit(rows08) };
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'Method Not Allowed' });
  try {
    const session = getSession(req);
    if (!session) throw new HttpError(401, '로그인이 필요합니다.');
    const body = await readJsonBody(req);
    const ops = validateOps(body.batchOps);
    const baseVersions = (body.baseVersions || {}) as Record<string, string>;
    const baseTxIds = new Set((Array.isArray(body.baseTxIds) ? body.baseTxIds : []).map(String));
    const tx07 = ops.find((o) => tabOf(o.range) === TX_TAB);
    const tx08 = ops.find((o) => tabOf(o.range) === SPLIT_TAB);
    if (!!tx07 !== !!tx08) throw new HttpError(400, '07·08 탭은 함께 저장해야 합니다.');

    const current = await readSheet();
    const me = requireActiveAccount(session, current);
    if (me.role !== 'ADMIN' && me.role !== 'AG') throw new HttpError(403, '시트 저장 권한이 없습니다.');

    // 05/06/09: 불러온 뒤 시트가 바뀌었으면 덮어쓰지 않고 거절 (시트 콘솔·다른 사용자 변경 보호)
    // ponytail: 확인과 쓰기 사이 몇 초는 무방비. 더 촘촘히 하려면 Apps Script에서 LockService로 확인+쓰기.
    for (const op of ops) {
      const tab = tabOf(op.range);
      if (tab === TX_TAB || tab === SPLIT_TAB) continue;
      if (baseVersions[tab] !== tabVersion(current[tab])) {
        throw new HttpError(409, `${tab} 탭이 그 사이 시트에서 변경되었습니다.`);
      }
      if (tab === USERS_TAB) {
        op.data = mergeUsersTab(op.data, current[USERS_TAB] || [], me.role === 'ADMIN');
      }
    }
    if (tx07 && tx08) {
      const merged = mergeTransactionTabs(tx07.data, tx08.data, current[TX_TAB], current[SPLIT_TAB], baseTxIds);
      tx07.data = merged.rows07;
      tx08.data = merged.rows08;
    }

    const syncedAt = await writeSheet(ops);
    // 저장 후 시트에 실제로 보이는 값 기준으로 새 버전 전달 (실패해도 저장은 성공 → 다음 저장 시 재확인)
    const versions = await readSheet().then(tabVersions, () => null);
    return send(res, 200, { ok: true, syncedAt, versions });
  } catch (err) {
    return handleError(res, err);
  }
}
