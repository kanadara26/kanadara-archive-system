import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // 로컬 개발: .env.local의 GSHEETS_* 값을 API 핸들러(process.env)에 전달
  Object.assign(process.env, loadEnv(mode, process.cwd(), 'GSHEETS_'));

  return {
    plugins: [
      react(),
      {
        // 로컬 개발 서버에서도 Vercel과 동일한 api/gsheets/*.ts 핸들러를 실행
        name: 'kanadara-api-dev',
        configureServer(server) {
          server.middlewares.use(async (req, res, next) => {
            const match = req.url?.match(/^\/api\/gsheets\/(pull|push)(?:\?|$)/);
            if (!match) return next();
            try {
              const mod = await server.ssrLoadModule(`/api/gsheets/${match[1]}.ts`);
              await mod.default(req, res);
            } catch (err) {
              next(err);
            }
          });
        },
      },
    ],
    server: {
      port: 5173,
      host: true,
    },
  };
});
