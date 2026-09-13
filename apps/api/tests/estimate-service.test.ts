import { EstimateResponseSchema, RegionsResponseSchema, type EstimateInputs } from '@designflow/shared';
import { Decimal } from 'decimal.js';
import { describe, expect, it, vi } from 'vitest';
import { DISCLAIMER, SOIL_DISCLAIMER } from '../src/content/disclaimers.js';
import type { EstimateInsert, RateEntry, RateVersion, Repository } from '../src/lib/repository.js';
import { createEstimate } from '../src/services/estimate-service.js';
import { BASELINE_REGION, getRegions, resolveRates } from '../src/services/rate-service.js';

const NOW = new Date('2026-09-12T12:00:00.000Z');
const USER_ID = '00000000-0000-4000-8000-000000000001';
const VERSION_ID = '00000000-0000-4000-8000-000000000002';
const OLD_VERSION_ID = '00000000-0000-4000-8000-000000000003';
const FUTURE_VERSION_ID = '00000000-0000-4000-8000-000000000004';
const PLAN_ID = '00000000-0000-4000-8000-000000000005';
const inputs: EstimateInputs = {
  location: BASELINE_REGION,
  buildingType: 'residential',
  builtUpAreaSqft: 1000,
  floors: 1,
};

function version(id = VERSION_ID, effectiveDate = '2026-09-01'): RateVersion {
  return { id, version_label: `test-illustrative-${id}`, effective_date: effectiveDate, created_at: `${effectiveDate}T00:00:00.000Z` };
}

// Test-only illustrative values. Application prices are sourced exclusively from PostgreSQL.
function entries(versionId = VERSION_ID, region = BASELINE_REGION, buildingType: RateEntry['building_type'] = 'residential'): RateEntry[] {
  return (['basic', 'standard', 'premium'] as const).map((tier, index) => ({
    id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    version_id: versionId,
    region,
    building_type: buildingType,
    tier,
    rate_per_sqft_min: String(1000 + index * 500),
    rate_per_sqft_max: String(1200 + index * 600),
    category_breakdown: { structure: 0.5, finishes: 0.3, services: 0.2 },
    is_active: true,
  }));
}

function fixture(initialVersions = [version()], initialEntries = entries()) {
  const state = { versions: initialVersions, entries: initialEntries, saved: [] as EstimateInsert[] };
  const repository = {
    getRateVersions: vi.fn<Repository['getRateVersions']>(async () => state.versions),
    getRateEntries: vi.fn<Repository['getRateEntries']>(async (id) => state.entries.filter((entry) => entry.version_id === id)),
    getPlan: vi.fn<Repository['getPlan']>().mockResolvedValue(null),
    insertEstimate: vi.fn<Repository['insertEstimate']>(async (row) => { state.saved.push(structuredClone(row)); }),
  };
  return { state, repository };
}

function sum(values: number[]): Decimal {
  return values.reduce((total, value) => total.plus(value), new Decimal(0));
}

