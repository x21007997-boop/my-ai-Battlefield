import { useEffect, useMemo, useState } from 'react';
import {
  Archive,
  ArrowLeft,
  ArrowRight,
  BookOpenText,
  CaretRight,
  CheckCircle,
  Coins,
  DownloadSimple,
  FloppyDisk,
  GearSix,
  MapPin,
  Question,
  ShieldChevron,
  Sparkle,
  UsersThree,
  Warning,
  Grains,
} from '@phosphor-icons/react';
import { createInitialWorld, DECISION_POSTURES, investigateReport, metricsForView, previewDecision, resolveTurn, serializeSnapshot } from './simulation';
import { currentOutcome, reportsForWorld, stageStatus } from './scenario';
import { askDeepSeekCouncil, generateEndingNovel, generateTurnChronicle } from './ai';
import { appendBranchNode, attachChronicle, buildManuscript, createCampaign, deleteCampaign, duplicateCampaign, getBranchPath, initializeBranchTree, listCampaigns, renameCampaign, saveNamedSnapshot, updateBranchNodeWorld } from './storage';
import { getScenario, SCENARIOS } from './scenarioRegistry';

const advisers = [
  {
    id: 'shi',
    name: '史可法',
    office: '督师',
    stance: '立即调粮',
    tone: 'support',
    text: '江北民心危在旦夕，当先行调粮以安民心，再查转运之弊。',
    image: '/assets/adviser-shi.png',
  },
  {
    id: 'hubu',
    name: '户部尚书',
    office: '钱粮总理',
    stance: '先查账目',
    tone: 'neutral',
    text: '账目混乱，贸然再拨恐重蹈覆辙，宜先厘清流向与责任。',
    image: '/assets/adviser-hubu.png',
  },
  {
    id: 'local',
    name: '地方官员',
    office: '卢之延',
    stance: '就地筹粮',
    tone: 'oppose',
    text: '舟车转运缓不济急，可准州县就地籴买，缓解眼下之急。',
    image: '/assets/adviser-local.png',
  },
];

const factions = [
  { id: 'jiangbei', name: '江北军政', short: '军政' },
  { id: 'finance', name: '户部财政', short: '财权' },
  { id: 'gentry', name: '地方士绅', short: '乡望' },
];

const tutorialSteps = [
  { target: 'briefing', kicker: '第一步 · 读奏报', title: '先判断问题是真是假', body: '奏报提供事件、来源、可信度与矛盾线索。情报点有限，只核查真正关键的信息。' },
  { target: 'map', kicker: '第二步 · 看地图', title: '命令必须落到具体地点', body: '点击城池查看粮草、驻军与动乱。颜色和脉冲表示当地压力，回合后状态会持续保留。' },
  { target: 'council', kicker: '第三步 · 问幕僚', title: '每个建议都有立场', body: '选择一位幕僚查看完整意见并单独追问。采纳或拒绝会逐步改变人物关系与派系力量。' },
  { target: 'decision', kicker: '第四步 · 定策略', title: '同一道命令也有不同风险', body: '稳妥、常规、激进与权谋会改变成本、收益和失败概率。先分析影响，再确认执行。' },
  { target: 'advance', kicker: '最后一步 · 写历史', title: '推进回合，承担后果', body: '结算演出会展示路线、指标、人物反应和新奏报。你的每次选择都会进入历史分支与最终小说。' },
];

const cityPositions = {
  淮安: { left: '44%', top: '25%' },
  扬州: { left: '57%', top: '48%' },
  南京: { left: '53%', top: '68%' },
};

const cinematicCityPositions = {
  淮安: { x: 59, y: 29 },
  扬州: { x: 67, y: 52 },
  南京: { x: 43, y: 75 },
};

function resolutionVisualFor(action) {
  const kinds = {
    transport_grain: { glyph: '粮', theme: 'grain', routeLabel: '漕粮启运', outcomeLabel: '粮道回报' },
    deploy_army: { glyph: '兵', theme: 'army', routeLabel: '大军开拔', outcomeLabel: '军报抵京' },
    appoint_official: { glyph: '使', theme: 'official', routeLabel: '持节赴任', outcomeLabel: '履任回奏' },
  };
  const origin = cinematicCityPositions[action.source] ?? cinematicCityPositions.南京;
  const target = cinematicCityPositions[action.target] ?? cinematicCityPositions.淮安;
  return { ...kinds[action.type], origin, target, path: `M ${origin.x} ${origin.y} L ${target.x} ${target.y}` };
}

function cityCondition(city) {
  if (city.unrest >= 65) return { key: 'critical', label: '局势危急' };
  if (city.unrest >= 45 || city.garrison < 35) return { key: 'strained', label: '局势紧张' };
  return { key: 'stable', label: '局势尚稳' };
}

function relationLabel(value) {
  if (value >= 75) return '倚重';
  if (value >= 55) return '信任';
  if (value >= 35) return '观望';
  return '离心';
}

function Metric({ item }) {
  const Icon = item.icon;
  return (
    <div className="metric">
      <Icon size={26} weight="duotone" aria-hidden="true" />
      <div>
        <span className="metric-label">{item.label}</span>
        <div className="metric-value">{item.value}<small>{item.unit}</small></div>
        <span className={item.delta >= 0 ? 'delta positive' : 'delta negative'}>
          {item.delta >= 0 ? '+' : ''}{item.delta}{item.unit && item.key !== 'support' && item.key !== 'defense' ? '万' : ''}
        </span>
      </div>
    </div>
  );
}

