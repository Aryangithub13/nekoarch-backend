// This compile-only fixture deliberately excludes Node ambient types.
import {
  CreatePlanRequestSchema,
  GetPlanResponseSchema,
  type GetPlanResponse,
  type PlanInput,
} from '../src/index.js';

export function createBrowserRequest(plan: PlanInput): Request {
  return new Request('https://example.invalid/api/plans', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(CreatePlanRequestSchema.parse({ plan })),
  });
}

export async function parseBrowserResponse(response: Response): Promise<GetPlanResponse> {
  const body: unknown = await response.json();
  return GetPlanResponseSchema.parse(body);
}
