import type { IncomingMessage, ServerResponse } from 'http';
import { HttpError, handleError, readJsonBody, requireLogin, send, webhookPost } from '../_lib.js';

// SVG는 스크립트를 품을 수 있어 같은 도메인에서 내려주면 위험 → 래스터 이미지만 허용
export const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const MAX_BYTES = 3 * 1024 * 1024; // Vercel 요청 본문 한도(4.5MB) 안에 base64로 들어가는 크기

const nowKst = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 16).replace('T', ' ');

// ADMIN만: 요율표 이미지를 Drive(비공개 폴더)에 저장하고 10_요율표_이미지 탭에 기록
export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'Method Not Allowed' });
  try {
    const { account } = await requireLogin(req, ['ADMIN']);
    const body = await readJsonBody(req);
    const title = String(body.title || '').trim();
    const mimeType = String(body.mimeType || '');
    const base64 = String(body.base64 || '');
    const externalUrl = String(body.externalUrl || '').trim();
    if (!title) throw new HttpError(400, '요율표 제목을 입력해 주세요.');
    if (base64) {
      if (!ALLOWED_IMAGE_TYPES.includes(mimeType)) throw new HttpError(400, 'PNG·JPG·WebP·GIF 이미지만 올릴 수 있습니다.');
      if (Buffer.from(base64, 'base64').length > MAX_BYTES) throw new HttpError(413, '이미지가 너무 큽니다 (최대 3MB).');
    } else if (!externalUrl.startsWith('https://')) {
      throw new HttpError(400, '이미지 파일을 선택하거나 https:// 이미지 주소를 입력해 주세요.');
    }

    const meta = {
      id: `rt-img-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title,
      cardCompanyTag: String(body.cardCompanyTag || '').trim() || '전 카드사',
      effectiveDate: String(body.effectiveDate || '').trim(),
      note: String(body.note || '').trim(),
      uploadedBy: `${account.name} (${account.role})`,
      uploadedAt: nowKst(),
    };
    await webhookPost({
      action: 'uploadImage',
      meta,
      mimeType: base64 ? mimeType : '',
      base64,
      externalUrl: base64 ? '' : externalUrl,
    });
    return send(res, 200, {
      ok: true,
      image: { ...meta, imageUrl: base64 ? `/api/images/file?id=${meta.id}` : externalUrl },
    });
  } catch (err) {
    return handleError(res, err);
  }
}
