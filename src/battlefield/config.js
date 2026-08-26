/**
 * Battlefield runtime policy.
 *
 * Scenario packages own historical content and scenario assumptions. This
 * module owns only engine defaults, protocol versions and presentation-safe
 * labels shared by the headless core and its adapters.
 */
export const BATTLEFIELD_CONFIG = Object.freeze({
  simulatorVersion: 'battlefield-core-0.1.0',
  coordinateSystem: 'normalized-2d',
  mapBounds: Object.freeze({ x: Object.freeze([0, 100]), y: Object.freeze([0, 100]) }),
  schemaVersions: Object.freeze({
    world: 1,
    commanderEvent: 1,
    commanderSession: 1,
    commanderReplay: 1,
    battleReview: 1,
    battleResolution: 1,
    deception: 1,
    map: 1,
    commanderGateway: 1,
  }),
  defaults: Object.freeze({
    areaTravelSeconds: 10,
    observationDelaySeconds: 0,
    minimumReportFreshnessSeconds: 1,
    maxAdvanceSeconds: 3600,
    commanderCommandDelaySeconds: 3,
    scoutReportDelaySeconds: 5,
    deceptionReportDelaySeconds: 3,
    aiIntervalSeconds: 15,
    aiCommandDelaySeconds: 3,
    enemyActionReportDelaySeconds: 5,
    enemyActionReportFreshnessSeconds: 20,
    deceptionCooldownSeconds: 30,
    combatIntervalSeconds: 10,
    combatReportDelaySeconds: 5,
    supplyTickSeconds: 60,
    reportFreshnessSeconds: 30,
  }),
  terrainLabels: Object.freeze({
    river: '渡河',
    mountain: '翻山',
    unknown: '地形通过',
  }),
  confidenceRank: Object.freeze({ high: 3, medium: 2, low: 1 }),
  sourceReliabilityScores: Object.freeze({
    high: 0.85,
    medium: 0.65,
    low: 0.4,
    variable: 0.5,
    'to-be-calibrated': 0.5,
    unknown: 0.5,
  }),
  reportUncertaintyProfiles: Object.freeze({
    high: Object.freeze({ radiusNormalized: 0.04, maxCandidateNeighbors: 0, label: '误差较小' }),
    medium: Object.freeze({ radiusNormalized: 0.09, maxCandidateNeighbors: 1, label: '可能偏离相邻区域' }),
    low: Object.freeze({ radiusNormalized: 0.16, maxCandidateNeighbors: 2, label: '可能偏离附近区域' }),
    unknown: Object.freeze({ radiusNormalized: 0.2, maxCandidateNeighbors: 3, label: '仅供参考' }),
  }),
  hiddenEventTypes: Object.freeze(['engagement_started', 'engagement_ended', 'combat_exchange']),
});
