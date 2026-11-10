import type { IncomingMessage, ServerResponse } from 'http';
import fs from 'fs';
import path from 'path';

export default function handler(_req: IncomingMessage, res: ServerResponse) {
  try {
    const mirrorPath = path.resolve(process.cwd(), 'public', 'gsheets_live_mirror.json');
    if (fs.existsSync(mirrorPath)) {
      const mirror = JSON.parse(fs.readFileSync(mirrorPath, 'utf8'));
      const ops = mirror.batchOps || [];
      const rateOp = ops.find((o: { range?: string }) =>
        String(o.range || '').includes('05_요율표_마스터')
      );
      const promoOp = ops.find((o: { range?: string }) =>
        String(o.range || '').includes('06_카드사별_프로모션_마스터')
      );
      const usersOp = ops.find((o: { range?: string }) =>
        String(o.range || '').includes('09_사용자_CM_마스터')
      );

      const rateTsv = rateOp?.data
        ? rateOp.data.map((r: unknown[]) => r.map((c) => String(c ?? '')).join('\t')).join('\n')
        : '';
      const promoTsv = promoOp?.data
        ? promoOp.data.map((r: unknown[]) => r.map((c) => String(c ?? '')).join('\t')).join('\n')
        : '';
      const usersTsv = usersOp?.data
        ? usersOp.data.map((r: unknown[]) => r.map((c) => String(c ?? '')).join('\t')).join('\n')
        : '';

      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.end(
        JSON.stringify({
          ok: true,
          cliMode: 'VERCEL_MIRROR',
          rateTsv,
          promoTsv,
          usersTsv,
        })
      );
    }

    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify({ ok: false, error: 'Mirror not found' }));
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
}
