import type { IncomingMessage, ServerResponse } from 'http';
import { getWebhookConfig, MISSING_CONFIG_ERROR, send } from './_webhook';

// 구글 시트(Apps Script doGet)에서 05~09 탭을 실시간으로 읽어 그대로 전달
export default async function handler(_req: IncomingMessage, res: ServerResponse) {
  const config = getWebhookConfig();
  if (!config) return send(res, 503, { ok: false, error: MISSING_CONFIG_ERROR });
  try {
    const resp = await fetch(`${config.url}?token=${encodeURIComponent(config.token)}`);
    const json = (await resp.json()) as { ok?: boolean; data?: unknown; error?: string };
    if (!resp.ok || !json.ok || !json.data) {
      throw new Error(json.error || `웹훅 응답 오류 (HTTP ${resp.status})`);
    }
    return send(res, 200, { ok: true, data: json.data });
  } catch (err) {
    return send(res, 502, {
      ok: false,
      error: err instanceof Error ? err.message : '구글 시트 읽기 실패',
    });
  }
}
