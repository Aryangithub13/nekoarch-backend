import { PlanSchema, type Plan } from '@designflow/shared';
import { describe, expect, it } from 'vitest';
import { GenerationError } from '../src/errors.js';
import { assertPlanInvariants } from '../src/invariants.js';
import type { NormalizedGenerationInput } from '../src/input.js';

// This fixture is authored independently of the generator. The living room has
// a 1 m exterior entrance; another 1 m gap in the divider connects the study.
function fixture(): Plan {
  const walls = [
    { x0: 0, z0: 0, x1: 1.5, z1: 0 },
    { x0: 2.5, z0: 0, x1: 8, z1: 0 },
    { x0: 0, z0: 6, x1: 8, z1: 6 },
    { x0: 0, z0: 0, x1: 0, z1: 6 },
    { x0: 8, z0: 0, x1: 8, z1: 6 },
    { x0: 4, z0: 0, x1: 4, z1: 2.5 },
    { x0: 4, z0: 3.5, x1: 4, z1: 6 },
  ];
  return {
    prompt: 'A living room and study',
    seed: 'independent-fixture',
    variant: 1,
    bounds: { x: 0, z: 0, w: 8, d: 6 },
    rooms: [
      { id: 0, name: 'Living room', type: 'living', rect: { x: 0, z: 0, w: 4, d: 6 } },
      { id: 1, name: 'Study', type: 'study', rect: { x: 4, z: 0, w: 4, d: 6 } },
    ],
    walls,
    furn: [],
    qa: { orthogonal: 1, walls: walls.length, pieces: 0 },
  };
}

function requirements(): NormalizedGenerationInput {
  return {
    prompt: 'A living room and study',
    bounds: { x: 0, z: 0, w: 8, d: 6 },
    rooms: [{ type: 'living', count: 1 }, { type: 'study', count: 1 }],
    adjacency: [],
  };
}

function expectInvariantFailure(plan: unknown, input?: NormalizedGenerationInput): void {
  expect(() => assertPlanInvariants(plan, input)).toThrow(GenerationError);
  expect(() => assertPlanInvariants(plan, input)).toThrowError(expect.objectContaining({ code: 'INVARIANT_FAILURE' }));
}

