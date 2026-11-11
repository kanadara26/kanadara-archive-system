import type { ServerResponse } from 'http';

// 서버 환경변수 우선, 없으면 클라이언트가 보낸 URL 사용.
// 임의 주소로 서버가 요청을 보내지 않도록 Apps Script 웹앱 주소만 허용.
export function resolveWebhookUrl(clientValue: unknown): string {
  const url = String(process.env.GSHEETS_WEBHOOK_URL || clientValue || '').trim();
  return url.startsWith('https://script.google.com/macros/s/') ? url : '';
}

export function send(res: ServerResponse, status: number, payload: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}
