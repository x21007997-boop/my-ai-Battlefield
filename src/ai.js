export async function askDeepSeekCouncil({ world, report, decision = '', question }) {
  const response = await fetch('/api/ai/council', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ world, report, decision, question }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? '幕僚会商请求失败。');
  return data;
}

export async function generateTurnChronicle({ world, record, previousChronicle = null }) {
  const response = await fetch('/api/ai/chronicle', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ world, record, previousChronicle }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? '回合纪事生成失败。');
  return data;
}