describe('estimate calculation and provenance', () => {
  it('returns ordered, validated ranges and saves the exact selected version and principal', async () => {
    const { repository, state } = fixture();
    const result = await createEstimate(repository, USER_ID, inputs, NOW);
    expect(EstimateResponseSchema.parse(result)).toEqual(result);
    expect(result.tiers.map((tier) => tier.tier)).toEqual(['basic', 'standard', 'premium']);
    expect(result.tiers[0]).toMatchObject({ rangeMin: 1_000_000, rangeMax: 1_200_000 });
    for (const tier of result.tiers) {
      expect(tier.rangeMin).toBeLessThan(tier.rangeMax);
      expect(sum(tier.breakdown.map((row) => row.min)).eq(tier.rangeMin)).toBe(true);
      expect(sum(tier.breakdown.map((row) => row.max)).eq(tier.rangeMax)).toBe(true);
    }
    expect(state.saved).toHaveLength(1);
    expect(state.saved[0]).toMatchObject({
      user_id: USER_ID, plan_id: null, rate_table_version: VERSION_ID,
      budget_provided: null, built_up_area_sqft: 1000, floors: 1,
      tier_basic: result.tiers[0], tier_standard: result.tiers[1], tier_premium: result.tiers[2],
    });
  });

  it('retains a provided budget without changing the market range', async () => {
    const { repository, state } = fixture();
    const withoutBudget = await createEstimate(repository, USER_ID, inputs, NOW);
    const withBudget = await createEstimate(repository, USER_ID, { ...inputs, budget: 25_000 }, NOW);
    expect(withBudget).toEqual(withoutBudget);
    expect(state.saved[1]?.budget_provided).toBe(25_000);
  });

  it('treats area as total across floors, with floors affecting only the labelled heuristic timeline', async () => {
    const { repository } = fixture();
    const oneFloor = await createEstimate(repository, USER_ID, inputs, NOW);
    const threeFloors = await createEstimate(repository, USER_ID, { ...inputs, floors: 3 }, NOW);
    expect(threeFloors.tiers[0].rangeMin).toBe(oneFloor.tiers[0].rangeMin);
    expect(threeFloors.tiers[0].rangeMax).toBe(oneFloor.tiers[0].rangeMax);
    expect(threeFloors.tiers[0].timelineMonths[0]).toBeGreaterThan(oneFloor.tiers[0].timelineMonths[0]);
    expect(threeFloors.tiers[0].materials.timelineBasis).toContain('unvalidated planning heuristic');
  });

  it('uses decimal half-up rounding and reconciles fractional category weights exactly', async () => {
    const data = entries();
    data[0] = { ...data[0]!, rate_per_sqft_min: '1.005', rate_per_sqft_max: '1.035', category_breakdown: { alpha: 0.333, beta: 0.333, gamma: 0.334 } };
    const { repository } = fixture([version()], data);
    const result = await createEstimate(repository, USER_ID, { ...inputs, builtUpAreaSqft: 1 }, NOW);
    expect(result.tiers[0]).toMatchObject({ rangeMin: 1.01, rangeMax: 1.04 });
    expect(result.tiers[0].breakdown).toEqual([
      { category: 'alpha', min: 0.34, max: 0.35 },
      { category: 'beta', min: 0.33, max: 0.34 },
      { category: 'gamma', min: 0.34, max: 0.35 },
    ]);
  });

  it('keeps category intervals monotone across narrow one-cent ranges with deterministic residual allocation', async () => {
    const data = entries();
    data[0] = { ...data[0]!, rate_per_sqft_min: '1', rate_per_sqft_max: '1.0001', category_breakdown: { a: 0.29, b: 0.19, c: 0.17, d: 0.15, e: 0.11, f: 0.09 } };
    const { repository } = fixture([version()], data);
    for (let area = 100.01; area < 100.2; area += 0.01) {
      const result = await createEstimate(repository, USER_ID, { ...inputs, builtUpAreaSqft: Number(area.toFixed(2)) }, NOW);
      const tier = result.tiers[0];
      expect(sum(tier.breakdown.map((row) => row.min)).eq(tier.rangeMin)).toBe(true);
      expect(sum(tier.breakdown.map((row) => row.max)).eq(tier.rangeMax)).toBe(true);
      expect(tier.breakdown.every((row) => row.max >= row.min)).toBe(true);
    }
  });

  it('preserves previous saved estimates when a newer version is published', async () => {
    const { repository, state } = fixture([version(OLD_VERSION_ID, '2026-08-01')], entries(OLD_VERSION_ID));
    await createEstimate(repository, USER_ID, inputs, NOW);
    const historical = structuredClone(state.saved[0]);
    state.versions.push(version());
    state.entries.push(...entries().map((entry) => ({ ...entry, rate_per_sqft_min: 5000, rate_per_sqft_max: 6000 })));
    await createEstimate(repository, USER_ID, inputs, NOW);
    expect(state.saved[0]).toEqual(historical);
    expect(state.saved[0]?.rate_table_version).toBe(OLD_VERSION_ID);
    expect(state.saved[1]?.rate_table_version).toBe(VERSION_ID);
    expect(state.saved[1]?.tier_basic.rangeMin).toBe(5_000_000);
  });

  it('requires read access to a supplied plan before fetching prices or persisting', async () => {
    const { repository } = fixture();
    await expect(createEstimate(repository, USER_ID, { ...inputs, planId: PLAN_ID }, NOW)).rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
    expect(repository.getPlan).toHaveBeenCalledWith(PLAN_ID);
    expect(repository.getRateVersions).not.toHaveBeenCalled();
    expect(repository.insertEstimate).not.toHaveBeenCalled();
  });

  it('links an accessible plan using the caller-scoped repository', async () => {
    const { repository, state } = fixture();
    repository.getPlan.mockResolvedValue({ id: PLAN_ID, plan_data: {} });
    await createEstimate(repository, USER_ID, { ...inputs, planId: PLAN_ID }, NOW);
    expect(state.saved[0]?.plan_id).toBe(PLAN_ID);
  });

  it.each([1e-12, 1e100])('rejects area %s when cents cannot represent a usable range', async (area) => {
    const { repository } = fixture();
    await expect(createEstimate(repository, USER_ID, { ...inputs, builtUpAreaSqft: area }, NOW)).rejects.toMatchObject({ statusCode: 400, code: 'ESTIMATE_OUT_OF_RANGE' });
    expect(repository.insertEstimate).not.toHaveBeenCalled();
  });

  it('returns and stores the approved exact disclaimer text', async () => {
    const expectedEstimate = 'This estimate is an illustrative early-stage range based on dated regional reference rates and the information provided. It is not a quotation, bill of quantities, or certified professional assessment. Consult a licensed local architect, engineer, contractor, or quantity surveyor before making financial or construction decisions.';
    const expectedSoil = 'Soil information is general contextual guidance only and is not a substitute for a site-specific geotechnical investigation. Consult a qualified local geotechnical or structural professional before foundation design or construction.';
    const { repository, state } = fixture();
    const result = await createEstimate(repository, USER_ID, inputs, NOW);
    expect(DISCLAIMER).toBe(expectedEstimate);
    expect(SOIL_DISCLAIMER).toBe(expectedSoil);
    expect(result.disclaimer).toBe(expectedEstimate);
    expect(result.soilDisclaimer).toBe(expectedSoil);
    expect(state.saved[0]?.soil_note).toBe(expectedSoil);
  });
});

