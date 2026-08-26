import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Broadcast,
  Campfire,
  CastleTurret,
  CaretRight,
  Crosshair,
  Eye,
  FastForward,
  FlagBanner,
  FlagPennant,
  MapPin,
  Mountains,
  Pause,
  Play,
  Question,
  RoadHorizon,
  ShieldChevron,
  WaveSine,
} from '@phosphor-icons/react';
import { buildCommanderMapModel, cancelOrder, createBattleWorld, dispatchReconnaissance, issueDeception, issueOrder, stepBattle, viewBelief } from '../../battlefield/index.js';
import { BATTLEFIELD_CONFIG } from '../../battlefield/config.js';
import { CHANGPING_PROFILE } from '../../battlefield/changpingScenario.js';

const FIXTURE_AREAS = [
  { id: 'north', name: '北坡营地', terrain: '高地', position: { x: 31, y: 26 }, neighbors: [{ id: 'valley', travelSeconds: 6 }] },
  { id: 'valley', name: '谷地通道', terrain: '通路', position: { x: 54, y: 55 }, neighbors: [{ id: 'north', travelSeconds: 6 }, { id: 'ridge', travelSeconds: 8 }] },
  { id: 'ridge', name: '东侧山脊', terrain: '山脊', position: { x: 75, y: 29 }, neighbors: [{ id: 'valley', travelSeconds: 8 }] },
];

const FIXTURE_UNITS = [
  { id: 'qin-forward', side: 'player', name: '秦军前锋', unitType: '步骑混编', commanderId: 'bai-qi', location: 'north', strength: 38000, morale: 74, fatigue: 18, supplyDays: 6, readiness: .86 },
  { id: 'qin-reserve', side: 'player', name: '秦军后队', unitType: '辎重护军', commanderId: 'bai-qi', location: 'north', strength: 16000, morale: 68, fatigue: 9, supplyDays: 9, readiness: .92 },
  { id: 'zhao-main', side: 'enemy', name: '赵军主力', unitType: '步军', commanderId: 'zhao-kuo', location: 'valley', strength: 42000, morale: 63, fatigue: 28, supplyDays: 4, readiness: .74 },
  { id: 'zhao-scout', side: 'enemy', name: '赵军前出侦骑', unitType: '侦骑', commanderId: 'zhao-kuo', location: 'ridge', strength: 6000, morale: 70, fatigue: 12, supplyDays: 5, readiness: .9 },
];

function createFixtureWorld() {
  return createBattleWorld({
    scenarioId: 'battlefield-test-fixture',
    seed: 1645,
    areas: FIXTURE_AREAS,
    units: FIXTURE_UNITS,
    sides: [
      { id: 'player', name: '秦军' },
      { id: 'enemy', name: '赵军' },
    ],
  });
}

const FIXTURE_PROFILE = {
  id: 'fixture',
  title: '战场内核验证关',
  kicker: '战场认知沙盘 · 内核接入验证',
  badge: '开发测试夹具',
  dataNote: '只显示我方已知信息。敌军位置来自侦报，不读取世界真值。',
  mapTitle: '北坡—谷地—东侧山脊',
  mapNote: '沙盘示意图 · 仅用于内核联调',
  mapConfig: { coordinateSystem: BATTLEFIELD_CONFIG.coordinateSystem, bounds: BATTLEFIELD_CONFIG.mapBounds },
  playerName: '秦军态势',
  playerSideLabel: '秦军',
  enemySideLabel: '赵军',
  areas: FIXTURE_AREAS,
  mapMarkers: [
    { areaId: 'north', type: 'camp', label: '营垒' },
    { areaId: 'valley', type: 'pass', label: '通道' },
    { areaId: 'ridge', type: 'highland', label: '山脊' },
  ],
  commandDelaySeconds: BATTLEFIELD_CONFIG.defaults.commanderCommandDelaySeconds,
  scout: {
    targetUnitId: 'zhao-scout',
    reportedAreaId: 'valley',
    actualAreaId: 'ridge',
    delaySeconds: BATTLEFIELD_CONFIG.defaults.scoutReportDelaySeconds,
    confidence: 'medium',
    sourceType: '前出侦骑',
    observation: '发现赵军前出侦骑活动，判断其位于谷地通道。',
  },
  initialUnitId: 'qin-forward',
  createWorld: createFixtureWorld,
};

