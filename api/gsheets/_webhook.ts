import type { ServerResponse } from 'http';

// 웹훅 URL과 토큰은 서버 환경변수에서만 읽는다.
// (클라이언트가 URL을 지정할 수 있으면 토큰이 공격자 스크립트로 새어나갈 수 있음)
export function getWebhookConfig(): { url: string; token: string } | null {
  const url = String(process.env.GSHEETS_WEBHOOK_URL || '').trim();
  const token = String(process.env.GSHEETS_WEBHOOK_TOKEN || '').trim();
  if (!url.startsWith('https://script.google.com/macros/s/') || !token) return null;
  return { url, token };
}

export const MISSING_CONFIG_ERROR =
  '서버에 GSHEETS_WEBHOOK_URL / GSHEETS_WEBHOOK_TOKEN 환경변수가 설정되지 않았습니다.';

export function send(res: ServerResponse, status: number, payload: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}
