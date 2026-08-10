import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { handleDeepSeek, handleDeepSeekChronicle } from "./server/deepseek.js";

function deepSeekDevApi(env) {
  return {
    name: 'deepseek-dev-api',
    configureServer(server) {
      server.middlewares.use('/api/ai', async (req, res) => {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const pathname = `/api/ai${req.url?.split('?')[0] ?? ''}`;
        const request = new Request(`http://localhost${pathname}`, { method: req.method, headers: req.headers, body: chunks.length ? Buffer.concat(chunks) : undefined });
        const handler = pathname === '/api/ai/chronicle' ? handleDeepSeekChronicle : handleDeepSeek;
        const response = await handler(request, { apiKey: env.DEEPSEEK_API_KEY, model: env.DEEPSEEK_MODEL });
        res.statusCode = response.status;
        response.headers.forEach((value, key) => res.setHeader(key, value));
        res.end(Buffer.from(await response.arrayBuffer()));
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return ({
  build: {
    outDir: "dist/client",
  },
  optimizeDeps: {
    include: ["react", "react-dom/client"],
  },
  server: {
    host: "0.0.0.0",
    allowedHosts: ["terminal.local"],
    warmup: {
      clientFiles: ["./src/main.jsx"],
    },
  },
  plugins: [react(), deepSeekDevApi(env)],
  });
});
