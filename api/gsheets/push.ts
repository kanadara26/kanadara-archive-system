import type { IncomingMessage, ServerResponse } from 'http';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import os from 'os';

const SPREADSHEET_ID = '1fGq9OKWroDBovIlkvdrkYmDFZp-HTkeJem5sirv6vvs';

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify({ ok: false, error: 'Method Not Allowed' }));
  }

  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
  });

  req.on('end', async () => {
    try {
      const parsed = JSON.parse(body || '{}');
      const batchOps = parsed.batchOps || [];
      const webhookUrl =
        parsed.webhookUrl ||
        process.env.GSHEETS_WEBHOOK_URL ||
        process.env.VITE_GSHEETS_WEBHOOK_URL;
      let mode = 'MIRROR_FALLBACK';

      // 1. If Google Apps Script Webhook URL is configured, forward batchOps directly to Google Sheets
      if (webhookUrl) {
        try {
          const resp = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              spreadsheetId: SPREADSHEET_ID,
              batchOps,
            }),
          });
          if (resp.ok) {
            mode = 'WEBHOOK_DIRECT';
          }
        } catch {
          // If webhook fails, continue to CLI or local mirror
        }
      }

      // 2. If running locally with gsheets CLI available, execute mutate batch
      if (mode !== 'WEBHOOK_DIRECT') {
        try {
          const tmpFile = path.join(os.tmpdir(), `knd_batch_${Date.now()}.json`);
          fs.writeFileSync(tmpFile, JSON.stringify(batchOps, null, 2), 'utf-8');
          execSync(`gsheets mutate batch ${SPREADSHEET_ID} -f "${tmpFile}"`, {
            stdio: 'pipe',
            timeout: 25000,
          });
          mode = 'LIVE_GSHEETS_CLI';
          try {
            fs.unlinkSync(tmpFile);
          } catch {}
        } catch {
          // CLI unavailable (e.g. Vercel serverless environment)
        }
      }

      // 3. Update public mirror file if disk is writable
      try {
        const mirrorPath = path.resolve(process.cwd(), 'public', 'gsheets_live_mirror.json');
        let existingMirror: Record<string, unknown> = {};
        if (fs.existsSync(mirrorPath)) {
          try {
            existingMirror = JSON.parse(fs.readFileSync(mirrorPath, 'utf-8'));
          } catch {}
        }
        fs.writeFileSync(
          mirrorPath,
          JSON.stringify(
            {
              ...existingMirror,
              spreadsheetId: SPREADSHEET_ID,
              updatedAt: new Date().toISOString(),
              batchOps,
            },
            null,
            2
          ),
          'utf-8'
        );
      } catch {
        // Read-only filesystem in serverless
      }

      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.end(
        JSON.stringify({
          ok: true,
          mode,
          spreadsheetId: SPREADSHEET_ID,
          syncedAt: new Date().toISOString(),
        })
      );
    } catch (err: unknown) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.end(
        JSON.stringify({
          ok: false,
          error: err instanceof Error ? err.message : 'Unknown error',
        })
      );
    }
  });
}
