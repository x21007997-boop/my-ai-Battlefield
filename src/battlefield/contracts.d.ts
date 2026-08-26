export type SideId = string;

export interface BattlePosition {
  x: number;
  y: number;
}

export interface TerrainTransition {
  featureId: string;
  terrainType: string;
  transitionType?: string;
  label?: string;
  method?: string | null;
  startProgress?: number;
  endProgress?: number;
  effects?: Record<string, number>;
}

export interface TerrainFeature {
  id: string;
  type: string;
  name: string;
  points: BattlePosition[];
  width?: number | null;
  status?: string;
  evidenceGrade?: string | null;
}

export interface DeceptionAction {
  id: string;
  name: string;
  effect?: string;
  mode?: string;
  targetSide?: SideId | null;
  targetUnitId?: string | null;
  reportedAreaId?: string | null;
  delaySeconds?: number;
  freshnessSeconds?: number | null;
  confidence?: string;
  cooldownSeconds?: number;
  [key: string]: unknown;
}

export interface BattleArea {
  id: string;
  name: string;
  terrain?: string | null;
  position?: BattlePosition | null;
  neighbors: Array<{
    id: string;
    travelSeconds?: number;
    routeId?: string | null;
    terrainTransitions?: TerrainTransition[];
  }>;
  locationStatus?: string | null;
  evidenceGrade?: string | null;
}

export interface BattleUnit {
  id: string;
  side: SideId;
  name: string;
  unitType?: string;
  location: string;
  strength: number;
  morale: number;
  fatigue: number;
  supplyDays: number;
  readiness: number;
  status: string;
  posture?: string;
  currentOrderId: string | null;
}

export interface BattleOrder {
  id: string;
  type: string;
  taskType?: string | null;
  taskLabel?: string | null;
  unitId: string;
  targetAreaId: string;
  originAreaId: string;
  status: string;
  issuedAt: number;
  deliverAt: number;
  route: string[];
  routeSegments: Array<Record<string, unknown>>;
  terrainTransitions: TerrainTransition[];
  movementProgress: number;
  remainingTravelSeconds: number;
  deliveredAt?: number;
  completedAt?: number;
  currentTerrain?: Record<string, unknown> | null;
  lastTerrainTransition?: Record<string, unknown> | null;
  totalTravelSeconds?: number;
  rawText?: string;
  taskStatus?: string | null;
  blockedAt?: number | null;
  blockReason?: string | null;
}

export interface BattleObservation {
  id: string;
  observerSide: SideId;
  targetUnitId: string;
  /** Internal engine truth. Never copy this field into commander responses. */
  actualAreaId?: string;
  reportedAreaId: string;
  confidence: 'high' | 'medium' | 'low' | string;
  sourceId?: string | null;
  sourceReliability?: string | null;
  sourceIndependenceGroup?: string | null;
  reliabilityScore?: number;
  freshnessSeconds?: number;
  sourceType: string;
  observedAt: number;
  arrivesAt: number;
  status: 'in_transit' | 'delivered' | string;
  observation: string;
  deliveredAt?: number;
  uncertainty?: {
    level: string;
    radiusNormalized: number;
    candidateAreaIds: string[];
    label: string;
  };
}

export interface QueueObservationOptions {
  observerSide: SideId;
  targetUnitId: string;
  reportedAreaId: string;
  delaySeconds?: number;
  confidence?: string;
  sourceId?: string | null;
  sourceReliability?: string | null;
  sourceIndependenceGroup?: string | null;
  freshnessSeconds?: number;
  sourceType?: string;
  observedAt?: number;
  actualAreaId?: string;
  observation?: string;
  reliabilityScoreOverride?: number | null;
}

export interface StrategyAction {
  id: string;
  kind: string;
  side: SideId;
  actionId?: string | null;
  targetSide?: SideId | null;
  targetUnitId: string;
  reportedAreaId?: string | null;
  actualAreaId?: string;
  status: string;
  issuedAt: number;
  readyAt: number;
  preparedAt?: number | null;
  dispatchedAt?: number | null;
  deliveredAt?: number | null;
  observationId?: string | null;
  exposureStatus?: string | null;
  exposureProbability?: number;
  failureReliabilityPenalty?: number;
  failedAt?: number | null;
  exposedAt?: number | null;
  failureReason?: string | null;
  cost?: Record<string, number>;
  [key: string]: unknown;
}

export interface BeliefReport {
  id: string;
  observationId: string;
  targetUnitId: string;
  areaId: string;
  confidence: string;
  sourceType: string;
  sourceIndependenceGroup?: string;
  receivedAt: number;
  expiresAt: number;
  status: 'active' | 'expired' | string;
  text: string;
}

