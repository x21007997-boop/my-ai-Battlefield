const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function compactWorld(world) {
  return {
    turn: world.turn,
    metrics: world.metrics,
    cities: world.cities,
    flags: world.flags,
    recentHistory: world.history?.slice(-2).map((record) => ({ decision: record.rawDecision, events: record.events.map((event) => event.title) })),
  };
}

async function requestDeepSeekJson({ apiKey, model, fetchImpl, system, user, maxTokens = 1200, temperature = 0.3, validate, failureMessage }) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let upstream;
    try {
      upstream = await fetchImpl('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: `${user}\n务必直接输出完整 json，不要使用代码块。${attempt ? '\n上一次输出未达到字段或篇幅要求，这次必须完整重写并满足全部约束。' : ''}` }], response_format: { type: 'json_object' }, thinking: { type: 'disabled' }, max_tokens: maxTokens, temperature }),
      });
    } catch {
      if (attempt === 1) return json({ error: '暂时无法连接 DeepSeek。' }, 502);
      continue;
    }
    const result = await upstream.json().catch(() => ({}));
    if (!upstream.ok) return json({ error: result?.error?.message ?? `DeepSeek 请求失败（${upstream.status}）。` }, upstream.status);
    try {
      const raw = result.choices?.[0]?.message?.content?.trim() ?? '';
      const normalized = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
      const content = JSON.parse(normalized);
      if (!validate(content)) throw new Error('missing fields');
      return json({ ...content, model: result.model ?? model, usage: result.usage ?? null });
    } catch {
      if (attempt === 1) return json({ error: failureMessage }, 502);
    }
  }
  return json({ error: failureMessage }, 502);
}

export async function handleDeepSeek(request, { apiKey, model = 'deepseek-v4-flash', fetchImpl = fetch } = {}) {
  if (request.method !== 'POST') return json({ error: '仅支持 POST 请求。' }, 405);
  if (!apiKey) return json({ error: '服务端尚未配置 DEEPSEEK_API_KEY。' }, 503);

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: '请求内容不是有效 JSON。' }, 400);
  }
  if (!payload?.world || typeof payload?.question !== 'string') return json({ error: '缺少世界状态或会商问题。' }, 400);

  const system = `你是弘光元年南明朝廷的御前会商主持人。你只能根据提供的世界状态提出历史情境内的建议，不能直接修改任何正式指标。请输出 json 对象，严格包含：summary（80字以内）、advisers（三项，每项含name、stance、reason、risk）、recommendedDecision、uncertainty（信息缺口）。recommendedDecision 必须只有一个动作，且严格仿照以下一种句式：\"调拨二十万石粮草赈济淮安\"、\"调动五万兵力增援扬州\"、\"派遣史可法前往淮安查办\"；不得把调粮、调兵、派官合并在一句中。不输出 markdown。`;
  const user = JSON.stringify({ world: compactWorld(payload.world), currentReport: payload.report, proposedDecision: payload.decision, question: payload.question });

  return requestDeepSeekJson({ apiKey, model, fetchImpl, system, user, validate: (content) => content.summary && content.recommendedDecision && Array.isArray(content.advisers), failureMessage: 'DeepSeek 连续两次未返回完整结构化会商结果，请稍后重试。' });
}

export async function handleDeepSeekChronicle(request, { apiKey, model = 'deepseek-v4-flash', fetchImpl = fetch } = {}) {
  if (request.method !== 'POST') return json({ error: '仅支持 POST 请求。' }, 405);
  if (!apiKey) return json({ error: '服务端尚未配置 DEEPSEEK_API_KEY。' }, 503);
  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: '请求内容不是有效 JSON。' }, 400);
  }
  const record = payload?.record;
  if (!payload?.world || !record?.rawDecision) return json({ error: '缺少世界状态或回合记录。' }, 400);

  const system = `你是历史架空小说《弘光元年：江南残局》的执笔史官。根据确定性规则结算记录，把一个回合写成克制、可信、具有晚明气息的纪事。不得改变给定指标、事件和决策，不得把未知信息写成事实。输出 json，严格包含 chapterTitle、opening、courtScene、executionScene、consequence、foreshadowing、fullText。fullText 必须为1000至1500个中文字符的完整章节，包含场景、人物动作、对话和后果，不能写成摘要；其余字段为对应段落摘要。不要输出 markdown。`;
  const user = JSON.stringify({ worldAfter: compactWorld(payload.world), turnRecord: record, previousChronicle: payload.previousChronicle ? { chapterTitle: payload.previousChronicle.chapterTitle, foreshadowing: payload.previousChronicle.foreshadowing } : null });
  return requestDeepSeekJson({ apiKey, model, fetchImpl, system, user, maxTokens: 3200, temperature: 0.65, validate: (content) => content.chapterTitle && content.fullText?.length >= 700 && content.foreshadowing, failureMessage: 'DeepSeek 连续两次未返回达到篇幅要求的回合纪事，请稍后重试。' });
}
