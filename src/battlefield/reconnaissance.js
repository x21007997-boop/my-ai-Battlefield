import { appendBattleEvent, cloneBattleWorld } from './world.js';

export const DEFAULT_REPORT_FRESHNESS_SECONDS = 30;

export function expireBeliefs(world) {
  const next = cloneBattleWorld(world);
  Object.values(next.beliefs ?? {}).forEach((belief) => {
    belief.reports ??= [];
    belief.reports.forEach((report) => {
      if (report.status === 'expired' || report.expiresAt == null || report.expiresAt > next.simTime) return;
      report.status = 'expired';
      report.expiredAt = next.simTime;
      if (belief.sightings[report.targetUnitId]?.id === report.id) delete belief.sightings[report.targetUnitId];
      appendBattleEvent(next, {
        type: 'report_expired',
        observerSide: belief.side,
        reportId: report.id,
        targetUnitId: report.targetUnitId,
        areaId: report.areaId,
      });
    });
  });
  return next;
}
