import { randomBytes } from 'node:crypto';
import { SavedPlanSchema, type PlanInput } from '@designflow/shared';
import type { PlanRecord, Repository } from '../lib/repository.js';
import { ApiError } from '../lib/errors.js';

function savedPlan(record: PlanRecord | null) {
  if (!record) throw new ApiError(404, 'NOT_FOUND', 'Plan not found');
  // Validate stored JSON too; corrupt data is an internal failure, not a caller's 400.
  if (!record.plan_data || typeof record.plan_data !== 'object' || Array.isArray(record.plan_data)) throw new Error('Invalid stored plan');
  return SavedPlanSchema.parse({ ...record.plan_data, id: record.id });
}
export async function createPlan(repository: Repository, userId: string, plan: PlanInput) {
  const shareToken = randomBytes(32).toString('base64url');
  const record = await repository.insertPlan({ user_id: userId, prompt: plan.prompt, seed: plan.seed, variant: plan.variant,
    plan_data: plan, qa_orthogonal: plan.qa.orthogonal, bounds_width_m: plan.bounds.w, bounds_depth_m: plan.bounds.d,
    room_count: plan.rooms.length, share_token: shareToken });
  return { plan: savedPlan(record), shareToken };
}
export async function getPlan(repository: Repository, id: string) { return { plan: savedPlan(await repository.getPlan(id)) }; }
export async function patchPlan(repository: Repository, id: string, isPublic: boolean) { return { plan: savedPlan(await repository.patchPlan(id, isPublic)) }; }