const MAP_ICON_BY_TYPE = {
  camp: Campfire,
  fortress: CastleTurret,
  pass: FlagPennant,
  route: RoadHorizon,
  valley: WaveSine,
  highland: Mountains,
};

const HIDDEN_FROM_COMMANDER_EVENTS = new Set(BATTLEFIELD_CONFIG.hiddenEventTypes);

function isVisibleToCommander(event) {
  if (HIDDEN_FROM_COMMANDER_EVENTS.has(event.type)) return false;
  if (event.side && event.side !== 'player') return false;
  if (['observation_created', 'report_arrived', 'report_expired'].includes(event.type)) return event.observerSide === 'player';
  return true;
}

function mapMarkerIcon(type) {
  return MAP_ICON_BY_TYPE[type] ?? MapPin;
}

function confidenceLabel(confidence) {
  if (confidence === 'high') return '高可信';
  if (confidence === 'low') return '低可信';
  return '中可信';
}

function confidenceShort(confidence) {
  if (confidence === 'high') return '高';
  if (confidence === 'low') return '低';
  return '中';
}

function uncertaintyLabel(report) {
  const uncertainty = report?.uncertainty ?? {};
  if (uncertainty.label) return uncertainty.label;
  if ((uncertainty.level ?? report?.confidence) === 'high') return '误差较小';
  if ((uncertainty.level ?? report?.confidence) === 'low') return '可能偏离附近区域';
  return '可能偏离相邻区域';
}

function candidateAreaLabel(report, areas) {
  const candidateIds = report?.uncertainty?.candidateAreaIds ?? [];
  const names = candidateIds.map((areaId) => areas[areaId]?.name).filter(Boolean);
  return names.length > 1 ? names.join('、') : '报告区域附近';
}

function deceptionDeliveryLabel(deception, world) {
  if (deception.status === 'exposed') return '已暴露 · 未进入敌方认知';
  if (deception.status === 'preparing') return `准备中 · 余 ${Math.max(0, (deception.readyAt ?? world.simTime) - world.simTime)} 秒`;
  const observation = world.observations.find((item) => item.id === deception.observationId);
  if (!observation || observation.status === 'in_transit') {
    const remaining = observation ? Math.max(0, observation.arrivesAt - world.simTime) : null;
    return remaining == null ? '待传递' : `传递中 · 余 ${remaining} 秒`;
  }
  if (observation.status === 'delivered') return '已送达敌方认知';
  return observation.status;
}

function formatClock(seconds) {
  const hours = String(Math.floor(seconds / 3600)).padStart(2, '0');
  const minutes = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
  const rest = String(seconds % 60).padStart(2, '0');
  return `${hours}:${minutes}:${rest}`;
}

function orderStatus(order) {
  if (order.status === 'transmitting') return '传递中';
  if (order.status === 'executing') return '执行中';
  if (order.status === 'completed') return '已完成';
  if (order.status === 'cancelled') return '已取消';
  if (order.status === 'blocked') return '被封锁';
  return order.status;
}

function resourceLabel(key) {
  return BATTLEFIELD_CONFIG.resourceLabels?.[key] ?? ({ intelligencePoints: '情报点', scoutTeams: '侦察队', deceptionAssets: '计策资源' }[key] ?? key);
}

function canAfford(resources, cost = {}) {
  return Object.entries(cost ?? {}).every(([key, amount]) => Number(resources?.[key] ?? 0) >= Number(amount ?? 0));
}

function resourceCostText(cost = {}) {
  return Object.entries(cost ?? {}).filter(([, amount]) => Number(amount) > 0).map(([key, amount]) => `${resourceLabel(key)} ${amount}`).join(' · ');
}

