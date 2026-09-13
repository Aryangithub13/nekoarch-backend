import {
  BuildingTypeSchema,
  RegionSchema,
  RegionsResponseSchema,
  TierSchema,
  type EstimateInputs,
  type Region,
  type RegionsResponse,
} from '@designflow/shared';
import { Decimal } from 'decimal.js';
import { z } from 'zod';
import { ApiError } from '../lib/errors.js';
import type { Repository } from '../lib/repository.js';

// This is an identity/label, never a source of prices. Every price comes from PostgreSQL.
export const BASELINE_REGION = 'India baseline (illustrative)';
const TIERS = ['basic', 'standard', 'premium'] as const;
const Money = Decimal.clone({ precision: 50, rounding: Decimal.ROUND_HALF_UP });
type RateRepository = Pick<Repository, 'getRateVersions' | 'getRateEntries'>;

const DecimalSchema = z.union([
  z.number().finite(),
  z.string().regex(/^-?\d+(?:\.\d+)?$/),
]).transform((value) => new Money(value));

const RateVersionSchema = z.object({
  id: z.string().uuid(),
  version_label: z.string().min(1),
  effective_date: z.string().date(),
  created_at: z.string().datetime({ offset: true }),
}).strict();

const RateEntrySchema = z.object({
  id: z.string().uuid(),
  version_id: z.string().uuid(),
  region: z.string().trim().min(1),
  building_type: BuildingTypeSchema,
  tier: TierSchema,
  rate_per_sqft_min: DecimalSchema.refine((value) => value.gt(0)),
  rate_per_sqft_max: DecimalSchema.refine((value) => value.gt(0)),
  category_breakdown: z.record(z.string().trim().min(1), z.number().finite().min(0).max(1)),
  is_active: z.boolean(),
}).strict().superRefine((entry, context) => {
  // Equal prices cannot produce the honest non-zero ranges required by this API.
  if (!entry.rate_per_sqft_max.gt(entry.rate_per_sqft_min)) {
    context.addIssue({ code: 'custom', path: ['rate_per_sqft_max'], message: 'A non-zero rate range is required' });
  }
  const weights = Object.values(entry.category_breakdown);
  if (weights.length === 0 || !weights.reduce((total, weight) => total.plus(weight), new Money(0)).eq(1)) {
    context.addIssue({ code: 'custom', path: ['category_breakdown'], message: 'Category weights must sum to exactly one' });
  }
});

export type ValidatedRateEntry = z.infer<typeof RateEntrySchema>;

function invalidRates(): ApiError {
  return new ApiError(503, 'RATE_DATA_INVALID', 'The current rate data failed validation. Please try again later.');
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeLocation(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Select one published version globally, then keep all three tiers inside that version. */
async function currentRateSet(repository: RateRepository, now: Date) {
  const versions = z.array(RateVersionSchema).safeParse(await repository.getRateVersions());
  if (!versions.success || !Number.isFinite(now.getTime())) throw invalidRates();
  const today = now.toISOString().slice(0, 10);
  const applicable = versions.data.filter((version) => version.effective_date <= today).sort((left, right) =>
    compareText(right.effective_date, left.effective_date)
      || Date.parse(right.created_at) - Date.parse(left.created_at)
      || compareText(right.id, left.id),
  );
  for (const version of applicable) {
    const result = z.array(RateEntrySchema).safeParse(await repository.getRateEntries(version.id));
    if (!result.success) throw invalidRates();
    const entries = result.data.filter((entry) => entry.is_active);
    if (entries.length === 0) continue;
    const keys = new Set<string>();
    const regionSpellings = new Map<string, string>();
    for (const entry of entries) {
      if (entry.version_id !== version.id) throw invalidRates();
      const regionKey = normalizeLocation(entry.region);
      const spelling = regionSpellings.get(regionKey);
      if (spelling !== undefined && spelling !== entry.region) throw invalidRates();
      regionSpellings.set(regionKey, entry.region);
      const key = JSON.stringify([regionKey, entry.building_type, entry.tier]);
      if (keys.has(key)) throw invalidRates();
      keys.add(key);
    }
    return { version, entries };
  }
  throw new ApiError(503, 'RATE_DATA_UNAVAILABLE', 'No effective rate dataset is available. Please try again later.');
}

function completeGrid(entries: ValidatedRateEntry[]): [ValidatedRateEntry, ValidatedRateEntry, ValidatedRateEntry] {
  const basic = entries.find((entry) => entry.tier === 'basic');
  const standard = entries.find((entry) => entry.tier === 'standard');
  const premium = entries.find((entry) => entry.tier === 'premium');
  if (entries.length !== TIERS.length || !basic || !standard || !premium) {
    throw new ApiError(503, 'RATE_GRID_INCOMPLETE', 'The current rate dataset does not contain all three estimate tiers for this building type.');
  }
  return [basic, standard, premium];
}

function describeRegion(name: string, entries: ValidatedRateEntry[], isFallback: boolean): Region {
  const buildingTypes = [...new Set(entries.filter((entry) => entry.region === name).map((entry) => entry.building_type))].sort(compareText);
  return RegionSchema.parse({
    name,
    buildingTypes,
    isBaseline: normalizeLocation(name) === normalizeLocation(BASELINE_REGION),
    isFallback,
  });
}

export async function getRegions(repository: RateRepository, now = new Date()): Promise<RegionsResponse> {
  const { version, entries } = await currentRateSet(repository, now);
  const names = [...new Set(entries.map((entry) => entry.region))].sort(compareText);
  const regions = names.map((name) => {
    const region = describeRegion(name, entries, false);
    for (const buildingType of region.buildingTypes) {
      completeGrid(entries.filter((entry) => entry.region === name && entry.building_type === buildingType));
    }
    return region;
  });
  return RegionsResponseSchema.parse({ regions, lastUpdated: version.effective_date });
}

export async function resolveRates(repository: RateRepository, inputs: EstimateInputs, now = new Date()) {
  const { version, entries } = await currentRateSet(repository, now);
  const match = entries.find((entry) => normalizeLocation(entry.region) === normalizeLocation(inputs.location));
  const selected = match ?? entries.find((entry) => normalizeLocation(entry.region) === normalizeLocation(BASELINE_REGION));
  if (!selected) {
    throw new ApiError(503, 'RATE_DATA_UNAVAILABLE', 'No rates or labelled baseline are available for this location.');
  }
  const region = describeRegion(selected.region, entries, match === undefined);
  const grid = completeGrid(entries.filter((entry) => entry.region === selected.region && entry.building_type === inputs.buildingType));
  return { version, entries: grid, region };
}
