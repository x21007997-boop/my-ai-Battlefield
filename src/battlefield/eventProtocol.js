export const COMMANDER_EVENT_SCHEMA_VERSION = 1;

const EVENT_FIELDS = new Set(['id', 'schemaVersion', 'simTime', 'type', 'payload']);

export function serializeCommanderEvent(event) {
  const payload = event.payload ?? Object.fromEntries(
    Object.entries(event).filter(([key]) => !EVENT_FIELDS.has(key)),
  );
  return {
    id: event.id ?? `game-event-${String(event.simTime ?? 0).padStart(4, '0')}`,
    schemaVersion: COMMANDER_EVENT_SCHEMA_VERSION,
    simTime: Number.isInteger(event.simTime) ? event.simTime : 0,
    type: event.type ?? 'unknown',
    payload: JSON.parse(JSON.stringify(payload)),
  };
}

export function serializeCommanderEvents(events = []) {
  return events.map(serializeCommanderEvent);
}