function eventText(event, world) {
  const unit = world.units[event.unitId];
  const area = world.areas[event.areaId ?? event.targetAreaId ?? event.reportedAreaId];
  if (event.type === 'order_issued') return `已发令：${unit?.name ?? event.unitId} → ${area?.name ?? event.targetAreaId}`;
  if (event.type === 'order_delivered') return `命令抵达：${unit?.name ?? event.unitId} 已收到指令`;
  if (event.type === 'unit_arrived') return `部队到达：${unit?.name ?? event.unitId} 进入${area?.name ?? event.areaId}`;
  if (event.type === 'order_completed') return `命令完成：${unit?.name ?? event.unitId} 暂守原地`;
  if (event.type === 'observation_created') return event.sourceType === 'frontline-report' ? '前线来报：疑似接敌报告正在返回指挥部' : '侦查派出：报告正在返回指挥部';
  if (event.type === 'reconnaissance_issued') return `侦查已接收：斥候准备中，${Math.max(0, (event.readyAt ?? world.simTime) - world.simTime)} 秒后出发`;
  if (event.type === 'reconnaissance_prepared') return '侦查准备完成：斥候已出发，等待回报';
  if (event.type === 'reconnaissance_exposed') return '侦查受阻：斥候行迹暴露，回报可信度下降';
  if (event.type === 'reconnaissance_dispatched') return '侦查已出发：报告正在返回指挥部';
  if (event.type === 'report_arrived') return `情报抵达：${area?.name ?? event.areaId}出现${event.sourceType === 'frontline-report' ? '疑似敌情' : '侦报标记'} · ${confidenceLabel(event.confidence)} · ${uncertaintyLabel(event)}`;
  if (event.type === 'report_expired') return `情报失效：${area?.name ?? event.areaId}的敌情标记已超过有效时限`;
  if (event.type === 'deception_issued') return event.status === 'preparing' ? '计策已接收：正在准备，尚未送入敌方认知' : `计策发出：敌方将收到关于${area?.name ?? event.reportedAreaId}的疑似情报`;
  if (event.type === 'deception_prepared') return '计策准备完成：正在向敌方认知投放';
  if (event.type === 'deception_exposed') return '计策暴露：敌方可能识破了这次误导';
  if (event.type === 'strategy_reliability_reduced') return `计策可信度下降：当前约 ${Math.round((event.reliability ?? 0) * 100)}%`;
  if (event.type === 'order_cancelled') return `命令取消：${unit?.name ?? event.unitId}`;
  if (event.type === 'supply_consumed') return `后勤：${unit?.name ?? event.unitId} 消耗一日补给，余 ${event.after} 天`;
  if (event.type === 'supply_depleted') return `缺粮：${unit?.name ?? event.unitId} 补给耗尽，士气与战力开始下降`;
  if (event.type === 'battle_ended') return `战役结束：${event.result}（${event.reason}）`;
  return `内核事件：${event.type}`;
}

function formatUnitStrength(unit) {
  return `${unit.strength.toLocaleString()} ${unit.strengthUnit}`;
}

function UnitBadge({ unit, className = '' }) {
  return (
    <div className={`battle-unit-badge ${className}`}>
      <span className="unit-dot" aria-hidden="true" />
      <div><strong>{unit.name}</strong><small>{formatUnitStrength(unit)} · 士气 {unit.morale}</small></div>
    </div>
  );
}

