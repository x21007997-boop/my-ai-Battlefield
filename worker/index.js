import { handleDeepSeek, handleDeepSeekChronicle, handleDeepSeekNovel } from '../server/deepseek.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/ai/council') {
      return handleDeepSeek(request, { apiKey: env.DEEPSEEK_API_KEY, model: env.DEEPSEEK_MODEL });
    }
    if (url.pathname === '/api/ai/chronicle') {
      return handleDeepSeekChronicle(request, { apiKey: env.DEEPSEEK_API_KEY, model: env.DEEPSEEK_MODEL });
    }
    if (url.pathname === '/api/ai/novel') {
      return handleDeepSeekNovel(request, { apiKey: env.DEEPSEEK_API_KEY, model: env.DEEPSEEK_MODEL });
    }
    const response = await env.ASSETS.fetch(request);
    const acceptsHtml = request.headers.get("accept")?.includes("text/html");

    if (response.status !== 404 || !acceptsHtml || !["GET", "HEAD"].includes(request.method)) {
      return response;
    }

    const indexUrl = new URL(request.url);
    indexUrl.pathname = "/index.html";
    indexUrl.search = "";
    return env.ASSETS.fetch(new Request(indexUrl, request));
  },
};
