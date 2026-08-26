/** Stable machine-readable errors for the battlefield core and commander gateway. */
export const BATTLE_ERROR_CODES = Object.freeze({
  COMMAND_REQUIRED: 'COMMAND_REQUIRED',
  WORLD_ENDED: 'WORLD_ENDED',
  UNSUPPORTED_COMMAND: 'UNSUPPORTED_COMMAND',
  UNIT_NOT_FOUND: 'UNIT_NOT_FOUND',
  UNIT_NOT_OWNED: 'UNIT_NOT_OWNED',
  ORDER_TYPE_UNSUPPORTED: 'ORDER_TYPE_UNSUPPORTED',
  ORDER_TARGET_REQUIRED: 'ORDER_TARGET_REQUIRED',
  AREA_NOT_FOUND: 'AREA_NOT_FOUND',
  ROUTE_UNREACHABLE: 'ROUTE_UNREACHABLE',
  ORDER_NOT_FOUND: 'ORDER_NOT_FOUND',
  OBSERVER_SIDE_NOT_FOUND: 'OBSERVER_SIDE_NOT_FOUND',
  OBSERVATION_TARGET_NOT_FOUND: 'OBSERVATION_TARGET_NOT_FOUND',
  SCOUT_NOT_CONFIGURED: 'SCOUT_NOT_CONFIGURED',
  BELIEF_NOT_FOUND: 'BELIEF_NOT_FOUND',
  DECEPTION_NOT_FOUND: 'DECEPTION_NOT_FOUND',
  DECEPTION_SIDE_FORBIDDEN: 'DECEPTION_SIDE_FORBIDDEN',
  DECEPTION_SUBJECT_INVALID: 'DECEPTION_SUBJECT_INVALID',
  DECEPTION_RECIPIENT_INVALID: 'DECEPTION_RECIPIENT_INVALID',
  DECEPTION_COOLDOWN: 'DECEPTION_COOLDOWN',
  DECEPTION_AREA_INVALID: 'DECEPTION_AREA_INVALID',
  REPLAY_INVALID: 'REPLAY_INVALID',
  SCENARIO_INVALID: 'SCENARIO_INVALID',
  SCENARIO_UNIT_NOT_FOUND: 'SCENARIO_UNIT_NOT_FOUND',
  SCENARIO_COMMANDER_NOT_FOUND: 'SCENARIO_COMMANDER_NOT_FOUND',
});

/**
 * Keep the existing human-readable `error` field for UI compatibility while
 * adding a stable code for clients, logs and automated tests.
 *
 * @param {string} code
 * @param {string} message
 * @param {Record<string, unknown>} [details]
 * @returns {{ error: string, errorCode: string, errorDetails: Record<string, unknown> }}
 */
export function battleError(code, message, details = {}) {
  return { error: message, errorCode: code, errorDetails: details };
}

/**
 * @param {string} code
 * @param {string} message
 * @param {Record<string, unknown>} [details]
 */
export class BattleValidationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'BattleValidationError';
    this.code = code;
    this.details = details;
  }
}