export function BattlefieldPrototype({ mode = 'fixture', onBack = () => { window.location.href = '/'; } }) {
  const profile = mode === 'changping' ? CHANGPING_PROFILE : FIXTURE_PROFILE;
  const [world, setWorld] = useState(profile.createWorld);
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [selectedUnitId, setSelectedUnitId] = useState(profile.initialUnitId);
  const [notice, setNotice] = useState('请选择部队和目标区域，观察命令如何经过传递后才开始执行。');
  const [noticeTone, setNoticeTone] = useState('info');

  function notify(message, tone = 'success') {
    setNotice(message);
    setNoticeTone(tone);
  }

  const belief = useMemo(() => viewBelief(world, 'player'), [world]);
  const mapModel = useMemo(() => buildCommanderMapModel(world, {
    side: 'player',
    mapAsset: profile.mapAsset ?? '/assets/jiangnan-map.png',
    mapTitle: profile.mapTitle,
    mapNote: profile.mapNote,
    mapConfig: profile.mapConfig,
    mapMarkers: profile.mapMarkers,
    terrainFeatures: profile.mapTerrainFeatures,
  }), [world, profile]);
  const ownUnits = belief.ownUnits;
  const selectedUnit = world.units[selectedUnitId] ?? ownUnits[0];
  const activeOrders = world.orders.filter((order) => ['transmitting', 'executing'].includes(order.status));
  const inTransitReports = world.observations.filter((observation) => observation.status === 'in_transit');
  const preparingStrategies = (world.strategy?.actions ?? []).filter((action) => action.side === 'player' && action.status === 'preparing');
  const resources = world.resources?.player ?? {};
  const deceptionActions = Object.values(world.deception?.actions ?? {});
  const deceptionHistory = (world.deception?.history ?? []).filter((item) => item.side === 'player');
  const recentEvents = world.eventLog.filter(isVisibleToCommander).slice(-9).reverse();
  const battleEnded = world.status === 'ended';

  useEffect(() => {
    if (!running) return undefined;
    const timer = window.setInterval(() => setWorld((current) => stepBattle(current, speed)), 500);
    return () => window.clearInterval(timer);
  }, [running, speed]);

  useEffect(() => {
    if (battleEnded) setRunning(false);
  }, [battleEnded]);

  function issueMove(targetAreaId) {
    if (!selectedUnit) return;
    const result = issueOrder(world, {
      type: 'move',
      unitId: selectedUnit.id,
      targetAreaId,
      rawText: `向${world.areas[targetAreaId].name}移动`,
    }, { delaySeconds: profile.commandDelaySeconds });
    if (result.error) {
      notify(result.error, 'error');
      return;
    }
    setWorld(result.world);
    notify(`命令已接收：${selectedUnit.name} → ${world.areas[targetAreaId].name}，正在传递。`);
  }

  function dispatchScout() {
    const result = dispatchReconnaissance(world, {
      observerSide: 'player',
      ...profile.scout,
    });
    if (result.error) {
      notify(result.error, 'error');
      return;
    }
    setWorld(result.world);
    const preparationSeconds = result.action?.preparationSeconds ?? 0;
    notify(preparationSeconds > 0
      ? `侦查已接收：斥候准备 ${preparationSeconds} 秒后出发，资源已扣除。`
      : `侦查已接收：报告预计 ${profile.scout.delaySeconds} 秒后抵达，当前处于返回途中。`);
  }

  function issueDeceptionAction(actionId) {
    const action = deceptionActions.find((item) => item.id === actionId);
    if (!action) return;
    const result = issueDeception(world, { side: 'player', actionId });
    if (result.error) {
      notify(result.error, 'error');
      return;
    }
    setWorld(result.world);
    const preparation = action.preparationSeconds ?? 0;
    const delay = action.delaySeconds ?? 0;
    notify(`计策已接收：${action.name}。${preparation > 0 ? `准备 ${preparation} 秒后投放` : '正在投放'}，资源已扣除。`);
  }

  function cancelActiveOrder(orderId) {
    const result = cancelOrder(world, orderId);
    if (result.error) {
      notify(result.error, 'error');
      return;
    }
    setWorld(result.world);
    notify('命令已取消：部队不会再执行这条指令。');
  }

  function advanceManually(seconds = 1) {
    setRunning(false);
    setWorld((current) => stepBattle(current, seconds));
    notify(`时间已推进 ${seconds} 秒，正在刷新命令和前线情报。`, 'info');
  }

  function toggleRunning() {
    const nextRunning = !running;
    setRunning(nextRunning);
    notify(nextRunning ? '实时推进已开始：命令和情报将按模拟时间变化。' : '实时推进已暂停：当前战场状态已停留。', 'info');
  }

  function resetWorld() {
    setRunning(false);
    setWorld(profile.createWorld());
    setSelectedUnitId(profile.initialUnitId);
    notify(`${profile.title}已重置：命令、侦报和认知记录均已清空。`, 'info');
  }

  const sightingEntries = mapModel.reportedEnemySignals;
  const strengthUnit = ownUnits[0]?.strengthUnit ?? '人';
  const strengthLabel = strengthUnit === '人' ? '可用兵力' : '可用战力';

  return (
    <main className="battle-lab-shell">
      <header className="battle-lab-topbar">
        <button className="battle-back-button" onClick={onBack}><ArrowLeft size={18} /> 返回剧本库</button>
        <div className="battle-lab-title"><small>{profile.kicker}</small><h1>{profile.title}</h1></div>
        <div className="battle-lab-top-status"><span className="fixture-stamp">{profile.badge}</span><span>{profile.id === 'changping' ? '关卡参数与史实分离' : '内部验证内容'}</span></div>
      </header>

      <section className="battle-lab-toolbar" aria-label="时间控制">
        <div className="battle-clock"><span>模拟时间</span><strong>{formatClock(world.simTime)}</strong><i className={running ? 'live' : ''}>{running ? '实时推进中' : '已暂停'}</i></div>
        <div className="battle-clock-actions">
          <button className="battle-primary-action" disabled={battleEnded} onClick={toggleRunning}>{running ? <Pause size={17} /> : <Play size={17} />}{running ? '暂停推进' : battleEnded ? '战役已结束' : '开始实时推进'}</button>
          {[1, 2, 4].map((value) => <button key={value} className={speed === value ? 'speed-button active' : 'speed-button'} onClick={() => { setSpeed(value); notify(`推进速度已切换为 ${value}×。`, 'info'); }}><FastForward size={14} /> {value}×</button>)}
          <button className="step-button" disabled={battleEnded} onClick={() => advanceManually(1)}>手动推进 1 秒</button>
          <button className="reset-button" onClick={resetWorld}>重开本局</button>
        </div>
      </section>

      <section className="battle-lab-workspace">
        <aside className="battle-intel-column">
          <div className="battle-panel battle-panel-dark">
            <div className="panel-kicker"><ShieldChevron size={16} /> 我方编制</div>
            <h2>{profile.playerName}</h2>
            <p className="panel-note">{profile.dataNote}</p>
            <div className="battle-metric-stack">
              <div><span>{strengthLabel}</span><strong>{ownUnits.reduce((sum, unit) => sum + unit.strength, 0).toLocaleString()}</strong><small>{strengthUnit}</small></div>
              <div><span>执行中命令</span><strong>{activeOrders.length}</strong><small>条</small></div>
              <div><span>已报敌情</span><strong>{sightingEntries.length}</strong><small>处</small></div>
              <div><span>延迟侦报</span><strong>{inTransitReports.length}</strong><small>份</small></div>
              <div><span>情报点</span><strong>{resources.intelligencePoints ?? '—'}</strong><small>可用</small></div>
            </div>
          </div>

          <div className="battle-panel">
            <div className="panel-kicker"><Crosshair size={16} /> 部队状态</div>
            <div className="unit-list">
              {ownUnits.map((unit) => (
                <button key={unit.id} className={selectedUnit?.id === unit.id ? 'unit-row selected' : 'unit-row'} onClick={() => { setSelectedUnitId(unit.id); notify(`已选中：${unit.name}。`, 'info'); }}>
                  <span className="unit-row-dot" /><span><strong>{unit.name}</strong><small>{world.areas[unit.location]?.name} · {formatUnitStrength(unit)} · 粮 {unit.supplyDays}天</small></span><CaretRight size={14} />
                </button>
              ))}
            </div>
          </div>

          <div className="battle-panel battle-principle">
            <div className="panel-kicker"><Broadcast size={16} /> 作战原则</div>
            <p>命令不是瞬移，情报不是事实，世界状态与指挥官认知必须分开保存。</p>
          </div>
        </aside>

        <section className="battle-map-panel">
          <div className="battle-map-heading"><div><small>{profile.mapNote}</small><h2>{profile.mapTitle}</h2></div><span className="truth-note">真值在内核，视图只给认知</span></div>
          <div className="battle-map-surface">
            <img src="/assets/jiangnan-map.png" alt={`${profile.title}地图示意`} />
            <div className="map-wash" aria-hidden="true" />
            <svg className="battle-route-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              {mapModel.routes.map((route) => <path key={route.id} d={`M${route.points[0].x} ${route.points[0].y} L${route.points[1].x} ${route.points[1].y}`} />)}
            </svg>
            {mapModel.areas.map((area) => {
              const position = area.position ? { left: `${area.position.x}%`, top: `${area.position.y}%` } : {};
              const mapMarker = mapModel.landmarks.find((marker) => marker.areaId === area.id);
              const MarkerIcon = mapMarkerIcon(mapMarker?.type);
              const ownHere = mapModel.friendlyUnits.filter((unit) => unit.areaId === area.id);
              const sightingsHere = mapModel.reportedEnemySignals.filter((sighting) => sighting.areaId === area.id);
              return (
                <div key={area.id} className="battle-area-marker" style={position}>
                  <div className="area-marker-ring" />
                  <div className={`area-marker-symbol marker-${mapMarker?.type ?? 'unknown'}`} title={mapMarker?.label ?? area.terrain}><MarkerIcon size={17} weight="duotone" /></div>
                  <div className="area-marker-label"><strong>{area.name}</strong><small>{area.terrain}</small></div>
                  {sightingsHere.map((sighting) => {
                    const diameter = Math.max(34, Math.round((sighting.uncertainty?.radiusNormalized ?? 0.09) * 240));
                    return <span key={`uncertainty-${sighting.id}`} className={`report-uncertainty confidence-${sighting.confidence}`} style={{ width: `${diameter}px`, height: `${diameter}px` }} title={`${confidenceLabel(sighting.confidence)} · ${uncertaintyLabel(sighting)} · 可能范围：${candidateAreaLabel(sighting, world.areas)}`} />;
                  })}
                  <div className="area-presence">
                    {ownHere.map((unit) => <span key={unit.id} className="presence-friendly" title={`${unit.name} · 我方已知位置`}><FlagBanner size={14} weight="duotone" /></span>)}
                    {sightingsHere.map((sighting) => <span key={sighting.id} className={`presence-sighting confidence-${sighting.confidence}`} title={`${confidenceLabel(sighting.confidence)} · ${sighting.sourceType}`}><FlagPennant size={13} weight="duotone" /><Question size={8} weight="bold" /></span>)}
                  </div>
                </div>
              );
            })}
            <div className="map-badge map-badge-top"><Eye size={15} /> 我方认知视图</div>
            <div className="map-faction-legend" aria-label="战场双方图例">
              <span className="faction-friendly"><FlagBanner size={14} weight="duotone" /> {profile.playerSideLabel ?? '我方'}·已知</span>
              <span className="faction-reported"><FlagPennant size={14} weight="duotone" /> {profile.enemySideLabel ?? '敌军'}·疑似</span>
            </div>
            <div className="map-badge map-badge-bottom">{profile.id === 'changping' ? '关卡参数不等于史实真值' : '敌军真值不向指挥官开放'}</div>
          </div>
          <div className="battle-map-legend"><span><i className="legend-landmark"><CastleTurret size={13} /></i> 中立地标</span><span><i className="legend-friendly"><FlagBanner size={13} /></i> {profile.playerSideLabel ?? '我方'}·已知位置</span><span><i className="legend-sighting"><FlagPennant size={12} /><Question size={8} /></i> {profile.enemySideLabel ?? '敌军'}·疑似位置</span><span><i className="legend-line" /> 可通行路线</span></div>
        </section>

        <aside className="battle-command-column">
          <div className="battle-panel command-panel">
            <div className="panel-kicker"><Crosshair size={16} /> 下达命令</div>
            <h2>让部队移动</h2>
            <label className="battle-field-label" htmlFor="battle-unit-select">当前部队</label>
            <select id="battle-unit-select" value={selectedUnit?.id ?? ''} onChange={(event) => { setSelectedUnitId(event.target.value); notify(`已切换指挥部队：${world.units[event.target.value]?.name ?? event.target.value}。`, 'info'); }}>
              {ownUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.name} · {world.areas[unit.location]?.name}</option>)}
            </select>
            <p className="command-hint">命令传递延迟：{profile.commandDelaySeconds} 秒 · 行军时间取决于路线</p>
            <div className="target-grid">
              {profile.areas.map((area) => <button key={area.id} disabled={battleEnded || selectedUnit?.location === area.id} onClick={() => issueMove(area.id)}><span>{area.name}</span><small>{selectedUnit?.location === area.id ? '当前所在' : `前往 · ${area.terrain}`}</small></button>)}
            </div>
          </div>

          <div className="battle-panel command-panel">
            <div className="panel-kicker"><Broadcast size={16} /> 侦查与欺骗</div>
            <h2>{profile.id === 'changping' ? '派出前出斥候' : '派出前出侦骑'}</h2>
            <p className="panel-note">{profile.id === 'changping' ? '斥候需要整备时间和资源；行迹暴露时，回报会延迟且可信度下降。' : '本按钮会生成一份延迟侦报，内容可能失真。'}</p>
            <p className="command-hint">侦察队 {resources.scoutTeams ?? '—'} · {resourceCostText(profile.scout?.cost) || '无需额外资源'} · 准备 {profile.scout?.preparationSeconds ?? 0} 秒</p>
            <button className="scout-button" disabled={battleEnded || !canAfford(resources, profile.scout?.cost)} onClick={dispatchScout}><Eye size={17} /> 派出侦查</button>
            {preparingStrategies.length > 0 && <div className="report-list report-pending"><small>正在准备的计策</small>{preparingStrategies.slice(-3).reverse().map((action) => <div className="report-row" key={action.id}><span className="report-confidence pending">⌛</span><p><strong>{action.kind === 'scout' ? '前出斥候' : '计策准备'}</strong><small>{Math.max(0, (action.readyAt ?? world.simTime) - world.simTime)} 秒后进入执行阶段 · {resourceCostText(action.cost) || '无资源消耗'}</small></p></div>)}</div>}
            {inTransitReports.length > 0 && <div className="report-list report-pending"><small>返回中的情报</small>{inTransitReports.slice(-3).reverse().map((report) => <div className="report-row" key={report.id}><span className="report-confidence pending">…</span><p><strong>{report.sourceType ?? '前线报告'}</strong><small>{report.observation ?? '报告尚未抵达，内容暂不进入沙盘。'} · {Math.max(0, (report.arrivesAt ?? world.simTime) - world.simTime)} 秒后抵达</small></p></div>)}</div>}
            {sightingEntries.length > 0 && <div className="report-list"><small>已进入我方认知的情报</small>{sightingEntries.slice(-3).reverse().map((report) => <div className="report-row" key={report.id}><span className="report-confidence">{confidenceShort(report.confidence)}</span><p><strong>{world.areas[report.areaId]?.name}</strong><small>{report.text} · {report.sourceType} · {confidenceLabel(report.confidence)} · {uncertaintyLabel(report)} · 余 {Math.max(0, (report.expiresAt ?? world.simTime) - world.simTime)} 秒</small></p></div>)}</div>}
            {deceptionActions.length > 0 && <div className="deception-list"><small>可用计策 · 影响敌方认知</small>{deceptionActions.map((action) => {
              const lastIssuedAt = world.deception?.lastIssuedAtBySide?.[`player:${action.id}`];
              const cooldownRemaining = lastIssuedAt == null ? 0 : Math.max(0, (action.cooldownSeconds ?? BATTLEFIELD_CONFIG.defaults.deceptionCooldownSeconds) - (world.simTime - lastIssuedAt));
              const affordable = canAfford(resources, action.cost);
              return <button className="deception-action" key={action.id} disabled={battleEnded || cooldownRemaining > 0 || !affordable} onClick={() => issueDeceptionAction(action.id)}><WaveSine size={16} /><span><strong>{action.name}</strong><small>误导至 {world.areas[action.reportedAreaId]?.name ?? '指定区域'} · 准备 {action.preparationSeconds ?? 0} 秒 · {resourceCostText(action.cost) || '无需资源'} · {!affordable ? '资源不足' : cooldownRemaining > 0 ? `冷却 ${cooldownRemaining} 秒` : '可施行'}</small></span></button>;
            })}</div>}
            {deceptionHistory.length > 0 && <div className="deception-history"><small>计策记录</small>{deceptionHistory.slice(-2).reverse().map((item) => <div className="deception-history-row" key={item.id}><span>●</span><p><strong>{deceptionActions.find((action) => action.id === item.actionId)?.name ?? '未命名计策'}</strong><small>{deceptionDeliveryLabel(item, world)} · 敌方将按其认知行动</small></p></div>)}</div>}
          </div>

          <div className="battle-panel order-panel">
            <div className="panel-kicker"><Play size={15} /> 命令队列</div>
            {activeOrders.length === 0 ? <p className="empty-panel">当前没有传递中或执行中的命令。</p> : activeOrders.map((order) => <div className="order-row" key={order.id}><div><strong>{world.units[order.unitId]?.name}</strong><small>{world.areas[order.targetAreaId]?.name} · {orderStatus(order)}</small></div><button onClick={() => cancelActiveOrder(order.id)}>取消</button></div>)}
          </div>
        </aside>
      </section>

      <section className="battle-lab-bottom">
        <div className={`battle-notice tone-${noticeTone}`} role="status" aria-live="polite"><span>{battleEnded ? '战役结果' : '最近操作'}</span><p>{battleEnded ? `${world.outcome?.id ?? '未命名结果'} · ${world.outcome?.result ?? '未知'}` : notice}</p></div>
        <div className="battle-event-panel"><div className="panel-kicker"><Broadcast size={15} /> 事件时间线</div><div className="battle-event-list">{recentEvents.length === 0 ? <span className="empty-panel">推进时间后，内核事件将在这里出现。</span> : recentEvents.map((event) => <div className="battle-event" key={event.id}><time>{formatClock(event.simTime)}</time><p>{eventText(event, world)}</p></div>)}</div></div>
      </section>
    </main>
  );
}
