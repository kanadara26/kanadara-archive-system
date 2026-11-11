import type { IncomingMessage, ServerResponse } from 'http';
import { getWebhookConfig, MISSING_CONFIG_ERROR, send } from './_webhook';

const SPREADSHEET_ID = '1fGq9OKWroDBovIlkvdrkYmDFZp-HTkeJem5sirv6vvs';

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  // Vercel은 body를 미리 파싱해 둘 수 있음
  const preParsed = (req as IncomingMessage & { body?: unknown }).body;
  if (preParsed && typeof preParsed === 'object') return preParsed as Record<string, unknown>;
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return JSON.parse(raw || '{}');
}

// 구글 시트(Apps Script doPost)에 batchOps를 전달하고 실제 결과를 그대로 반환
export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'POST') {
    return send(res, 405, { ok: false, error: 'Method Not Allowed' });
  }
  try {
    const config = getWebhookConfig();
    if (!config) return send(res, 503, { ok: false, error: MISSING_CONFIG_ERROR });
    const body = await readJsonBody(req);
    const resp = await fetch(config.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: config.token,
        spreadsheetId: SPREADSHEET_ID,
        batchOps: body.batchOps || [],
      }),
    });
    const json = (await resp.json()) as { ok?: boolean; error?: string; syncedAt?: string };
    if (!resp.ok || !json.ok) {
      throw new Error(json.error || `웹훅 응답 오류 (HTTP ${resp.status})`);
    }
    return send(res, 200, { ok: true, syncedAt: json.syncedAt || new Date().toISOString() });
  } catch (err) {
    return send(res, 502, {
      ok: false,
      error: err instanceof Error ? err.message : '구글 시트 쓰기 실패',
    });
  }
}
