import type { IncomingMessage, ServerResponse } from 'http';
import { clearSessionCookie, send } from '../_lib.js';

export default function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'Method Not Allowed' });
  clearSessionCookie(res);
  return send(res, 200, { ok: true });
}
