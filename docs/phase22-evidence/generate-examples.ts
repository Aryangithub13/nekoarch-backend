import { writeFile } from 'node:fs/promises';
import { generateParametricBlueprint, normalizeParametricRequirements, modifyParametricRequirements, type ParametricRequirements } from '@designflow/generator';
import { auditBlueprint } from '@designflow/blueprint-qa';
import { calculateQuantityTakeoff } from '@designflow/quantity-takeoff';
import { parametricInput } from '../../test-support/parametric-fixtures.js';
import { projectQaOptions } from '../../apps/api/src/services/project-service.js';
import { parametricQaOptions } from '../../apps/api/src/services/parametric-qa.js';
import { modelHash } from '../../apps/api/src/lib/generation-identity.js';
const connected = parametricInput(true);
connected.relationships = [{ from: { type: 'living' }, to: { type: 'kitchen' }, kind: 'connected', strength: 'hard' }];
const cases: [string, ParametricRequirements][] = [
  ['single-floor-L', parametricInput()], ['two-floor-setback', parametricInput(true)],
  ['modified-west-wing', modifyParametricRequirements(parametricInput(true), { level: 0, parameter: 'westWingWidthMm', valueMm: 10000 })],
  ['hard-connected-rooms', connected],
];
for (const [name, input] of cases) {
  const requirements = normalizeParametricRequirements(input), generated = generateParametricBlueprint(requirements);
  const qa = auditBlueprint(generated.model, { ...projectQaOptions(generated.model), ...parametricQaOptions(requirements) });
  if (qa.status === 'FAIL') throw new Error(`${name}: ${JSON.stringify(qa.findings)}`);
  const takeoff = calculateQuantityTakeoff(generated.model);
  await writeFile(`docs/phase22-evidence/${name}.json`, JSON.stringify({ requirements, generated, modelHash: modelHash(generated.model), qa, quantities: { totals: takeoff.summary.totals, coverage: takeoff.coverage } }, null, 2) + '\n');
  console.log(`${name}: ${qa.status}; ${generated.model.spaces.length} spaces; ${generated.model.walls.length} walls`);
}