export interface BattleWorld {
  schemaVersion: number;
  simulatorVersion: string;
  scenarioId: string;
  seed: number;
  simTime: number;
  status: 'running' | 'ended' | string;
  areas: Record<string, BattleArea>;
  units: Record<string, BattleUnit>;
  orders: BattleOrder[];
  observations: BattleObservation[];
  beliefs: Record<SideId, {
    side: SideId;
    sightings: Record<string, BeliefReport>;
    reports: BeliefReport[];
    counterIntelligence?: {
      reviews: Record<string, Record<string, unknown>>;
      history: Array<Record<string, unknown>>;
    };
    knownOwnUnitIds: string[];
  }>;
  sides: Record<SideId, { id: SideId; name: string }>;
  eventLog: Array<Record<string, unknown>>;
  terrainFeatures?: TerrainFeature[];
  intelligenceSources?: Record<string, Record<string, unknown>>;
  deception?: {
    actions: Record<string, DeceptionAction>;
    history: Array<Record<string, unknown>>;
    lastIssuedAtBySide: Record<string, number>;
  };
  resources?: Record<SideId, Record<string, number>>;
  strategy?: {
    schemaVersion: number;
    actions: StrategyAction[];
    lastIssuedAtByKey: Record<string, number>;
    reliabilityBySide: Record<SideId, number>;
  };
  objectives?: Array<Record<string, unknown>>;
  endings?: Array<Record<string, unknown>>;
  resolution?: Record<string, unknown> | null;
  combat?: Record<string, unknown>;
  logistics?: Record<string, unknown>;
  ai?: Record<string, unknown>;
  outcome?: Record<string, unknown> | null;
  [key: string]: unknown;
}

export interface BattleError {
  error: string | null;
  errorCode?: string | null;
  errorDetails?: Record<string, unknown>;
}

export interface BattleResult<T> extends BattleError {
  world: BattleWorld;
  result?: T | null;
  order?: BattleOrder | null;
  observation?: BattleObservation | null;
  report?: BeliefReport;
  deception?: Record<string, unknown> | null;
  [key: string]: unknown;
}

export interface CreateBattleWorldOptions {
  scenarioId?: string;
  seed?: number;
  areas?: Array<Record<string, unknown>>;
  terrainFeatures?: TerrainFeature[];
  units?: Array<Record<string, unknown>>;
  sides?: Array<{ id: string; name: string; [key: string]: unknown }>;
  intelligenceSources?: Array<Record<string, unknown>>;
  deceptionActions?: Array<Record<string, unknown>>;
  objectives?: Array<Record<string, unknown>>;
  endings?: Array<Record<string, unknown>>;
  resolution?: Record<string, unknown> | null;
  resources?: Record<SideId, Record<string, number>>;
}

export interface BattleCommand {
  type: string;
  unitId?: string;
  targetAreaId?: string;
  orderId?: string;
  actionId?: string;
  seconds?: number;
  priority?: string;
  constraints?: string[];
  rawText?: string;
  [key: string]: unknown;
}

export interface CommanderGatewayOptions {
  side?: string;
  commandDelaySeconds?: number;
  scout?: QueueObservationOptions | null;
  maxAdvanceSeconds?: number;
  sessionOptions?: CommanderMapOptions;
  [key: string]: unknown;
}

export interface BattleScenarioPackage {
  manifest?: { id?: string; sides?: string[]; [key: string]: unknown };
  geography?: { areas?: Array<Record<string, unknown>>; [key: string]: unknown };
  terrain?: { features?: TerrainFeature[]; areas?: Array<Record<string, unknown>>; [key: string]: unknown };
  terrainFeatures?: TerrainFeature[];
  factions?: { factions?: Array<Record<string, unknown>>; [key: string]: unknown };
  commanders?: { commanders?: Array<Record<string, unknown>>; [key: string]: unknown };
  units?: { units?: Array<Record<string, unknown>>; [key: string]: unknown };
  initialWorld?: { units?: Array<Record<string, unknown>>; seed?: number; [key: string]: unknown };
  intelligenceSources?: { sources?: Array<Record<string, unknown>>; [key: string]: unknown };
  deception?: { actions?: Array<Record<string, unknown>>; [key: string]: unknown };
  objectives?: { objectives?: Array<Record<string, unknown>>; [key: string]: unknown };
  endings?: { endings?: Array<Record<string, unknown>>; [key: string]: unknown };
  resolution?: Record<string, unknown> | null;
  resources?: Record<SideId, Record<string, number>>;
}

export interface CommanderMapOptions {
  side?: string;
  mapAsset?: string | null;
  mapTitle?: string;
  mapNote?: string;
  mapConfig?: { coordinateSystem?: string; bounds?: Record<string, unknown>; renderMode?: string; [key: string]: unknown };
  mapMarkers?: Array<Record<string, unknown>>;
  terrainFeatures?: TerrainFeature[];
}
