import {
  EstimateInputsSchema,
  EstimateResponseSchema,
  type EstimateInputs,
  type EstimateResponse,
  type Tier,
  type TierEstimate,
} from '@designflow/shared';
import { Decimal } from 'decimal.js';
import { DISCLAIMER, SOIL_DISCLAIMER } from '../content/disclaimers.js';
import { ApiError } from '../lib/errors.js';
import type { Repository } from '../lib/repository.js';
import { resolveRates, type ValidatedRateEntry } from './rate-service.js';

const Money = Decimal.clone({ precision: 50, rounding: Decimal.ROUND_HALF_UP });
type EstimateRepository = Pick<Repository, 'getRateVersions' | 'getRateEntries' | 'getPlan' | 'insertEstimate'>;

function unsupportedMagnitude(): ApiError {
  return new ApiError(400, 'ESTIMATE_OUT_OF_RANGE', 'The supplied area cannot produce a distinct estimate range at the supported currency precision.');
}

function moneyFromCents(cents: Decimal): number {
  if (!cents.isFinite() || cents.abs().gt(Number.MAX_SAFE_INTEGER)) throw unsupportedMagnitude();
  const amount = cents.div(100);
  const value = amount.toNumber();
  // JSON numbers must preserve the exact decimal amount when a client reads them back.
  if (!new Money(value).eq(amount)) throw unsupportedMagnitude();
  return value;
}

/**
 * Largest-remainder allocation in integer cents. Ties use category-name order.
 * Allocate the minimum and the range increase independently, then add them, so
 * every category's maximum stays >= its minimum. Both endpoints reconcile exactly.
 */
function allocateCents(total: Decimal, weights: Record<string, number>): Map<string, Decimal> {
  const rows = Object.entries(weights).map(([category, weight]) => {
    const exact = total.times(weight);
    const cents = exact.floor();
    return { category, cents, remainder: exact.minus(cents) };
  });
  const assigned = rows.reduce((sum, row) => sum.plus(row.cents), new Money(0));
  const remainder = total.minus(assigned).toNumber();
  rows.sort((left, right) => right.remainder.comparedTo(left.remainder)
    || (left.category < right.category ? -1 : left.category > right.category ? 1 : 0));
  for (const row of rows.slice(0, remainder)) row.cents = row.cents.plus(1);
  return new Map(rows.map((row) => [row.category, row.cents]));
}

function materials(tier: Tier): Record<string, string> {
  const finishLevel = {
    basic: 'Economical, readily available finishes and fixtures.',
    standard: 'Mid-range finishes and fixtures with a broader choice of specifications.',
    premium: 'Higher-end finishes and fixtures; bespoke selections may exceed this range.',
  } satisfies Record<Tier, string>;
  return {
    finishes: finishLevel[tier],
    specificationBasis: 'Qualitative tier descriptions only. Material and structural specifications require a licensed local professional.',
    timelineBasis: 'Timeline is an unvalidated planning heuristic from total floor area and floor count; approvals, procurement and site conditions can change it.',
  };
}

function estimateTier(entry: ValidatedRateEntry, inputs: EstimateInputs): TierEstimate {
  // builtUpAreaSqft is TOTAL area across every floor. Multiplying by floors again
  // would double-count costs. A budget is saved as context and never changes rates.
  const area = new Money(inputs.builtUpAreaSqft);
  const minCents = area.times(entry.rate_per_sqft_min).times(100).toDecimalPlaces(0);
  const maxCents = area.times(entry.rate_per_sqft_max).times(100).toDecimalPlaces(0);
  if (!maxCents.gt(minCents) || minCents.lte(0)) throw unsupportedMagnitude();
  const rangeMin = moneyFromCents(minCents);
  const rangeMax = moneyFromCents(maxCents);
  const minimums = allocateCents(minCents, entry.category_breakdown);
  const increases = allocateCents(maxCents.minus(minCents), entry.category_breakdown);
  const breakdown = [...minimums.keys()].sort().map((category) => {
    const minimum = minimums.get(category)!;
    return {
      category,
      min: moneyFromCents(minimum),
      max: moneyFromCents(minimum.plus(increases.get(category)!)),
    };
  });
  // Explicit demonstration heuristic, not a rate-table-derived construction schedule.
  // First month bound = ceil(4 + total sqft / 2000 + 1.5 * additional floors).
  const earliest = Math.ceil(4 + inputs.builtUpAreaSqft / 2000 + (inputs.floors - 1) * 1.5);
  return {
    tier: entry.tier,
    rangeMin,
    rangeMax,
    breakdown,
    materials: materials(entry.tier),
    timelineMonths: [earliest, Math.ceil(earliest * 1.5 + 2)],
  };
}

export async function createEstimate(
  repository: EstimateRepository,
  userId: string,
  rawInputs: EstimateInputs,
  now = new Date(),
): Promise<EstimateResponse> {
  const inputs = EstimateInputsSchema.parse(rawInputs);
  if (inputs.planId && !(await repository.getPlan(inputs.planId))) {
    throw new ApiError(404, 'NOT_FOUND', 'Plan not found.');
  }
  const resolved = await resolveRates(repository, inputs, now);
  const tiers = resolved.entries.map((entry) => estimateTier(entry, inputs));
  const result = EstimateResponseSchema.parse({
    tiers,
    region: resolved.region,
    disclaimer: DISCLAIMER,
    soilDisclaimer: SOIL_DISCLAIMER,
  });
  await repository.insertEstimate({
    plan_id: inputs.planId ?? null,
    user_id: userId,
    location: inputs.location,
    building_type: inputs.buildingType,
    built_up_area_sqft: inputs.builtUpAreaSqft,
    floors: inputs.floors,
    budget_provided: inputs.budget ?? null,
    rate_table_version: resolved.version.id,
    tier_basic: result.tiers[0],
    tier_standard: result.tiers[1],
    tier_premium: result.tiers[2],
    soil_note: SOIL_DISCLAIMER,
  });
  return result;
}
