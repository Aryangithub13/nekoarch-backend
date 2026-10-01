import { z } from 'zod';

const id = z.string().uuid();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const GenerationIdentitySchema = z.object({
  identityVersion: z.literal('generation-freshness-v1'),
  generationId: id.nullable(), requirementsHash: hash.nullable(), modelHash: hash,
  seed: z.string().min(1).max(128).nullable(),
}).strict();

const artifact = z.discriminatedUnion('status', [
  z.object({ status: z.literal('AVAILABLE'), artifactId: id, sourceRevisionId: id,
    sourceArtifactIds: z.array(id).max(3) }).strict(),
  z.object({ status: z.literal('NOT_GENERATED_FOR_CURRENT_REVISION'), sourceRevisionId: id }).strict(),
  z.object({ status: z.literal('NO_CURRENT_REVISION'), sourceRevisionId: z.null() }).strict(),
]);
export const CurrentArtifactsSchema = z.object({ takeoff: artifact, construction: artifact, cost: artifact }).strict();
export const ProjectReadQuerySchema = z.object({ includeFreshness: z.enum(['true', 'false']).optional() }).strict();
