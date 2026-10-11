import { z } from 'zod';
import type { IdempotencyContext, Repository } from './repository.js';
import { ApiError, parseRequest } from './errors.js';
import { projectDatabaseError } from './project-repository.js';
import { SceneManifestSchema } from '../scene3d/contracts.js';

export function sceneDatabaseError(error: { code?: string }): never {
  const errors: Record<string, [number, string, string]> = {
    P2901: [404, 'SCENE_ARTIFACT_NOT_FOUND', 'Scene artifact not found'],
    P2902: [422, 'REVISION_NOT_ACCEPTED', 'Revision has no accepted QA evidence'],
    P2903: [422, 'SCENE_ARTIFACT_INVALID', 'Scene artifact provenance validation failed'],
  };
  const mapped = error.code ? errors[error.code] : undefined;
  if (mapped) throw new ApiError(...mapped);
  projectDatabaseError(error);
}
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const SceneSummarySchema = z.object({ id: z.string().uuid(), projectRevisionId: z.string().uuid(), acceptanceQaId: z.string().uuid(),
  manifestVersion: z.literal('scene-manifest-v1'), compilerVersion: z.literal('scene-compiler-v1'), validatorVersion: z.literal('scene-validator-v1'),
  modelHash: hash, inputHash: hash, sceneHash: hash, binarySha256: hash, binaryBytes: z.number().int().positive(), storageLocator: z.literal('postgres-bytea'),
  status: z.literal('READY'), objectCount: z.number().int().positive(), triangleCount: z.number().int().positive(), createdAt: z.string() }).strict();
export const SceneDetailSchema = SceneSummarySchema.extend({ manifest: SceneManifestSchema }).strict();
export const SceneCursorSchema = z.object({ createdAt: z.string().datetime({ offset: true }), id: z.string().uuid() }).strict();
const current = z.string().uuid().nullable();

/** Storage boundary for scene artifacts: the Supabase and pg-backend adapters implement `sceneRpc` (bytes live in Postgres `bytea`). */
export class SceneRepository {
  constructor(private readonly repository: Repository) {}
  private rpc(name: 'scene_read' | 'scene_write', args: Record<string, unknown>) {
    if (!this.repository.sceneRpc) throw new ApiError(503, 'SCENE_UNAVAILABLE', 'Scene persistence is unavailable');
    return this.repository.sceneRpc(name, args);
  }
  async read(projectId: string, revisionId: string, artifactId: string) {
    const { projectCurrentRevisionId, ...detail } = z.object({ projectCurrentRevisionId: current }).passthrough()
      .parse(await this.rpc('scene_read', { p_action: 'get', p_project_id: projectId, p_revision_id: revisionId, p_artifact_id: artifactId }));
    return { detail: SceneDetailSchema.parse(detail), projectCurrentRevisionId };
  }
  async binary(projectId: string, revisionId: string, artifactId: string) {
    const { projectCurrentRevisionId, glbBase64, ...summary } = z.object({ projectCurrentRevisionId: current, glbBase64: z.string().max(23_000_000) }).passthrough()
      .parse(await this.rpc('scene_read', { p_action: 'glb', p_project_id: projectId, p_revision_id: revisionId, p_artifact_id: artifactId }));
    return { summary: SceneSummarySchema.parse(summary), glb: Buffer.from(glbBase64, 'base64'), projectCurrentRevisionId };
  }
  async list(projectId: string, revisionId: string, query: { limit: number; cursor?: string | undefined }) {
    let cursor: unknown = null;
    if (query.cursor) {
      try { cursor = JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')); }
      catch { throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid pagination cursor'); }
      cursor = parseRequest(SceneCursorSchema, cursor);
    }
    const raw = z.object({ items: z.array(SceneSummarySchema).max(100), nextCursor: SceneCursorSchema.nullable(), projectCurrentRevisionId: current }).strict().parse(
      await this.rpc('scene_read', { p_action: 'list', p_project_id: projectId, p_revision_id: revisionId, p_limit: query.limit, p_cursor: cursor }));
    return { ...raw, nextCursor: raw.nextCursor ? Buffer.from(JSON.stringify(raw.nextCursor)).toString('base64url') : null };
  }
  async status(projectId: string, revisionId: string) {
    return z.object({ projectCurrentRevisionId: current, revisionNumber: z.number().int().positive(), artifacts: z.array(SceneSummarySchema).max(20),
      otherRevisionArtifacts: z.array(SceneSummarySchema.extend({ revisionNumber: z.number().int().positive() })).max(20) }).strict()
      .parse(await this.rpc('scene_read', { p_action: 'status', p_project_id: projectId, p_revision_id: revisionId }));
  }
  async write(input: unknown, glb: Buffer, attestation: { envelope: string; signature: string }, context?: IdempotencyContext) {
    return SceneDetailSchema.parse(await this.rpc('scene_write', { p_input: input, p_glb_base64: glb.toString('base64'), p_context: context ?? null,
      p_envelope: attestation.envelope, p_signature: attestation.signature }));
  }
}
