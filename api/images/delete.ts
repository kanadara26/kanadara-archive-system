import type { IncomingMessage, ServerResponse } from 'http';
import { HttpError, handleError, readJsonBody, requireLogin, send, webhookPost } from '../_lib.js';

// ADMIN만: 이미지 기록(10 탭 행)과 Drive 파일(휴지통으로) 삭제
export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'Method Not Allowed' });
  try {
    await requireLogin(req, ['ADMIN']);
    const id = String((await readJsonBody(req)).id || '').trim();
    if (!id) throw new HttpError(400, '삭제할 이미지 ID가 없습니다.');
    await webhookPost({ action: 'deleteImage', id });
    return send(res, 200, { ok: true });
  } catch (err) {
    return handleError(res, err);
  }
}