describe('versioned regional rate resolution', () => {
  it('labels unknown-location fallback explicitly and retains the requested location in persistence', async () => {
    const { repository, state } = fixture();
    const result = await createEstimate(repository, USER_ID, { ...inputs, location: 'Unknown Town' }, NOW);
    expect(result.region).toMatchObject({ name: BASELINE_REGION, isBaseline: true, isFallback: true });
    expect(state.saved[0]?.location).toBe('Unknown Town');
  });

  it('normalizes whitespace and casing while returning the canonical known region name', async () => {
    const { repository } = fixture([version()], [...entries(), ...entries(VERSION_ID, 'Demonstration City')]);
    const result = await resolveRates(repository, { ...inputs, location: '  demonstration   CITY  ' }, NOW);
    expect(result.region).toMatchObject({ name: 'Demonstration City', isBaseline: false, isFallback: false });
    expect((await resolveRates(repository, inputs, NOW)).region.isFallback).toBe(false);
  });

  it('selects the most recent effective version even from unsorted history, ignoring future entries', async () => {
    const { repository } = fixture(
      [version(OLD_VERSION_ID, '2026-08-01'), version(FUTURE_VERSION_ID, '2027-01-01'), version()],
      [...entries(OLD_VERSION_ID), ...entries(FUTURE_VERSION_ID), ...entries()],
    );
    const result = await resolveRates(repository, inputs, NOW);
    expect(result.version.id).toBe(VERSION_ID);
    expect(repository.getRateEntries).toHaveBeenCalledExactlyOnceWith(VERSION_ID);
  });

  it('breaks equal effective dates by created timestamp', async () => {
    const first = version(OLD_VERSION_ID);
    const second = { ...version(), created_at: '2026-09-01T01:00:00.000Z' };
    const { repository } = fixture([first, second], [...entries(OLD_VERSION_ID), ...entries()]);
    expect((await resolveRates(repository, inputs, NOW)).version.id).toBe(VERSION_ID);
  });

  it('can use a prior version when a newer effective version has no active entries', async () => {
    const { repository } = fixture([version(), version(OLD_VERSION_ID, '2026-08-01')], [
      ...entries().map((entry) => ({ ...entry, is_active: false })), ...entries(OLD_VERSION_ID),
    ]);
    expect((await resolveRates(repository, inputs, NOW)).version.id).toBe(OLD_VERSION_ID);
  });

  it('never borrows a missing tier from an older complete version', async () => {
    const { repository } = fixture([version(), version(OLD_VERSION_ID, '2026-08-01')], [
      ...entries().filter((entry) => entry.tier !== 'premium'), ...entries(OLD_VERSION_ID),
    ]);
    await expect(createEstimate(repository, USER_ID, inputs, NOW)).rejects.toMatchObject({ statusCode: 503, code: 'RATE_GRID_INCOMPLETE' });
    expect(repository.getRateEntries).toHaveBeenCalledExactlyOnceWith(VERSION_ID);
    expect(repository.insertEstimate).not.toHaveBeenCalled();
  });

  it('fails an unavailable building type in a known region instead of mislabelling fallback as local data', async () => {
    const { repository } = fixture([version()], [...entries(), ...entries(VERSION_ID, 'Demo City', 'commercial')]);
    await expect(resolveRates(repository, { ...inputs, location: 'Demo City' }, NOW)).rejects.toMatchObject({ code: 'RATE_GRID_INCOMPLETE' });
  });

  it('returns a typed error when neither a location nor the named baseline exists', async () => {
    const { repository } = fixture([version()], entries(VERSION_ID, 'Demo City'));
    await expect(resolveRates(repository, inputs, NOW)).rejects.toMatchObject({ statusCode: 503, code: 'RATE_DATA_UNAVAILABLE' });
  });

  it('returns a typed error when no applicable rate version exists', async () => {
    const { repository } = fixture([version(FUTURE_VERSION_ID, '2027-01-01')], entries(FUTURE_VERSION_ID));
    await expect(getRegions(repository, NOW)).rejects.toMatchObject({ statusCode: 503, code: 'RATE_DATA_UNAVAILABLE' });
    expect(repository.getRateEntries).not.toHaveBeenCalled();
  });

  it('lists distinct regions and only their supported complete building-type grids', async () => {
    const { repository } = fixture([version()], [
      ...entries(), ...entries(VERSION_ID, BASELINE_REGION, 'commercial'),
      ...entries(VERSION_ID, BASELINE_REGION, 'institutional'), ...entries(VERSION_ID, 'Demo City'),
    ]);
    const result = await getRegions(repository, NOW);
    expect(RegionsResponseSchema.parse(result)).toEqual(result);
    expect(result).toEqual({
      lastUpdated: '2026-09-01',
      regions: [
        { name: 'Demo City', buildingTypes: ['residential'], isBaseline: false, isFallback: false },
        { name: BASELINE_REGION, buildingTypes: ['commercial', 'institutional', 'residential'], isBaseline: true, isFallback: false },
      ],
    });
  });

  it('rejects incomplete region grids in the region directory', async () => {
    const { repository } = fixture([version()], entries().slice(0, 2));
    await expect(getRegions(repository, NOW)).rejects.toMatchObject({ code: 'RATE_GRID_INCOMPLETE' });
  });

  it.each([
    { rate_per_sqft_min: '-1' },
    { rate_per_sqft_min: 'NaN' },
    { rate_per_sqft_max: '1000' },
    { category_breakdown: { structure: 0.5, finishes: 0.49 } },
    { category_breakdown: { structure: 1.1, finishes: -0.1 } },
    { category_breakdown: {} },
  ])('rejects invalid database data without persisting: %j', async (override) => {
    const data = entries();
    data[0] = { ...data[0]!, ...override };
    const { repository } = fixture([version()], data);
    await expect(createEstimate(repository, USER_ID, inputs, NOW)).rejects.toMatchObject({ statusCode: 503, code: 'RATE_DATA_INVALID' });
    expect(repository.insertEstimate).not.toHaveBeenCalled();
  });

  it('rejects duplicate tier rows and ambiguous normalized region names', async () => {
    const duplicate = fixture([version()], [...entries(), entries()[0]!]);
    await expect(getRegions(duplicate.repository, NOW)).rejects.toMatchObject({ code: 'RATE_DATA_INVALID' });
    const ambiguous = fixture([version()], [...entries(), ...entries(VERSION_ID, BASELINE_REGION.toUpperCase())]);
    await expect(getRegions(ambiguous.repository, NOW)).rejects.toMatchObject({ code: 'RATE_DATA_INVALID' });
  });
});
