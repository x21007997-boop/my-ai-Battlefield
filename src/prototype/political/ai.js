export async function askDeepSeekCouncil({ world, report, decision = '', question, scenarioContext }) {
  const response = await fetch('/api/ai/council', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ world, report, decision, question, scenario: scenarioContext }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? '幕僚会商请求失败。');
  return data;
}

export async function generateTurnChronicle({ world, record, previousChronicle = null, scenarioContext }) {
  const response = await fetch('/api/ai/chronicle', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ world, record, previousChronicle, scenario: scenarioContext }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? '回合纪事生成失败。');
  return data;
}

export async function generateEndingNovel({ world, records, chronicles, outcome, scenarioContext }) {
  const response = await fetch('/api/ai/novel', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ world, records, chronicles, outcome, scenario: scenarioContext }) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? '结局小说生成失败。');
  return data;
}