export function App() {
  const [screen, setScreen] = useState('library');
  const [world, setWorld] = useState(createInitialWorld);
  const [branchStore, setBranchStore] = useState(() => initializeBranchTree(createInitialWorld()));
  const [currentNodeId, setCurrentNodeId] = useState(() => {
    const initial = createInitialWorld();
    const store = initializeBranchTree(initial);
    return store.nodes.findLast((node) => node.world?.scenarioId === initial.scenarioId)?.id;
  });
  const [activeRegion, setActiveRegion] = useState('淮安');
  const [focusedCityName, setFocusedCityName] = useState('淮安');
  const [decision, setDecision] = useState('');
  const [postureId, setPostureId] = useState('balanced');
  const [analysis, setAnalysis] = useState(null);
  const [meetingOpen, setMeetingOpen] = useState(false);
  const [selectedAdviserId, setSelectedAdviserId] = useState(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [aiCouncil, setAiCouncil] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [chronicleLoading, setChronicleLoading] = useState(false);
  const [docxLoading, setDocxLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [introStep, setIntroStep] = useState(0);
  const [resolutionReport, setResolutionReport] = useState(null);
  const [endingOpen, setEndingOpen] = useState(false);
  const [endingNovel, setEndingNovel] = useState(null);
  const [novelLoading, setNovelLoading] = useState(false);
  const [saveManagerScenarioId, setSaveManagerScenarioId] = useState(null);
  const [campaignNames, setCampaignNames] = useState({});
  const [tutorialStep, setTutorialStep] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [preferences, setPreferences] = useState(() => {
    const defaults = { motion: 'standard', scale: 1, skipOpening: false };
    try { return { ...defaults, ...JSON.parse(window.localStorage.getItem('hongguang-preferences') ?? '{}') }; } catch { return defaults; }
  });

  useEffect(() => {
    window.localStorage.setItem('hongguang-preferences', JSON.stringify(preferences));
    document.documentElement.dataset.motion = preferences.motion;
    document.documentElement.style.setProperty('--app-scale', preferences.scale);
  }, [preferences]);

  useEffect(() => {
    function handleShortcut(event) {
      const editing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
      if (event.key === 'Escape') {
        setHelpOpen(false); setSettingsOpen(false); setMeetingOpen(false); setHistoryOpen(false);
        return;
      }
      if (screen !== 'simulation') return;
      if (editing || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === '?' || event.key.toLowerCase() === 'h') { event.preventDefault(); setHelpOpen((open) => !open); }
      if (event.key.toLowerCase() === 'g') { event.preventDefault(); setTutorialStep(0); }
      if (event.key.toLowerCase() === 's') { event.preventDefault(); setSettingsOpen(true); }
    }
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [screen]);

  const scenario = useMemo(() => getScenario(world.scenarioId), [world.scenarioId]);
  const dateLabel = scenario.manifest.turnLabels?.[world.turn] ?? `第${world.turn + 1}月`;
  const currentReports = useMemo(() => reportsForWorld(world), [world]);
  const activeReport = currentReports.find((report) => report.region === activeRegion) ?? currentReports[0];
  const focusedCity = world.cities[focusedCityName] ?? world.cities[activeReport.region];
  const focusedCondition = cityCondition(focusedCity);
  const activeIntel = world.intelligence?.reports?.[activeReport.region];
  const outcome = useMemo(() => currentOutcome(world), [world]);
  const stage = useMemo(() => stageStatus(world), [world]);
  const currentBranchNode = useMemo(() => branchStore.nodes.find((node) => node.id === currentNodeId), [branchStore, currentNodeId]);
  const branchChapters = useMemo(() => getBranchPath(branchStore, currentNodeId).filter((node) => node.chronicle), [branchStore, currentNodeId]);
  const metrics = useMemo(() => metricsForView(world, {
    treasury: Coins,
    grain: Grains,
    support: UsersThree,
    defense: ShieldChevron,
  }), [world]);
  const selectedAdviser = advisers.find((item) => item.id === selectedAdviserId) ?? null;
  const resolutionVisual = resolutionReport ? resolutionVisualFor(resolutionReport.record.action) : null;
  const latestAdviserReaction = world.history.at(-1)?.adviserReaction ?? null;
  const latestFactionShift = world.history.at(-1)?.factionShift ?? null;
  const decisionDrafts = useMemo(() => {
    const defaults = scenario.manifest.actionDefaults;
    const target = focusedCityName;
    const drafts = [
      { id: 'grain', label: '调粮赈济', text: `着从${defaults.grainSource}调运二十万石粮草至${target}，一面赈济灾民，一面严查沿途侵耗。` },
      { id: 'army', label: '调兵增援', text: `即从${defaults.armySource}调集十五万兵力增援${target}，整饬城防，不得扰民。` },
      { id: 'official', label: '遣使查办', text: `任命${defaults.official}为钦差，赴${target}核查钱粮军务，限期具奏。` },
    ];
    const preferred = selectedAdviserId === 'shi' ? 'grain' : selectedAdviserId === 'hubu' ? 'official' : selectedAdviserId === 'local' ? 'grain' : null;
    return preferred ? drafts.sort((a, b) => Number(b.id === preferred) - Number(a.id === preferred)) : drafts;
  }, [focusedCityName, scenario.manifest.actionDefaults, selectedAdviserId]);

  function flash(message, duration = 2600) {
    setNotice(message);
    window.setTimeout(() => setNotice(''), duration);
  }

  function startScenario(scenarioId) {
    const nextWorld = createInitialWorld(scenarioId);
    const store = initializeBranchTree(nextWorld);
    const latestNode = store.nodes.findLast((node) => node.world?.scenarioId === scenarioId);
    setWorld(latestNode?.world ?? nextWorld);
    setBranchStore(store);
    setCurrentNodeId(latestNode?.id ?? `root-${scenarioId}`);
    const firstRegion = reportsForWorld(latestNode?.world ?? nextWorld)[0].region;
    setActiveRegion(firstRegion);
    setFocusedCityName(firstRegion);
    setDecision('');
    setPostureId('balanced');
    setAnalysis(null);
    setSelectedAdviserId(null);
    setResolutionReport(null);
    setEndingOpen(false);
    setEndingNovel(null);
    setIntroStep(0);
    if (preferences.skipOpening) enterSimulation(); else setScreen('intro');
  }

  function beginNewCampaign(scenarioId) {
    const nextWorld = createInitialWorld(scenarioId);
    const created = createCampaign(nextWorld, `新推演 · ${new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date())}`);
    setWorld(nextWorld); setBranchStore(created.store); setCurrentNodeId(created.id); setActiveRegion(reportsForWorld(nextWorld)[0].region); setFocusedCityName(reportsForWorld(nextWorld)[0].region); setSaveManagerScenarioId(null); setIntroStep(0);
    if (preferences.skipOpening) enterSimulation(); else setScreen('intro');
  }

  function continueCampaign(campaign) {
    const node = campaign.latest;
    setWorld(node.world); setCurrentNodeId(node.id); setActiveRegion(reportsForWorld(node.world)[0].region); setFocusedCityName(reportsForWorld(node.world)[0].region); setSaveManagerScenarioId(null); setScreen('simulation');
  }

  function enterSimulation() {
    setScreen('simulation');
    if (!window.localStorage.getItem('hongguang-tutorial-complete')) setTutorialStep(0);
  }

  function closeTutorial() {
    window.localStorage.setItem('hongguang-tutorial-complete', '1');
    setTutorialStep(null);
  }

  function analyzeDecision() {
    const preview = previewDecision(world, decision, postureId);
    if (!preview.valid) {
      flash(preview.errors[0], 3000);
      return;
    }
    setAnalysis(preview);
  }

  function investigateActiveReport() {
    try {
      const checked = investigateReport(world, activeReport);
      setWorld(checked.world);
      setBranchStore(updateBranchNodeWorld(currentNodeId, checked.world));
      window.localStorage.setItem('hongguang-autosave', serializeSnapshot(checked.world));
      flash(checked.reused ? '这份奏报已经完成核查。' : `核查完成：${checked.result.verdict}`);
    } catch (error) {
      flash(error.message, 3200);
    }
  }

  function advanceTurn() {
    if (stage.state !== 'ongoing') {
      flash(stage.state === 'defeat' ? `局势已经崩溃：${stage.collapsed.label}跌破生存线。` : '本阶段已经结束，请查看阶段结局。');
      return;
    }
    if (!decision.trim() || !analysis) {
      flash('必须先下达并分析一项决策，才能推进回合。');
      return;
    }
    try {
      const result = resolveTurn(world, decision, postureId);
      const branch = appendBranchNode(currentNodeId, result.world, result.record);
      setWorld(result.world);
      setBranchStore(branch.store);
      setCurrentNodeId(branch.id);
      window.localStorage.setItem('hongguang-autosave', serializeSnapshot(result.world));
      const nextRegion = reportsForWorld(result.world)[0].region;
      setActiveRegion(nextRegion);
      setFocusedCityName(result.record.action.target);
      setResolutionReport({ record: result.record, preview: result.preview });
      flash(`第${result.world.turn + 1}回合结算完成：${result.record.events.at(-1).title}`);
    } catch (error) {
      flash(error.message, 3200);
      return;
    }
    setDecision('');
    setAnalysis(null);
    setPostureId('balanced');
  }

  function saveSnapshot() {
    window.localStorage.setItem('hongguang-manual-save', serializeSnapshot(world));
    const branch = saveNamedSnapshot(currentNodeId, world);
    setBranchStore(branch.store);
    flash(`快照已保存：第${world.turn + 1}回合，共${world.history.length}条决策记录。`);
  }

  function loadBranch(node) {
    setWorld(node.world);
    setCurrentNodeId(node.id);
    setActiveRegion(reportsForWorld(node.world)[0].region);
    setFocusedCityName(reportsForWorld(node.world)[0].region);
    setDecision('');
    setPostureId('balanced');
    setAnalysis(null);
    setResolutionReport(null);
    setEndingOpen(false);
    setEndingNovel(null);
    setHistoryOpen(false);
    flash(`已回到“${node.label}”，下一道决策将创建新的历史分支。`, 3600);
  }

  function formatEffect(key) {
    const value = analysis?.immediate[key] ?? 0;
    return `${value >= 0 ? '+' : ''}${value}`;
  }

  async function consultDeepSeek() {
    setAiLoading(true);
    setAiCouncil(null);
    try {
      const result = await askDeepSeekCouncil({
        world,
        report: activeReport,
        decision,
        question: selectedAdviser
          ? `重点回应${selectedAdviser.name}提出的“${selectedAdviser.stance}”主张，分析其依据、风险并给出可执行修订。`
          : decision.trim() ? '评议这道拟议诏令，并给出可执行修订。' : '根据本月奏报，会商下一步最应优先处理的事务。',
      });
      setAiCouncil(result);
    } catch (error) {
      flash(error.message, 4200);
    } finally {
      setAiLoading(false);
    }
  }

  async function createChronicle() {
    const record = world.history.at(-1);
    if (!record || currentBranchNode?.snapshot) {
      flash('当前节点没有可写成纪事的新回合。');
      return;
    }
    setChronicleLoading(true);
    try {
      const previousChronicle = getBranchPath(branchStore, currentNodeId).filter((node) => node.chronicle && node.id !== currentNodeId).at(-1)?.chronicle ?? null;
      const chronicle = await generateTurnChronicle({ world, record, previousChronicle });
      setBranchStore(attachChronicle(currentNodeId, chronicle));
      flash(`《${chronicle.chapterTitle}》已经收入本分支卷宗。`, 3800);
    } catch (error) {
      flash(error.message, 4200);
    } finally {
      setChronicleLoading(false);
    }
  }

  function downloadManuscript() {
    const markdown = buildManuscript(branchStore, currentNodeId);
    const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `弘光元年-江南残局-${branchChapters.length}章.md`;
    link.click();
    URL.revokeObjectURL(url);
    flash(`本分支 ${branchChapters.length} 篇纪事已汇编下载。`);
  }

  async function downloadDocx() {
    setDocxLoading(true);
    try {
      const { downloadBranchDocx } = await import('./docxExport');
      await downloadBranchDocx({ store: branchStore, nodeId: currentNodeId, world });
      flash(`Word 小说卷宗已生成，共 ${branchChapters.length} 章。`);
    } catch (error) {
      flash(error.message, 3800);
    } finally {
      setDocxLoading(false);
    }
  }

  async function createEndingNovel() {
    setNovelLoading(true);
    try {
      const records = world.history.map((record) => ({ turnAfter: record.turnAfter, decision: record.rawDecision, posture: record.posture?.label, effects: record.effects, events: record.events.map((event) => ({ title: event.title, detail: event.detail })) }));
      const chronicles = branchChapters.map((node) => ({ chapterTitle: node.chronicle.chapterTitle, fullText: node.chronicle.fullText }));
      const novel = await generateEndingNovel({ world, records, chronicles, outcome });
      setEndingNovel(novel);
      flash(`长篇小说《${novel.title}》已经完成。`, 4200);
    } catch (error) {
      flash(error.message, 4500);
    } finally {
      setNovelLoading(false);
    }
  }

  async function downloadEndingNovel() {
    if (!endingNovel) return;
    setDocxLoading(true);
    try {
      const { downloadGeneratedNovelDocx } = await import('./docxExport');
      await downloadGeneratedNovelDocx({ novel: endingNovel, world });
      flash(`《${endingNovel.title}》Word 小说已经生成。`);
    } catch (error) {
      flash(error.message, 3800);
    } finally {
      setDocxLoading(false);
    }
  }

  if (screen === 'library') {
    return (
      <main className="scenario-library">
        <div className="library-map" aria-hidden="true" />
        <header className="library-header">
          <div><small>历史分支推演平台</small><h1>择一局，重写未定之史</h1></div>
          <p>每个剧本拥有独立世界状态、事件链、结局与小说卷宗。你的旧存档会保留在对应剧本中。</p>
        </header>
        <section className="scenario-grid">
          {SCENARIOS.map((item, index) => {
            const savedNodes = branchStore.nodes.filter((node) => node.world?.scenarioId === item.manifest.id);
            const latest = savedNodes.at(-1);
            return (
              <article className={`scenario-card ${item.manifest.cover.accent}`} key={item.manifest.id}>
                <div className="scenario-number">卷 {String(index + 1).padStart(2, '0')}</div>
                <small>{item.manifest.cover.kicker}</small>
                <h2>{item.manifest.title}</h2>
                <p>{item.manifest.description}</p>
                <div className="scenario-meta"><span>{item.cities.length} 座城池</span><span>{item.events.length} 个阶段事件</span><span>{item.endings.length} 种结局</span></div>
                <footer>
                  <div><b>{item.manifest.cover.status}</b><span>{latest && latest.world.turn > item.manifest.startTurn ? `已有存档 · 第${latest.world.turn + 1}回合` : '尚未开局'}</span></div>
                  <div className="scenario-card-actions"><button onClick={() => beginNewCampaign(item.manifest.id)}>新建</button><button onClick={() => setSaveManagerScenarioId(item.manifest.id)}>存档</button><button className="primary" onClick={() => startScenario(item.manifest.id)}>{latest && latest.world.turn > item.manifest.startTurn ? '继续推演' : '进入此局'}<CaretRight size={18} /></button></div>
                </footer>
              </article>
            );
          })}
        </section>
        <div className="library-note">剧本数据已经与规则引擎分离 · 新历史片段无需改动核心结算</div>
        {saveManagerScenarioId && (
          <div className="modal-backdrop save-manager-backdrop" onMouseDown={() => setSaveManagerScenarioId(null)}>
            <section className="meeting-modal save-manager" role="dialog" aria-modal="true" aria-labelledby="save-manager-title" onMouseDown={(event) => event.stopPropagation()}>
              <div className="meeting-heading"><div><small>推演存档</small><h2 id="save-manager-title">{getScenario(saveManagerScenarioId).manifest.title}</h2></div><button onClick={() => setSaveManagerScenarioId(null)}>关闭</button></div>
              <button className="new-campaign-button" onClick={() => beginNewCampaign(saveManagerScenarioId)}>＋ 新建一局推演</button>
              <div className="campaign-list">
                {listCampaigns(branchStore, saveManagerScenarioId).map((campaign) => (
                  <article key={campaign.id}>
                    <div><input value={campaignNames[campaign.id] ?? campaign.name} onChange={(event) => setCampaignNames({ ...campaignNames, [campaign.id]: event.target.value })} /><button onClick={() => { const store = renameCampaign(campaign.id, campaignNames[campaign.id] ?? campaign.name); setBranchStore(store); flash('存档名称已更新。'); }}>改名</button></div>
                    <p>第 {campaign.latest.world.turn + 1} 回合 · {campaign.nodeCount} 个历史节点</p>
                    <small>更新于 {new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(campaign.updatedAt))}</small>
                    <footer><button onClick={() => continueCampaign(campaign)}>继续</button><button onClick={() => { const copied = duplicateCampaign(campaign.id); setBranchStore(copied.store); }}>复制分支</button><button className="danger" onClick={() => { if (window.confirm(`确定删除“${campaign.name}”及其全部历史分支吗？`)) setBranchStore(deleteCampaign(campaign.id)); }}>删除</button></footer>
                  </article>
                ))}
                {!listCampaigns(branchStore, saveManagerScenarioId).length && <p className="empty-history">尚无存档，可以新建第一局推演。</p>}
              </div>
            </section>
          </div>
        )}
      </main>
    );
  }

  if (screen === 'intro') {
    const introCards = [
      { eyebrow: '弘光元年 · 五月', title: '北都既覆，江山只余半壁', body: '清军沿运河南下，江北各镇互不统属。南京朝堂仍在争论名分，而军粮已经见底。' },
      { eyebrow: '急递 · 淮安', title: '粮仓告急，饥民聚于城下', body: '官仓只够支应数日。开仓，可能断绝前线军粮；不开仓，民变或将在今夜发生。' },
      { eyebrow: '御前 · 等候裁决', title: '历史不会等待准备周全的人', body: '银子、粮草、民心与军力彼此牵动。你下达的每一道命令，都将成为后来史书中的一句话。' },
    ];
    const card = introCards[introStep];
    return (
      <main className={`opening-cinematic opening-step-${introStep}`}>
        <div className="opening-map" aria-hidden="true" />
        <div className="opening-vignette" aria-hidden="true" />
        <button className="opening-back" onClick={() => setScreen('library')}><ArrowLeft size={18} /> 返回选局</button>
        <section className="opening-copy" key={introStep}>
          <small>{card.eyebrow}</small>
          <h1>{card.title}</h1>
          <p>{card.body}</p>
          <div className="opening-progress">{introCards.map((_, index) => <i key={index} className={index <= introStep ? 'active' : ''} />)}</div>
          <div className="opening-actions">
            <button className="opening-skip" onClick={enterSimulation}>跳过序章</button>
            <button className="opening-next" onClick={() => introStep < introCards.length - 1 ? setIntroStep(introStep + 1) : enterSimulation()}>
              {introStep < introCards.length - 1 ? '继续' : '入局执政'} <CaretRight size={19} />
            </button>
          </div>
        </section>
        <div className="opening-seal">弘<br />光</div>
      </main>
    );
  }

  return (
    <main className="simulator-shell">
      <header className="topbar">
        <button className="brand" onClick={() => setScreen('library')} title="返回剧本选择">
          <ArrowLeft size={20} />
          <span>{scenario.manifest.title}</span>
          <i>局</i>
        </button>
        <div className="turn-label">弘光元年　{dateLabel} · 第{world.turn + 1}回合 <small>{stage.remainingTurns > 0 ? `还余 ${stage.remainingTurns} 回合` : '阶段已结算'}</small></div>
        <div className="header-actions">
          <button className="ghost-button guide-button" onClick={() => setTutorialStep(0)}>新手引导</button>
          <button className="ghost-button help-button" onClick={() => setHelpOpen(true)} title="帮助与快捷键（H）"><Question size={20} /></button>
          <button className="ghost-button settings-button" onClick={() => setSettingsOpen(true)}><GearSix size={20} /> 体验设置</button>
          <button className="ghost-button" onClick={saveSnapshot}>
            <FloppyDisk size={20} /> 保存快照
          </button>
          <button className={`advance-button ${tutorialStep !== null && tutorialSteps[tutorialStep].target === 'advance' ? 'tutorial-focus' : ''}`} onClick={() => stage.state === 'ongoing' ? advanceTurn() : setEndingOpen(true)}>
            {stage.state === 'ongoing' ? '推进一月' : '查看结局'} <CaretRight size={20} weight="bold" />
          </button>
        </div>
      </header>

      <section className="workspace">
        <aside className="metrics-rail" aria-label="天下指标">
          <section className={`stage-objective stage-${stage.state}`}>
            <div><small>阶段目标</small><b>{stage.remainingTurns} 回合</b></div>
            {stage.targets.map((target) => <p key={target.key} className={target.met ? 'met' : ''}><span>{target.label} ≥ {target.target}</span><strong>{target.value}</strong></p>)}
            <footer>{stage.collapsed ? `${stage.collapsed.label}已跌破生存线` : stage.allTargetsMet ? '当前已满足全部目标' : '守住底线，完成三项目标'}</footer>
          </section>
          {metrics.map((metric) => <Metric key={metric.key} item={metric} />)}
          <button className="archive-link" onClick={() => setHistoryOpen(true)}><Archive size={20} /> 查看推演档案</button>
        </aside>

        <section className={`map-panel ${tutorialStep !== null && tutorialSteps[tutorialStep].target === 'map' ? 'tutorial-focus' : ''}`} aria-label="江南江北态势图">
          <img src="/assets/jiangnan-map.png" alt="江南与江北历史区域态势图" />
          <div className="map-wash" />
          <div className="frontline frontline-north"><span>清军南下压力</span></div>
          {Object.entries(world.cities).map(([name, city]) => {
            const selected = name === focusedCityName;
            const condition = cityCondition(city);
            const recent = world.history.at(-1)?.action.target === name;
            return (
              <button
                className={`marker city-marker ${selected ? 'selected' : ''} ${condition.key} ${recent ? 'recent' : ''}`}
                style={cityPositions[name]}
                key={name}
                onClick={() => {
                  setFocusedCityName(name);
                  if (currentReports.some((report) => report.region === name)) setActiveRegion(name);
                }}
                aria-label={`查看${name}态势`}
              >
                {condition.key !== 'stable' ? <Warning size={22} weight="fill" /> : <MapPin size={22} weight="fill" />}
                <span><b>{name}</b><small>粮 {city.grain} · 军 {city.garrison} · 乱 {city.unrest}</small></span>
              </button>
            );
          })}
          <div className="map-focus-card">
            <small>当前关注</small>
            <strong>{focusedCityName}</strong>
            <span>{focusedCondition.label} · {focusedCity.controller}</span>
            <div><i>粮 {focusedCity.grain}</i><i>军 {focusedCity.garrison}</i><i>乱 {focusedCity.unrest}</i></div>
          </div>
          <div className="map-legend">
            <span><i className="legend-dot ours" />我方治所</span>
            <span><i className="legend-dot event" />事件</span>
            <span><i className="legend-dot pressure" />民生压力</span>
          </div>
        </section>

        <aside className={`briefing-panel ${tutorialStep !== null && tutorialSteps[tutorialStep].target === 'briefing' ? 'tutorial-focus' : ''}`}>
          <div className="scroll-head"><span>本月奏报</span></div>
          <div className="report-tabs">
            {currentReports.map((report) => (
              <button key={report.id} className={activeReport.id === report.id ? 'active' : ''} onClick={() => { setActiveRegion(report.region); setFocusedCityName(report.region); }}>
                {report.region}
              </button>
            ))}
          </div>
          <article className="report-content">
            <div className="report-title-row">
              <h2>{activeReport.title}</h2>
              <span>可信度：{activeReport.confidence}</span>
            </div>
            <p className="sender">上报官员：{activeReport.sender}</p>
            <p>{activeReport.summary}</p>
            <div className="contradiction"><Warning size={17} weight="fill" /> 矛盾提示：{activeReport.contradiction}</div>
            <div className="intel-actions">
              <button onClick={investigateActiveReport} disabled={activeIntel?.reportTitle === activeReport.title}>
                {activeIntel?.reportTitle === activeReport.title ? '已完成核查' : `派员核查 · 情报点 ${world.intelligence?.points ?? 3}`}
              </button>
              {activeIntel?.reportTitle === activeReport.title && <span className={`intel-verdict verdict-${activeIntel.verdict}`}>{activeIntel.verdict}</span>}
            </div>
            {activeIntel?.reportTitle === activeReport.title && <p className="intel-detail">{activeIntel.detail}</p>}
          </article>

          <div className="causal-line">
            <span>粮运受阻</span><ArrowRight /><span>粮价上涨</span><ArrowRight /><span>民心下降</span>
          </div>

          {world.pendingEffects.length > 0 && (
            <section className="pending-consequences">
              <div><small>待发后效</small><span>{world.pendingEffects.length} 项</span></div>
              {world.pendingEffects.slice(0, 2).map((item) => (
                <p key={`${item.dueTurn}-${item.label}`}><b>{item.label}</b><span>第 {item.dueTurn + 1} 回合揭晓</span></p>
              ))}
            </section>
          )}

          <section className="faction-balance">
            <div><small>朝局势力</small>{latestFactionShift && <span>{latestFactionShift.title}</span>}</div>
            {factions.map((faction) => {
              const value = world.factionInfluence?.[faction.id] ?? 50;
              return <p key={faction.id}><b>{faction.name}</b><i><em style={{ width: `${value}%` }} /></i><span>{value}</span></p>;
            })}
          </section>

          {outcome && (
            <section className="outcome-card">
              <small>三月阶段结局</small>
              <strong>{outcome.outcome}</strong>
              <p>{outcome.detail}</p>
            </section>
          )}

          <section className={`council ${tutorialStep !== null && tutorialSteps[tutorialStep].target === 'council' ? 'tutorial-focus' : ''}`}>
            <div className="section-title"><span />幕僚会商<span /></div>
            {advisers.map((adviser) => (
              <button
                className={`adviser-row ${selectedAdviserId === adviser.id ? 'selected' : ''} ${latestAdviserReaction?.adviserId === adviser.id ? 'reacting' : ''}`}
                key={adviser.id}
                aria-pressed={selectedAdviserId === adviser.id}
                onClick={() => setSelectedAdviserId(adviser.id)}
              >
                <img src={adviser.image} alt={`${adviser.name}画像`} />
                <div className="adviser-copy">
                  <div><strong>{adviser.name}</strong><small>{adviser.office}</small><b className={adviser.tone}>{adviser.stance}</b></div>
                  <p>{adviser.text}</p>
                  <em className="relation-meter"><i style={{ width: `${world.adviserRelations?.[adviser.id] ?? 50}%` }} /><span>{relationLabel(world.adviserRelations?.[adviser.id] ?? 50)} {world.adviserRelations?.[adviser.id] ?? 50}</span></em>
                  {latestAdviserReaction?.adviserId === adviser.id && <em className={`reaction-badge ${latestAdviserReaction.tone}`}>{latestAdviserReaction.title}</em>}
                </div>
              </button>
            ))}
            {selectedAdviser && (
              <div className="selected-adviser-opinion" role="status">
                <div><strong>{selectedAdviser.name}的完整意见</strong><button onClick={() => setSelectedAdviserId(null)}>收起</button></div>
                <p>{selectedAdviser.text}</p>
              </div>
            )}
            <div className="council-actions">
              <button
                className={selectedAdviser ? 'ready' : ''}
                disabled={!selectedAdviser}
                onClick={() => { setAiCouncil(null); setMeetingOpen(true); }}
              >{selectedAdviser ? `追问${selectedAdviser.name}` : '先选择一位幕僚'}</button>
              <button className="meeting-button" onClick={() => { setSelectedAdviserId(null); setAiCouncil(null); setMeetingOpen(true); }}><UsersThree size={18} />召集会议</button>
            </div>
          </section>
        </aside>
      </section>

      <section className={`decision-desk ${tutorialStep !== null && tutorialSteps[tutorialStep].target === 'decision' ? 'tutorial-focus' : ''}`}>
        <BookOpenText size={28} weight="duotone" aria-hidden="true" />
        <div className="decision-compose">
          <div className="decision-toolbar">
            <div className="posture-picker" aria-label="决策风险偏好">
              {Object.values(DECISION_POSTURES).map((posture) => <button key={posture.id} className={postureId === posture.id ? 'active' : ''} onClick={() => { setPostureId(posture.id); setAnalysis(null); }} title={posture.riskLabel}>{posture.label}</button>)}
            </div>
            <div className="decision-drafts" aria-label="可编辑诏令草案"><small>诏令草案</small>{decisionDrafts.map((draft) => <button key={draft.id} title={draft.text} onClick={() => { setDecision(draft.text); setAnalysis(null); }}>{draft.label}</button>)}</div>
          </div>
          <textarea value={decision} onChange={(event) => { setDecision(event.target.value); setAnalysis(null); }} placeholder="下达你的诏令、政策或处置意见……" />
        </div>
        <button onClick={analyzeDecision}><Sparkle size={22} weight="fill" />分析影响</button>
      </section>

      {tutorialStep !== null && (
        <div className={`tutorial-layer tutorial-${tutorialSteps[tutorialStep].target}`}>
          <section className="tutorial-card" role="dialog" aria-modal="true" aria-labelledby="tutorial-title">
            <small>{tutorialSteps[tutorialStep].kicker}</small><h2 id="tutorial-title">{tutorialSteps[tutorialStep].title}</h2><p>{tutorialSteps[tutorialStep].body}</p>
            <div className="tutorial-progress">{tutorialSteps.map((_, index) => <i key={index} className={index <= tutorialStep ? 'active' : ''} />)}</div>
            <footer><button onClick={closeTutorial}>跳过引导</button><button onClick={() => tutorialStep < tutorialSteps.length - 1 ? setTutorialStep(tutorialStep + 1) : closeTutorial()}>{tutorialStep < tutorialSteps.length - 1 ? '下一步' : '开始执政'}<CaretRight size={17} /></button></footer>
          </section>
        </div>
      )}

      {settingsOpen && (
        <div className="settings-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setSettingsOpen(false)}>
          <section className="settings-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title">
            <header><div><small>御前起居注 · 体验设置</small><h2 id="settings-title">依你的习惯入局</h2></div><button aria-label="关闭设置" onClick={() => setSettingsOpen(false)}>×</button></header>
            <div className="setting-row"><div><strong>演出节奏</strong><span>控制转场、地图与结算动画</span></div><div className="setting-options">{[['fast', '利落'], ['standard', '从容'], ['slow', '沉浸'], ['reduced', '减少动态']].map(([value, label]) => <button key={value} className={preferences.motion === value ? 'active' : ''} onClick={() => setPreferences({ ...preferences, motion: value })}>{label}</button>)}</div></div>
            <div className="setting-row"><div><strong>界面尺度</strong><span>适应不同尺寸的书案与屏幕</span></div><div className="setting-options">{[[.9, '紧凑'], [1, '标准'], [1.08, '舒展']].map(([value, label]) => <button key={value} className={preferences.scale === value ? 'active' : ''} onClick={() => setPreferences({ ...preferences, scale: value })}>{label}</button>)}</div></div>
            <label className="setting-toggle"><div><strong>新局跳过序章</strong><span>直接进入地图；首次使用仍会显示操作引导</span></div><input type="checkbox" checked={preferences.skipOpening} onChange={(event) => setPreferences({ ...preferences, skipOpening: event.target.checked })} /><i /></label>
            <div className="settings-utilities"><button onClick={() => document.documentElement.requestFullscreen?.()}>进入全屏</button><button onClick={() => { window.localStorage.removeItem('hongguang-tutorial-complete'); setSettingsOpen(false); setTutorialStep(0); }}>重看新手引导</button></div>
            <footer><button onClick={() => setPreferences({ motion: 'standard', scale: 1, skipOpening: false })}>恢复默认</button><button onClick={() => setSettingsOpen(false)}>保存并返回</button></footer>
          </section>
        </div>
      )}

      {helpOpen && (
        <div className="help-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setHelpOpen(false)}>
          <section className="help-panel" role="dialog" aria-modal="true" aria-labelledby="help-title">
            <header><div><small>御前备忘 · 操作指南</small><h2 id="help-title">这一月该如何裁决</h2></div><button aria-label="关闭帮助" onClick={() => setHelpOpen(false)}>×</button></header>
            <ol className="help-flow">
              <li><b>一</b><div><strong>读奏报，辨虚实</strong><span>先看来源与可信度；存疑的情报可消耗情报点核查。</span></div></li>
              <li><b>二</b><div><strong>看地图，定落点</strong><span>比较各城粮草、驻军和动乱，选择命令真正作用的地点。</span></div></li>
              <li><b>三</b><div><strong>问幕僚，识立场</strong><span>意见背后关联人物关系和派系利益，可选择一人继续追问。</span></div></li>
              <li><b>四</b><div><strong>写诏令，选手段</strong><span>输入自由决策，选择风险姿态，先分析影响再确认执行。</span></div></li>
            </ol>
            <div className="shortcut-grid"><span><kbd>H</kbd>帮助</span><span><kbd>G</kbd>新手引导</span><span><kbd>S</kbd>体验设置</span><span><kbd>Esc</kbd>关闭浮层</span></div>
            <footer><button onClick={() => { setHelpOpen(false); setTutorialStep(0); }}>进入分步引导</button><button onClick={() => setHelpOpen(false)}>我已明白</button></footer>
          </section>
        </div>
      )}

      {analysis && (
        <section className="analysis-bar" aria-live="polite">
          <strong><Sparkle size={18} />决策预演</strong>
          <span>国库 {formatEffect('treasury')}</span>
          <span>粮草 {formatEffect('grain')}</span>
          <span className={analysis.immediate.support >= 0 ? 'positive' : 'negative'}>民心 {formatEffect('support')}</span>
          <span className={analysis.immediate.defense >= 0 ? 'positive' : 'negative'}>防务 {formatEffect('defense')}</span>
          <span>{analysis.risk}</span>
          <button onClick={advanceTurn}><CheckCircle size={18} />确认执行</button>
        </section>
      )}

      {resolutionReport && (
        <div className="resolution-backdrop" role="presentation">
          <section className={`resolution-stage resolution-${resolutionVisual.theme}`} role="dialog" aria-modal="true" aria-labelledby="resolution-title">
            <div className="resolution-map" aria-hidden="true">
              <img src="/assets/jiangnan-map.png" alt="" />
              <span className="route-caption">{resolutionVisual.routeLabel}</span>
              <span className="route-origin" style={{ left: `${resolutionVisual.origin.x}%`, top: `${resolutionVisual.origin.y}%` }}>{resolutionReport.record.action.source}</span>
              <svg className="supply-route" viewBox="0 0 100 100" preserveAspectRatio="none"><path d={resolutionVisual.path} /></svg>
              <span className="route-cargo" style={{ '--origin-x': `${resolutionVisual.origin.x}%`, '--origin-y': `${resolutionVisual.origin.y}%`, '--target-x': `${resolutionVisual.target.x}%`, '--target-y': `${resolutionVisual.target.y}%` }}><b>{resolutionVisual.glyph}</b></span>
              <span className="route-target" style={{ left: `${resolutionVisual.target.x}%`, top: `${resolutionVisual.target.y}%` }}>{resolutionReport.record.action.target}</span>
            </div>
            <div className="resolution-scroll">
              <small>第 {resolutionReport.record.turnAfter + 1} 回合 · 奉旨施行</small>
              <h2 id="resolution-title">{resolutionReport.preview.title}</h2>
              <span className={`resolution-posture posture-${resolutionReport.record.posture?.id ?? 'balanced'}`}>{resolutionReport.record.posture?.label ?? '常规'}路线 · {resolutionReport.record.posture?.riskLabel}</span>
              <p className="resolution-command">“{resolutionReport.record.rawDecision}”</p>
              <div className="resolution-seal" aria-hidden="true">准</div>
              <div className="resolution-effects">
                {Object.entries(resolutionReport.record.effects).map(([key, value]) => {
                  const labels = { treasury: '国库', grain: '粮草', support: '民心', defense: '防务' };
                  return <div key={key}><span>{labels[key]}</span><strong className={value >= 0 ? 'positive' : 'negative'}>{value >= 0 ? '+' : ''}{value}</strong></div>;
                })}
              </div>
              <div className="resolution-relations">
                <small>人物态度变化</small>
                <div>{advisers.map((adviser) => {
                  const delta = resolutionReport.record.relationEffects?.[adviser.id] ?? 0;
                  return <span key={adviser.id}>{adviser.name}<b className={delta >= 0 ? 'positive' : 'negative'}>{delta >= 0 ? '+' : ''}{delta}</b></span>;
                })}</div>
              </div>
              <div className="resolution-factions">
                <small>派系力量变化</small>
                <div>{factions.map((faction) => {
                  const delta = resolutionReport.record.factionEffects?.[faction.id] ?? 0;
                  return <span key={faction.id}>{faction.short}<b className={delta >= 0 ? 'positive' : 'negative'}>{delta >= 0 ? '+' : ''}{delta}</b></span>;
                })}</div>
                {resolutionReport.record.factionShift && <p>{resolutionReport.record.factionShift.title}：{resolutionReport.record.factionShift.detail}</p>}
              </div>
              {resolutionReport.record.adviserReaction && (
                <article className={`resolution-reaction ${resolutionReport.record.adviserReaction.tone}`}>
                  <small>幕僚主动反应</small>
                  <h3>{resolutionReport.record.adviserReaction.title}</h3>
                  <p>{resolutionReport.record.adviserReaction.detail}</p>
                </article>
              )}
              {resolutionReport.record.postureEvent && (
                <article className="resolution-reaction obstruction">
                  <small>路线风险兑现</small>
                  <h3>{resolutionReport.record.postureEvent.title}</h3>
                  <p>{resolutionReport.record.postureEvent.detail}</p>
                </article>
              )}
              <article className="resolution-news">
                <small>{resolutionVisual.outcomeLabel}</small>
                <h3>{resolutionReport.record.events.at(-1).title}</h3>
                <p>{resolutionReport.record.events.at(-1).detail}</p>
              </article>
              <div className="resolution-aftereffect"><span>后效将在下一阶段结算</span><b>{resolutionReport.preview.delayed.label}</b></div>
              {resolutionReport.record.intelligenceBonus > 0 && <div className="resolution-intel"><CheckCircle size={15} weight="fill" />目标情报已核验，本次执行成功率获得修正</div>}
              <div className={`resolution-stage-status state-${stage.state}`}>
                <span>{stage.remainingTurns > 0 ? `距阶段结算还剩 ${stage.remainingTurns} 回合` : '阶段已经结算'}</span>
                <b>{stage.collapsed ? `${stage.collapsed.label}跌破生存线` : stage.targets.filter((item) => item.met).length === stage.targets.length ? '全部目标已达成' : `已达成 ${stage.targets.filter((item) => item.met).length}/${stage.targets.length} 项目标`}</b>
              </div>
              <button onClick={() => { setResolutionReport(null); if (stage.state !== 'ongoing') setEndingOpen(true); }}><CheckCircle size={19} weight="fill" /> {stage.state === 'ongoing' ? '收入起居注，继续执政' : '收入起居注，查看结局'}</button>
            </div>
          </section>
        </div>
      )}

      {endingOpen && (
        <div className="ending-backdrop">
          <section className={`ending-stage ending-${stage.state}`} role="dialog" aria-modal="true" aria-labelledby="ending-title">
            <div className="ending-map">
              <img src="/assets/jiangnan-map.png" alt="本阶段终局态势图" />
              <div><small>本阶段终局</small><strong>{outcome?.outcome ?? (stage.state === 'defeat' ? '大局倾覆' : '江山未定')}</strong><p>{outcome?.detail ?? (stage.collapsed ? `${stage.collapsed.label}跌破生存线，朝局已经无法维持。` : '三个月的抉择已经写入历史，但真正的结局仍在后方。')}</p></div>
            </div>
            <div className="ending-scroll">
              <header><small>阶段结算 · 第 {world.turn + 1} 回合</small><h2 id="ending-title">{scenario.manifest.title}</h2><span>{stage.state === 'victory' ? '目标达成' : stage.state === 'defeat' ? '提前崩盘' : '带伤存续'}</span></header>
              <div className="ending-goals">{stage.targets.map((target) => <div key={target.key} className={target.met ? 'met' : ''}><span>{target.label}</span><strong>{target.value}</strong><small>目标 {target.target}</small></div>)}</div>
              <section className="ending-section"><h3>人物归心</h3><div className="ending-people">{advisers.map((adviser) => { const value = world.adviserRelations?.[adviser.id] ?? 50; return <span key={adviser.id}><b>{adviser.name}</b><i>{relationLabel(value)} · {value}</i></span>; })}</div></section>
              <section className="ending-section"><h3>朝局余波</h3><div className="ending-people">{factions.map((faction) => <span key={faction.id}><b>{faction.name}</b><i>影响力 {world.factionInfluence?.[faction.id] ?? 50}</i></span>)}</div></section>
              <section className="ending-section"><h3>关键诏令</h3><ol>{world.history.slice(-3).map((record) => <li key={record.id}><span>第 {record.turnAfter + 1} 回合</span><p>{record.rawDecision}</p><b>{record.events.at(-1).title}</b></li>)}</ol></section>
              {endingNovel && <section className="ending-novel"><small>AI 长篇小说</small><h3>《{endingNovel.title}》</h3><p>{endingNovel.subtitle}</p><div><span>{endingNovel.chapters.length} 章正文</span><span>{endingNovel.characterEndings.length} 位人物结局</span></div><blockquote>{endingNovel.epilogue.slice(0, 140)}……</blockquote></section>}
              <div className="ending-actions">
                <button onClick={createEndingNovel} disabled={novelLoading}>{novelLoading ? 'DeepSeek 正在撰写……' : endingNovel ? '重新生成长篇' : '生成结局小说'}</button>
                <button onClick={downloadEndingNovel} disabled={!endingNovel || docxLoading}><DownloadSimple size={18} />{docxLoading ? '正在排版……' : '下载小说 DOCX'}</button>
                <button onClick={() => { setEndingOpen(false); setHistoryOpen(true); }}><Archive size={18} />查看完整档案</button>
                <button onClick={() => { setEndingOpen(false); setScreen('library'); }}><BookOpenText size={18} />返回剧本库</button>
              </div>
            </div>
          </section>
        </div>
      )}

      {meetingOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setMeetingOpen(false)}>
          <section className="meeting-modal" role="dialog" aria-modal="true" aria-labelledby="meeting-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="meeting-heading">
              <div><small>{selectedAdviser ? '单独奏对' : '御前会议'}</small><h2 id="meeting-title">{selectedAdviser ? `追问${selectedAdviser.name}` : '江北赈粮处置'}</h2></div>
              <button onClick={() => setMeetingOpen(false)}>关闭</button>
            </div>
            <p className="meeting-intro">{selectedAdviser ? `${selectedAdviser.name}主张“${selectedAdviser.stance}”。你可以让其进一步解释依据、风险与执行细节。` : '三位幕僚意见相左。你可以综合意见，在下方形成最终裁决。'}</p>
            <div className="meeting-people">
              {advisers.map((adviser) => <div key={adviser.id}><img src={adviser.image} alt="" /><strong>{adviser.name}</strong><span>{adviser.stance}</span></div>)}
            </div>
            <button className="ai-council-button" onClick={consultDeepSeek} disabled={aiLoading}>
              <Sparkle size={18} weight="fill" />{aiLoading ? 'DeepSeek 正在会商……' : '请 DeepSeek 综合会商'}
            </button>
            {aiCouncil && (
              <section className="ai-council-result">
                <div><small>AI 会商摘要</small><span>{aiCouncil.model}</span></div>
                <p>{aiCouncil.summary}</p>
                <ul>
                  {aiCouncil.advisers?.map((item) => <li key={`${item.name}-${item.stance}`}><strong>{item.name} · {item.stance}</strong><span>{item.reason}</span><em>风险：{item.risk}</em></li>)}
                </ul>
                <button onClick={() => { setDecision(aiCouncil.recommendedDecision); setAnalysis(null); setMeetingOpen(false); }}>采用建议诏令：{aiCouncil.recommendedDecision}</button>
                <small>信息缺口：{aiCouncil.uncertainty}</small>
              </section>
            )}
            <button className="adopt-button" onClick={() => { setDecision('先调拨二十万石粮草稳住江北民心，同时命户部核验沿途账目，十日内复奏。'); setMeetingOpen(false); }}>
              形成折中裁决
            </button>
          </section>
        </div>
      )}

      {historyOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setHistoryOpen(false)}>
          <section className="meeting-modal history-modal" role="dialog" aria-modal="true" aria-labelledby="history-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="meeting-heading">
              <div><small>推演档案</small><h2 id="history-title">弘光元年决策实录</h2></div>
              <button onClick={() => setHistoryOpen(false)}>关闭</button>
            </div>
            <div className="world-summary">
              <span>当前第 {world.turn + 1} 回合</span>
              <span>规则版本 {world.ruleVersion}</span>
              <span>待结算后效 {world.pendingEffects.length} 项</span>
            </div>
            <div className="chronicle-actions">
              <button onClick={createChronicle} disabled={chronicleLoading || !world.history.length}><Sparkle size={17} weight="fill" />{chronicleLoading ? '史官正在撰写……' : currentBranchNode?.chronicle ? '重新生成本回合纪事' : '生成本回合纪事'}</button>
              <button onClick={downloadDocx} disabled={!branchChapters.length || docxLoading}><DownloadSimple size={17} />{docxLoading ? '正在排版……' : '下载 Word 卷宗'}</button>
              <button onClick={downloadManuscript} disabled={!branchChapters.length}><DownloadSimple size={17} />下载 Markdown</button>
            </div>
            {currentBranchNode?.chronicle && (
              <article className="chronicle-reader">
                <small>第 {branchChapters.length} 章</small>
                <h3>{currentBranchNode.chronicle.chapterTitle}</h3>
                <p>{currentBranchNode.chronicle.fullText}</p>
                <footer>伏笔：{currentBranchNode.chronicle.foreshadowing}</footer>
              </article>
            )}
            {world.history.length === 0 ? (
              <p className="empty-history">尚无正式决策。你的第一道诏令会记录在这里。</p>
            ) : (
              <ol className="history-list">
                {[...world.history].reverse().map((record) => (
                  <li key={record.id}>
                    <div><strong>第 {record.turnAfter + 1} 回合</strong><span>{record.events.at(-1).title}</span></div>
                    <p>{record.rawDecision}</p>
                    <small>国库 {record.effects.treasury >= 0 ? '+' : ''}{record.effects.treasury}　粮草 {record.effects.grain >= 0 ? '+' : ''}{record.effects.grain}　民心 {record.effects.support >= 0 ? '+' : ''}{record.effects.support}　防务 {record.effects.defense >= 0 ? '+' : ''}{record.effects.defense}</small>
                  </li>
                ))}
              </ol>
            )}
            <div className="section-title branch-title"><span />历史分支<span /></div>
            <div className="branch-tree">
              {branchStore.nodes.filter((node) => node.world?.scenarioId === world.scenarioId).map((node) => (
                <button key={node.id} className={node.id === currentNodeId ? 'current' : ''} onClick={() => loadBranch(node)} style={{ '--branch-depth': Math.min(node.world.history.length, 4) }}>
                  <i />
                  <span><strong>{node.label}</strong><small>{node.decision ?? (node.snapshot ? '手动保存的世界快照' : '剧本起点')}</small></span>
                  <b>{node.id === currentNodeId ? '当前' : '从此继续'}</b>
                </button>
              ))}
            </div>
          </section>
        </div>
      )}

      {notice && <div className="toast" role="status">{notice}</div>}
    </main>
  );
}
