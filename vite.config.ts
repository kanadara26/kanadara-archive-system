import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';

const SPREADSHEET_ID = '1fGq9OKWroDBovIlkvdrkYmDFZp-HTkeJem5sirv6vvs';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'kanadara-gsheets-bridge',
      configureServer(server) {
        server.middlewares.use('/api/gsheets/push', (req, res) => {
          if (req.method !== 'POST') {
            res.statusCode = 405;
            res.end(JSON.stringify({ ok: false, error: 'Method Not Allowed' }));
            return;
          }
          let body = '';
          req.on('data', (chunk) => {
            body += chunk;
          });
          req.on('end', () => {
            try {
              const parsed = JSON.parse(body || '{}');
              const batchOps = parsed.batchOps || [];
              const tmpFile = path.join(os.tmpdir(), 'kanadara_gsheets_batch.json');
              fs.writeFileSync(tmpFile, JSON.stringify(batchOps, null, 2), 'utf-8');

              const mirrorDir = path.resolve(process.cwd(), 'public');
              if (!fs.existsSync(mirrorDir)) {
                fs.mkdirSync(mirrorDir, { recursive: true });
              }
              const mirrorPath = path.join(mirrorDir, 'gsheets_live_mirror.json');
              fs.writeFileSync(
                mirrorPath,
                JSON.stringify(
                  {
                    spreadsheetId: SPREADSHEET_ID,
                    updatedAt: new Date().toISOString(),
                    batchOps,
                  },
                  null,
                  2
                ),
                'utf-8'
              );

              let cliMode = 'MIRROR_SYNC';
              try {
                execSync(`gsheets mutate batch ${SPREADSHEET_ID} -f "${tmpFile}"`, {
                  stdio: 'pipe',
                  timeout: 8000,
                });
                cliMode = 'LIVE_GSHEETS_CLI';
              } catch {
                // Fallback to mirror sync when daemon process does not hold interactive CLI token
                cliMode = 'MIRROR_SYNC';
              }

              res.setHeader('Content-Type', 'application/json');
              res.end(
                JSON.stringify({
                  ok: true,
                  mode: cliMode,
                  spreadsheetId: SPREADSHEET_ID,
                  syncedAt: new Date().toISOString(),
                })
              );
            } catch (err) {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(
                JSON.stringify({
                  ok: false,
                  error: err instanceof Error ? err.message : 'Unknown error',
                })
              );
            }
          });
        });

        server.middlewares.use('/api/gsheets/pull', (_req, res) => {
          try {
            let rateTsv = '';
            let promoTsv = '';
            let cliMode = 'MIRROR_SYNC';
            try {
              rateTsv = execSync(
                `gsheets readonly read ${SPREADSHEET_ID} "'05_요율표_마스터'!A1:M300"`,
                { encoding: 'utf-8', stdio: 'pipe', timeout: 8000 }
              );
              promoTsv = execSync(
                `gsheets readonly read ${SPREADSHEET_ID} "'06_카드사별_프로모션_마스터'!A1:S200"`,
                { encoding: 'utf-8', stdio: 'pipe', timeout: 8000 }
              );
              cliMode = 'LIVE_GSHEETS_CLI';
            } catch {
              const mirrorPath = path.resolve(process.cwd(), 'public', 'gsheets_live_mirror.json');
              if (fs.existsSync(mirrorPath)) {
                const raw = JSON.parse(fs.readFileSync(mirrorPath, 'utf-8'));
                const ops = raw.batchOps || [];
                const rateOp = ops.find((o: { range?: string }) =>
                  String(o.range || '').includes('05_요율표_마스터')
                );
                const promoOp = ops.find((o: { range?: string }) =>
                  String(o.range || '').includes('06_카드사별_프로모션_마스터')
                );
                if (rateOp?.data) {
                  rateTsv = rateOp.data
                    .map((r: unknown[]) => r.map((c) => String(c ?? '')).join('\t'))
                    .join('\n');
                }
                if (promoOp?.data) {
                  promoTsv = promoOp.data
                    .map((r: unknown[]) => r.map((c) => String(c ?? '')).join('\t'))
                    .join('\n');
                }
              }
            }

            res.setHeader('Content-Type', 'application/json');
            res.end(
              JSON.stringify({
                ok: true,
                mode: cliMode,
                spreadsheetId: SPREADSHEET_ID,
                rateTsv,
                promoTsv,
                pulledAt: new Date().toISOString(),
              })
            );
          } catch (err) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(
              JSON.stringify({
                ok: false,
                error: err instanceof Error ? err.message : 'Unknown error',
              })
            );
          }
        });
      },
    },
  ],
  server: {
    port: 5173,
    host: true,
  },
});
