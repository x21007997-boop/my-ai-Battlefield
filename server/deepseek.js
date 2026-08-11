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

  const context = payload.scenario ?? {};
  const defaults = context.actionDefaults ?? { grainTarget: '淮安', armyTarget: '扬州', official: '史可法' };
  const system = `你是历史推演剧本《${context.title ?? '弘光元年：江南残局'}》的御前会商主持人。必须严格扮演所提供的幕僚人物，只根据剧本背景和世界状态提出建议，不能混入其他剧本的人物，不能直接修改正式指标。请输出 json 对象，严格包含：summary（80字以内）、advisers（三项，每项含name、stance、reason、risk）、recommendedDecision、uncertainty（信息缺口）。recommendedDecision 必须只有一个动作，且严格仿照以下一种句式：\"调拨二十万石粮草赈济${defaults.grainTarget}\"、\"调动五万兵力增援${defaults.armyTarget}\"、\"派遣${defaults.official}前往${defaults.armyTarget}查办\"；不得把调粮、调兵、派官合并在一句中。不输出 markdown。`;
  const user = JSON.stringify({ scenario: context, world: compactWorld(payload.world), currentReport: payload.report, proposedDecision: payload.decision, question: payload.question });

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

  const system = `你是历史架空小说《${payload.scenario?.title ?? '弘光元年：江南残局'}》的执笔史官。根据确定性规则结算记录，把一个回合写成克制、可信、具有晚明气息的纪事。只使用所提供剧本中的人物和派系，不得改变给定指标、事件和决策，不得把未知信息写成事实。输出 json，严格包含 chapterTitle、opening、courtScene、executionScene、consequence、foreshadowing、fullText。fullText 必须为1000至1500个中文字符的完整章节，包含场景、人物动作、对话和后果，不能写成摘要；其余字段为对应段落摘要。不要输出 markdown。`;
  const user = JSON.stringify({ scenario: payload.scenario, worldAfter: compactWorld(payload.world), turnRecord: record, previousChronicle: payload.previousChronicle ? { chapterTitle: payload.previousChronicle.chapterTitle, foreshadowing: payload.previousChronicle.foreshadowing } : null });
  return requestDeepSeekJson({ apiKey, model, fetchImpl, system, user, maxTokens: 3200, temperature: 0.65, validate: (content) => content.chapterTitle && content.fullText?.length >= 700 && content.foreshadowing, failureMessage: 'DeepSeek 连续两次未返回达到篇幅要求的回合纪事，请稍后重试。' });
}

export async function handleDeepSeekNovel(request, { apiKey, model = 'deepseek-v4-flash', fetchImpl = fetch } = {}) {
  if (request.method !== 'POST') return json({ error: '仅支持 POST 请求。' }, 405);
  if (!apiKey) return json({ error: '服务端尚未配置 DEEPSEEK_API_KEY。' }, 503);
  let payload;
  try { payload = await request.json(); } catch { return json({ error: '请求内容不是有效 JSON。' }, 400); }
  if (!payload?.world || !Array.isArray(payload?.records) || !payload.records.length) return json({ error: '缺少完整历史分支记录。' }, 400);
  const system = `你是架空历史长篇小说《${payload.scenario?.title ?? '弘光元年历史推演'}》的总撰稿人。只能依据给定剧本中的人物与派系、玩家决策、规则结算、人物关系和结局写作，不得串入其他剧本人物，不得篡改正式结果。输出 json，严格包含 title、subtitle、prologue、chapters、characterEndings、epilogue。chapters 为数组，每项含 title、text，必须覆盖每一个回合并保持因果连续；characterEndings 为数组，每项含 name、ending。prologue 600至900字，每章1000至1500字，epilogue 700至1000字，整体采用克制可信的晚明历史小说风格，包含场景、行动与对话，不输出 markdown。`;
  const user = JSON.stringify({
    scenario: payload.scenario,
    finalWorld: { ...compactWorld(payload.world), adviserRelations: payload.world.adviserRelations, factionInfluence: payload.world.factionInfluence },
    outcome: payload.outcome,
    records: payload.records,
    existingChronicles: payload.chronicles ?? [],
  });
  return requestDeepSeekJson({ apiKey, model, fetchImpl, system, user, maxTokens: 7000, temperature: 0.7, validate: (content) => content.title && content.prologue?.length >= 300 && Array.isArray(content.chapters) && content.chapters.length > 0 && Array.isArray(content.characterEndings) && content.epilogue?.length >= 300, failureMessage: 'DeepSeek 连续两次未返回完整的结局小说，请稍后重试。' });
}
