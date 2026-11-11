import type { IncomingMessage, ServerResponse } from 'http';
import { HttpError, getSession, handleError, readImageFile } from '../_lib.js';
import { ALLOWED_IMAGE_TYPES } from './upload.js';

// 로그인한 사용자에게만 요율표 이미지 전달 (Drive 파일은 공개하지 않음)
// ponytail: 세션 서명만 확인(시트 재조회 생략) → 비활성화된 계정도 세션 만료(최대 12시간)까지는 이미지 열람 가능
export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    if (!getSession(req)) throw new HttpError(401, '로그인이 필요합니다.');
    const id = new URL(req.url || '/', 'http://localhost').searchParams.get('id') || '';
    if (!id) throw new HttpError(400, '이미지 ID가 없습니다.');

    const { mimeType, base64 } = await readImageFile(id);
    const bytes = Buffer.from(base64, 'base64');
    res.statusCode = 200;
    res.setHeader('Content-Type', ALLOWED_IMAGE_TYPES.includes(mimeType) ? mimeType : 'application/octet-stream');
    res.setHeader('Content-Length', String(bytes.length));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=86400'); // 같은 ID의 이미지는 바뀌지 않음
    res.end(bytes);
  } catch (err) {
    return handleError(res, err);
  }
}
