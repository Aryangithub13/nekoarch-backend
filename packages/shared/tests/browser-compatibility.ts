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

// Phase 9 public model, precision and adapter exports must also compile without Node.
import {
  BuildingModelV2Schema, deserializeBuildingModel, serializeBuildingModel,
  toMillimetres, polygonAreaMm2, upgradePlanV1,
} from '../src/index.js';
export function useBuildingModelInBrowser(raw: unknown, legacy: PlanInput): string {
  const model = BuildingModelV2Schema.parse(raw);
  const json = serializeBuildingModel(model);
  deserializeBuildingModel(json);
  toMillimetres('1', 'ft');
  polygonAreaMm2(model.levels[0]!.boundary);
  upgradePlanV1(legacy, 'browser-building');
  return json;
}