describe('independent plan invariants', () => {
  it('accepts a hand-built connected canonical plan without depending on generation', () => {
    const plan = fixture();
    expect(PlanSchema.safeParse(plan).success).toBe(true);
    expect(() => assertPlanInvariants(plan, requirements())).not.toThrow();
  });

  it('does not mutate the caller plan while verifying it', () => {
    const plan = fixture();
    const input = requirements();
    const before = structuredClone(plan);
    const inputBefore = structuredClone(input);
    assertPlanInvariants(plan, input);
    expect(plan).toEqual(before);
    expect(input).toEqual(inputBefore);
  });

  it('accepts deeply frozen plan and requirements without attempting writes', () => {
    const freeze = (value: unknown): void => {
      if (value === null || typeof value !== 'object') return;
      for (const child of Object.values(value)) freeze(child);
      Object.freeze(value);
    };
    const plan = fixture();
    const input = requirements();
    freeze(plan);
    freeze(input);
    expect(() => assertPlanInvariants(plan, input)).not.toThrow();
  });

  it.each([
    ['throwing property getter', () => Object.defineProperty(fixture(), 'prompt', {
      get() { throw new Error('private-token'); },
    })],
    ['throwing nested getter', () => {
      const plan = fixture();
      Object.defineProperty(plan.rooms[0]!.rect, 'x', { get() { throw new Error('private-token'); } });
      return plan;
    }],
    ['throwing proxy property trap', () => new Proxy(fixture(), {
      get() { throw new Error('private-token'); },
    })],
    ['throwing proxy key enumeration', () => new Proxy(fixture(), {
      ownKeys() { throw new Error('private-token'); },
    })],
  ])('maps %s to a sanitized invariant failure', (_description, makePlan) => {
    const plan = makePlan();
    expectInvariantFailure(plan);
    expect(() => assertPlanInvariants(plan)).not.toThrowError('private-token');
  });

  it('accepts reversed wall direction and contiguous non-overlapping segments', () => {
    const plan = fixture();
    plan.walls[2] = { x0: 8, z0: 6, x1: 4, z1: 6 };
    plan.walls.push({ x0: 4, z0: 6, x1: 0, z1: 6 });
    plan.qa.walls = plan.walls.length;
    expect(() => assertPlanInvariants(plan)).not.toThrow();
  });

  it('accepts the same geometry translated to a nonzero origin', () => {
    const plan = fixture();
    plan.bounds.x += 12;
    plan.bounds.z -= 8;
    for (const room of plan.rooms) {
      room.rect.x += 12;
      room.rect.z -= 8;
    }
    for (const wall of plan.walls) {
      wall.x0 += 12;
      wall.x1 += 12;
      wall.z0 -= 8;
      wall.z1 -= 8;
    }
    expect(() => assertPlanInvariants(plan)).not.toThrow();
  });

  it.each([NaN, Infinity, -Infinity])('rejects a non-finite room coordinate %s with a domain error', (number) => {
    const plan = fixture();
    plan.rooms[0]!.rect.x = number;
    expectInvariantFailure(plan);
  });

  it.each([undefined, null, {}, { floors: 2 }])('rejects malformed canonical output %j', (plan) => {
    expectInvariantFailure(plan);
  });

  it('rejects unsupported floor fields instead of claiming multi-floor compatibility', () => {
    expectInvariantFailure({ ...fixture(), floors: 2 });
  });

  it('requires a complete output instead of asserting a schema default exists on the caller object', () => {
    const { variant: _variant, ...incomplete } = fixture();
    expect(PlanSchema.safeParse(incomplete).success).toBe(true);
    expectInvariantFailure(incomplete);
  });

  it.each([
    ['duplicated IDs', (plan: Plan) => { plan.rooms[1]!.id = 0; }],
    ['out-of-bounds rooms', (plan: Plan) => { plan.rooms[0]!.rect.x = -0.1; }],
    ['room overlap', (plan: Plan) => { plan.rooms[1]!.rect.x = 3.9; }],
    ['uncovered floor area', (plan: Plan) => { plan.rooms[0]!.rect.w = 3.9; }],
    ['zero-length walls', (plan: Plan) => { plan.walls[0]!.x1 = 0; }],
    ['diagonal walls', (plan: Plan) => { plan.walls[0]!.z1 = 1; }],
    ['out-of-bounds walls', (plan: Plan) => { plan.walls[0]!.x0 = -1; }],
    ['walls across room interiors', (plan: Plan) => { plan.walls.push({ x0: 1, z0: 1, x1: 3, z1: 1 }); }],
    ['duplicate walls', (plan: Plan) => { plan.walls.push({ ...plan.walls[0]! }); }],
    ['partially overlapping reversed walls', (plan: Plan) => { plan.walls.push({ x0: 1, z0: 0, x1: 0.5, z1: 0 }); }],
    ['missing exterior boundary', (plan: Plan) => { plan.walls.splice(2, 1); }],
    ['missing interior boundary', (plan: Plan) => { plan.walls.splice(5, 2); }],
    ['door gap below the supported clearance', (plan: Plan) => { plan.walls[5]!.z1 = 2.8; }],
    ['door gap above the supported size', (plan: Plan) => { plan.walls[5]!.z1 = 2; }],
    ['sealed entrance', (plan: Plan) => { plan.walls.push({ x0: 1.5, z0: 0, x1: 2.5, z1: 0 }); }],
    ['sealed internal connection', (plan: Plan) => { plan.walls.push({ x0: 4, z0: 2.5, x1: 4, z1: 3.5 }); }],
  ])('rejects schema-valid %s', (_description, mutate) => {
    const plan = fixture();
    mutate(plan);
    plan.qa.walls = plan.walls.length;
    expect(PlanSchema.safeParse(plan).success).toBe(true);
    expectInvariantFailure(plan);
  });

  it('requires a single connected interior even if isolated rooms each have an exterior entrance', () => {
    const plan = fixture();
    plan.walls.push({ x0: 4, z0: 2.5, x1: 4, z1: 3.5 });
    plan.walls[4] = { x0: 8, z0: 0, x1: 8, z1: 2.5 };
    plan.walls.push({ x0: 8, z0: 3.5, x1: 8, z1: 6 });
    plan.qa.walls = plan.walls.length;
    expectInvariantFailure(plan);
  });

  it('resolves partial shared edges at a T-junction instead of linking the wrong neighboring room', () => {
    const plan = fixture();
    plan.rooms[1]!.rect.d = 3;
    plan.rooms.push({ id: 2, name: 'Bedroom', type: 'bedroom', rect: { x: 4, z: 3, w: 4, d: 3 } });
    plan.walls.splice(5, 2,
      { x0: 4, z0: 0, x1: 4, z1: 1 },
      { x0: 4, z0: 2, x1: 4, z1: 4 },
      { x0: 4, z0: 5, x1: 4, z1: 6 },
      { x0: 4, z0: 3, x1: 8, z1: 3 });
    plan.qa.walls = plan.walls.length;
    expect(() => assertPlanInvariants(plan)).not.toThrow();
    // The lower room stays connected; sealing just the upper gap must isolate
    // the bedroom even though it shares a long wall with the living room.
    plan.walls.push({ x0: 4, z0: 4, x1: 4, z1: 5 });
    plan.qa.walls = plan.walls.length;
    expectInvariantFailure(plan);
  });

  it('does not count rooms touching at a corner as directly adjacent', () => {
    const plan = fixture();
    plan.rooms[0]!.rect.d = 3;
    plan.rooms[1]!.rect.d = 3;
    plan.rooms.push(
      { id: 2, name: 'Bedroom', type: 'bedroom', rect: { x: 0, z: 3, w: 4, d: 3 } },
      { id: 3, name: 'Dining', type: 'dining', rect: { x: 4, z: 3, w: 4, d: 3 } });
    plan.walls.splice(5, 2,
      { x0: 4, z0: 0, x1: 4, z1: 1 },
      { x0: 4, z0: 2, x1: 4, z1: 6 },
      { x0: 0, z0: 3, x1: 1.5, z1: 3 },
      { x0: 2.5, z0: 3, x1: 5.5, z1: 3 },
      { x0: 6.5, z0: 3, x1: 8, z1: 3 });
    plan.qa.walls = plan.walls.length;
    const input = requirements();
    input.rooms.push({ type: 'bedroom', count: 1 }, { type: 'dining', count: 1 });
    expect(() => assertPlanInvariants(plan, input)).not.toThrow();
    input.adjacency.push({ from: 'living', to: 'dining' });
    expectInvariantFailure(plan, input);
  });

  it('checks required counts even when the plan is structurally valid', () => {
    const input = requirements();
    input.rooms[1]!.count = 2;
    expectInvariantFailure(fixture(), input);
  });

  it('rejects replacement room types and unrequested extra types', () => {
    const plan = fixture();
    plan.rooms[1]!.type = 'bedroom';
    expectInvariantFailure(plan, requirements());
  });

  it('requires the generated prompt and footprint to match normalized input', () => {
    expectInvariantFailure(fixture(), { ...requirements(), prompt: 'Different requirements' });
    expectInvariantFailure(fixture(), { ...requirements(), bounds: { x: 0, z: 0, w: 9, d: 6 } });
  });

  it('checks direct requested adjacency using actual doorways in either direction', () => {
    const input = requirements();
    input.adjacency = [{ from: 'study', to: 'living' }];
    expect(() => assertPlanInvariants(fixture(), input)).not.toThrow();
    input.adjacency = [{ from: 'study', to: 'bedroom' }];
    expectInvariantFailure(fixture(), input);
  });

  it.each([0, Math.PI / 2, Math.PI, 3 * Math.PI / 2])('accepts canonical furniture rotation %s', (rot) => {
    const plan = fixture();
    plan.furn.push({ kind: 'chair', x: 1.5, z: 4.5, rot });
    plan.qa.pieces = 1;
    expect(() => assertPlanInvariants(plan)).not.toThrow();
  });

  it.each([
    ['non-orthogonal rotation', (plan: Plan) => { plan.furn[0]!.rot = 0.1; }],
    ['out-of-room furniture', (plan: Plan) => { plan.furn[0]!.x = -1; }],
    ['furniture straddling rooms', (plan: Plan) => { plan.furn[0]!.x = 4; }],
    ['furniture in circulation', (plan: Plan) => { plan.rooms[0]!.type = 'circulation'; }],
    ['overlapping furniture', (plan: Plan) => { plan.furn.push({ ...plan.furn[0]! }); }],
    ['blocked exterior doorway', (plan: Plan) => { plan.furn[0]!.x = 2; plan.furn[0]!.z = 0.5; }],
    ['blocked shared doorway', (plan: Plan) => { plan.furn[0]!.x = 3.5; plan.furn[0]!.z = 3; }],
  ])('rejects schema-valid %s', (_description, mutate) => {
    const plan = fixture();
    plan.furn.push({ kind: 'chair', x: 1.5, z: 4.5, rot: 0 });
    mutate(plan);
    plan.qa.pieces = plan.furn.length;
    expect(PlanSchema.safeParse(plan).success).toBe(true);
    expectInvariantFailure(plan);
  });

  it.each([
    ['orthogonality', (plan: Plan) => { plan.qa.orthogonal = 0.99; }],
    ['wall count', (plan: Plan) => { plan.qa.walls++; }],
    ['furniture count', (plan: Plan) => { plan.qa.pieces++; }],
  ])('rejects an inaccurate QA %s', (_description, mutate) => {
    const plan = fixture();
    mutate(plan);
    expectInvariantFailure(plan);
  });
});
