import { createHash, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import validator from 'gltf-validator';
import type { ProjectTestContext } from './project-acceptance.js';
import { parametricInput } from './parametric-fixtures.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
const sha = (b: Buffer | Uint8Array) => createHash('sha256').update(b).digest('hex');
const bin = (glb: Buffer) => glb.subarray(28 + glb.readUInt32LE(12));
const CORE = 'Redesign the exterior of my building using a contemporary glass-inspired façade. Keep the exact floor plans, internal rooms, stairs, structure, building dimensions, and existing interior unchanged.';
const consent = { acceptLocks: true, acceptQuote: true };

/** Phase 30 HTTP acceptance against the local Supabase stack (actual Auth JWTs, PostgREST, RLS and the signed SQL functions). */
export function revisionAcceptance(context: () => ProjectTestContext) {
  describe('Phase 30 selective revision acceptance', () => {
    const call = async (method: 'GET' | 'POST', url: string, payload?: unknown, status?: number, headers?: Record<string, string>) => {
      const { app, owner } = context();
      const r = await app.inject({ method, url, headers: headers ?? owner, ...(payload === undefined ? {} : { payload: payload as Json }) });
      if (status !== undefined) expect(r.statusCode, `${method} ${url}: ${r.body.slice(0, 600)}`).toBe(status);
      return r;
    };
    async function project(title: string) {
      const projectId = (await call('POST', '/api/projects', { title }, 201)).json().id as string;
      const a = (await call('POST', `/api/projects/${projectId}/revisions/generate`, { requirements: parametricInput(true) }, 201)).json().revision as Json;
      return { projectId, a, ops: `/api/projects/${projectId}/revision-operations`, rev: (id: string) => `/api/projects/${projectId}/revisions/${id}` };
    }
    const ready = async (ops: string, baseRevisionId: string, text = CORE) => {
      const pre = (await call('POST', ops, { baseRevisionId, request: { text } }, 201)).json() as Json;
      const cand = (await call('POST', `${ops}/${pre.id}/execute`, { preflightHash: pre.preflightHash, consent }, 200)).json() as Json;
      return { pre, cand };
    };

    it('primary flow: A → preflight → consent → validated candidate → comparison → approval → immutable B → restore as C', async () => {
      const { projectId, a, ops, rev } = await project('Phase 30 live primary');
      const pre = (await call('POST', ops, { baseRevisionId: a.id, request: { text: CORE } }, 201)).json() as Json;
      expect(pre).toMatchObject({ status: 'AWAITING_CONSENT', kind: 'APPEARANCE_MODIFY', baseRevisionId: a.id, candidate: null, committedRevisionId: null,
        preflight: { quote: { execution: 'LOCAL_DETERMINISTIC', externalProviders: [], externalCostUsd: 0 } } });
      expect(pre.preflight.targets.length).toBeGreaterThan(5);
      expect((await call('POST', `${ops}/${pre.id}/execute`, { preflightHash: 'f'.repeat(64), consent }, 409)).json().error.code).toBe('REVISION_CONSENT_MISMATCH');
      const cand = (await call('POST', `${ops}/${pre.id}/execute`, { preflightHash: pre.preflightHash, consent }, 200)).json() as Json;
      expect(cand).toMatchObject({ status: 'CANDIDATE_READY', validation: { status: 'VALID', geometryLock: { granularity: 'EXACT_BYTES', identical: true } } });
      expect((await call('GET', `/api/projects/${projectId}`, undefined, 200)).json().currentRevisionId).toBe(a.id);
      // Candidate bytes round-trip through PostgREST unchanged, are Khronos-valid and keep every geometry byte of A's Phase 29 scene.
      const res = await call('GET', `${ops}/${pre.id}/candidate/glb`, undefined, 200), glb = Buffer.from(res.rawPayload);
      expect(res.headers['x-candidate-status']).toBe('UNACCEPTED');
      expect(sha(glb)).toBe(cand.candidate.binarySha256);
      const khronos = await validator.validateBytes(new Uint8Array(glb), { maxIssues: 10 });
      expect([khronos.issues.numErrors, khronos.issues.numWarnings]).toEqual([0, 0]);
      const sceneA = (await call('POST', `${rev(a.id)}/scene/artifacts`, {}, 201)).json() as Json;
      const glbA = Buffer.from((await call('GET', `${rev(a.id)}/scene/artifacts/${sceneA.id}/glb`, undefined, 200)).rawPayload);
      expect(sha(glbA)).not.toBe(sha(glb));
      expect(Buffer.compare(bin(glbA), bin(glb))).toBe(0);
      expect((await call('GET', `${ops}/${pre.id}/comparison`, undefined, 200)).json()).toMatchObject({ hashes: { modelIdentical: true, geometryIdentical: true, baseGlbSha256: sha(glbA) }, approvalBlockers: [] });
      expect((await call('POST', `${ops}/${pre.id}/approve`, { preflightHash: pre.preflightHash, candidateHash: 'e'.repeat(64) }, 409)).json().error.code).toBe('REVISION_CONSENT_MISMATCH');
      const b = (await call('POST', `${ops}/${pre.id}/approve`, { preflightHash: pre.preflightHash, candidateHash: cand.candidateHash }, 201)).json().commit.revision as Json;
      expect(b).toMatchObject({ parentRevisionId: a.id, revisionNumber: 2, identity: { modelHash: a.identity.modelHash } });
      expect(b.model).toEqual(a.model);
      expect((await call('GET', rev(a.id), undefined, 200)).json()).toMatchObject({ id: a.id, model: a.model });
      expect((await call('GET', `${rev(b.id)}/appearance`, undefined, 200)).json()).toMatchObject({ status: 'APPEARANCE_VARIANT', lineage: { modelEquivalentToBase: true } });
      expect(sha(Buffer.from((await call('GET', `${rev(b.id)}/appearance/glb`, undefined, 200)).rawPayload))).toBe(sha(glb));
      expect((await call('POST', `${ops}/${pre.id}/approve`, { preflightHash: pre.preflightHash, candidateHash: cand.candidateHash }, 409)).json().error.code).toBe('REVISION_OPERATION_ALREADY_COMMITTED');
      expect((await call('GET', `${ops}/${pre.id}/validation`, undefined, 200)).json().events.map((e: Json) => e.eventType)).toEqual(['PREFLIGHT', 'CANDIDATE_READY', 'COMMITTED']);
      const r = (await call('POST', ops, { baseRevisionId: b.id, request: { text: 'Restore revision 1' } }, 201)).json() as Json;
      const rc = (await call('POST', `${ops}/${r.id}/execute`, { preflightHash: r.preflightHash, consent }, 200)).json() as Json;
      const c = (await call('POST', `${ops}/${r.id}/approve`, { preflightHash: r.preflightHash, candidateHash: rc.candidateHash }, 201)).json().commit.revision as Json;
      expect(c).toMatchObject({ parentRevisionId: b.id, revisionNumber: 3, identity: { modelHash: a.identity.modelHash } });
      expect((await call('GET', `${rev(c.id)}/appearance`, undefined, 200)).json()).toMatchObject({ status: 'DEFAULT_PLACEHOLDER', lineage: { operation: { kind: 'RESTORE' } } });
      expect((await call('GET', `/api/projects/${projectId}/revisions`, undefined, 200)).json().items.map((i: Json) => i.revisionNumber)).toEqual([3, 2, 1]);
    });

    it('locks, geometry and interior requests are refused truthfully and never execute', async () => {
      const { projectId, a, ops } = await project('Phase 30 live refusals');
      const blocked = (await call('POST', ops, { baseRevisionId: a.id, request: { text: 'Make larger glazing openings while keeping existing walls, openings and structure unchanged.' } }, 201)).json() as Json;
      expect(blocked.status).toBe('BLOCKED_BY_LOCK');
      expect((await call('POST', `${ops}/${blocked.id}/execute`, { preflightHash: blocked.preflightHash, consent }, 409)).json().error.code).toBe('REVISION_OPERATION_INVALID_STATE');
      expect((await call('POST', ops, { baseRevisionId: a.id, request: { text: 'Add more windows on the south side.' } }, 201)).json()).toMatchObject({ status: 'UNSUPPORTED', preflight: { blockers: [{ code: 'GEOMETRY_MODIFICATION_NOT_SUPPORTED' }] } });
      expect((await call('POST', ops, { baseRevisionId: a.id, request: { text: 'Use a warmer finish in the living room.' } }, 201)).json()).toMatchObject({ status: 'UNSUPPORTED', preflight: { blockers: [{ code: 'INTERIOR_FINISH_NOT_SUPPORTED' }] } });
      expect((await call('POST', ops, { baseRevisionId: a.id, request: { text: 'Give the house a glass facade.' } }, 201)).json().status).toBe('NEEDS_CLARIFICATION');
      expect((await call('GET', `/api/projects/${projectId}`, undefined, 200)).json().currentRevisionId).toBe(a.id);
    });

    it('rejects, cancels, and resolves stale and simultaneous approvals to exactly one commit', async () => {
      const { projectId, a, ops } = await project('Phase 30 live concurrency');
      const rejected = await ready(ops, a.id);
      expect((await call('POST', `${ops}/${rejected.pre.id}/reject`, {}, 200)).json().status).toBe('REJECTED');
      expect((await call('POST', `${ops}/${rejected.pre.id}/approve`, { preflightHash: rejected.pre.preflightHash, candidateHash: rejected.cand.candidateHash }, 409)).json().error.code).toBe('REVISION_OPERATION_INVALID_STATE');
      const cancelled = (await call('POST', ops, { baseRevisionId: a.id, request: { text: 'Make the exterior walls darker.' } }, 201)).json() as Json;
      expect((await call('POST', `${ops}/${cancelled.id}/cancel`, {}, 200)).json().status).toBe('CANCELLED');
      const one = await ready(ops, a.id), two = await ready(ops, a.id, 'Make the exterior walls darker.');
      const b = (await call('POST', `${ops}/${one.pre.id}/approve`, { preflightHash: one.pre.preflightHash, candidateHash: one.cand.candidateHash }, 201)).json().commit.revision as Json;
      expect((await call('POST', `${ops}/${two.pre.id}/approve`, { preflightHash: two.pre.preflightHash, candidateHash: two.cand.candidateHash }, 409)).json().error.code).toBe('REVISION_BASE_STALE');
      expect((await call('GET', `${ops}/${two.pre.id}`, undefined, 200)).json().status).toBe('STALE_BASE');
      const three = await ready(ops, b.id, 'Use a warm render on the exterior.'), four = await ready(ops, b.id, 'Use a light stone exterior finish.');
      const results = await Promise.all([three, four].map(x => call('POST', `${ops}/${x.pre.id}/approve`, { preflightHash: x.pre.preflightHash, candidateHash: x.cand.candidateHash })));
      expect(results.map(r => r.statusCode).sort()).toEqual([201, 409]);
      expect((await call('GET', `/api/projects/${projectId}`, undefined, 200)).json().currentRevisionNumber).toBe(3);
    });

    it('replays idempotent writes without duplicates and refuses other and anonymous users', async () => {
      const { projectId, a, ops, rev } = await project('Phase 30 live idempotency');
      const key = (k: string) => ({ ...context().owner, 'idempotency-key': k }), k = randomUUID();
      const p1 = await call('POST', ops, { baseRevisionId: a.id, request: { text: CORE } }, 201, key(`${k}-pre`)), p2 = await call('POST', ops, { baseRevisionId: a.id, request: { text: CORE } }, 201, key(`${k}-pre`));
      expect(p2.json().id).toBe(p1.json().id);
      const pre = p1.json() as Json, body = { preflightHash: pre.preflightHash, consent };
      const e1 = await call('POST', `${ops}/${pre.id}/execute`, body, 200, key(`${k}-exe`)), e2 = await call('POST', `${ops}/${pre.id}/execute`, body, 200, key(`${k}-exe`));
      expect(e2.json().candidateHash).toBe(e1.json().candidateHash);
      const other = context().other;
      for (const [method, url, payload] of [['POST', ops, { baseRevisionId: a.id, request: { text: CORE } }], ['GET', ops], ['GET', `${ops}/${pre.id}`], ['GET', `${ops}/${pre.id}/comparison`],
        ['GET', `${ops}/${pre.id}/candidate/glb`], ['GET', `${ops}/${pre.id}/candidate/manifest`], ['POST', `${ops}/${pre.id}/approve`, { preflightHash: pre.preflightHash, candidateHash: e1.json().candidateHash }],
        ['POST', `${ops}/${pre.id}/reject`, {}], ['GET', `${rev(a.id)}/appearance`]] as const) {
        expect((await call(method, url, payload, undefined, other)).statusCode, `${method} ${url}`).toBe(404);
        expect((await call(method, url, payload, undefined, {})).statusCode, `anon ${method} ${url}`).toBe(401);
      }
      const approve = { preflightHash: pre.preflightHash, candidateHash: e1.json().candidateHash };
      const c1 = await call('POST', `${ops}/${pre.id}/approve`, approve, 201, key(`${k}-apr`)), c2 = await call('POST', `${ops}/${pre.id}/approve`, approve, 201, key(`${k}-apr`));
      expect(c2.json().commit.revision.id).toBe(c1.json().commit.revision.id);
      expect((await call('POST', `${ops}/${pre.id}/approve`, { ...approve, candidateHash: 'a'.repeat(64) }, 409, key(`${k}-apr`))).json().error.code).toBe('IDEMPOTENCY_CONFLICT');
      expect((await call('GET', ops, undefined, 200)).json().items).toHaveLength(1);
      expect((await call('GET', `/api/projects/${projectId}`, undefined, 200)).json().currentRevisionNumber).toBe(2);
    });
  });
}
