import hgManifest from '../scenarios/hongguang-1645/manifest.json' with { type: 'json' };
import hgInitialWorld from '../scenarios/hongguang-1645/initial-world.json' with { type: 'json' };
import hgCities from '../scenarios/hongguang-1645/cities.json' with { type: 'json' };
import hgCharacters from '../scenarios/hongguang-1645/characters.json' with { type: 'json' };
import hgEvents from '../scenarios/hongguang-1645/events.json' with { type: 'json' };
import hgEndings from '../scenarios/hongguang-1645/endings.json' with { type: 'json' };
import hgReports from '../scenarios/hongguang-1645/reports.json' with { type: 'json' };
import hgCouncil from '../scenarios/hongguang-1645/council.json' with { type: 'json' };
import hgPresentation from '../scenarios/hongguang-1645/presentation.json' with { type: 'json' };
import yzManifest from '../scenarios/yangzhou-1645/manifest.json' with { type: 'json' };
import yzInitialWorld from '../scenarios/yangzhou-1645/initial-world.json' with { type: 'json' };
import yzCities from '../scenarios/yangzhou-1645/cities.json' with { type: 'json' };
import yzCharacters from '../scenarios/yangzhou-1645/characters.json' with { type: 'json' };
import yzEvents from '../scenarios/yangzhou-1645/events.json' with { type: 'json' };
import yzEndings from '../scenarios/yangzhou-1645/endings.json' with { type: 'json' };
import yzReports from '../scenarios/yangzhou-1645/reports.json' with { type: 'json' };
import yzCouncil from '../scenarios/yangzhou-1645/council.json' with { type: 'json' };
import yzPresentation from '../scenarios/yangzhou-1645/presentation.json' with { type: 'json' };

export const SCENARIOS = [
  { manifest: hgManifest, initialWorld: hgInitialWorld, cities: hgCities, characters: hgCharacters, council: hgCouncil, presentation: hgPresentation, events: hgEvents, endings: hgEndings, reports: hgReports },
  { manifest: yzManifest, initialWorld: yzInitialWorld, cities: yzCities, characters: yzCharacters, council: yzCouncil, presentation: yzPresentation, events: yzEvents, endings: yzEndings, reports: yzReports },
];

export function getScenario(scenarioId) {
  return SCENARIOS.find((scenario) => scenario.manifest.id === scenarioId) ?? SCENARIOS[0];
}
