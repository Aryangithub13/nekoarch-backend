import { describe, expect, it } from 'vitest';
// @ts-expect-error untyped local tooling script (plain .mjs)
import { restImagePlan } from '../../../scripts/ensure-local-postgrest.mjs';

// SUPA-003, reproduced 2026-10-19: Supabase CLI 2.117.0 pulled from Docker Hub starts `postgrest/postgrest:v16.2`, which the exact ECR
// string check refused ("Unexpected REST image"), stopping the live acceptance job. Only 16.2 has the JWT clock defect (PHASE15.md).
describe('local PostgREST image plan', () => {
  it('replaces 16.2 with 16.3 from the same repository, whichever registry the CLI used', () => {
    expect(restImagePlan('public.ecr.aws/supabase/postgrest:v16.2')).toEqual({ action: 'replace', target: 'public.ecr.aws/supabase/postgrest:v16.3' });
    expect(restImagePlan('postgrest/postgrest:v16.2')).toEqual({ action: 'replace', target: 'postgrest/postgrest:v16.3' });
    expect(restImagePlan('ghcr.io/supabase/postgrest:v16.2.0')).toEqual({ action: 'replace', target: 'ghcr.io/supabase/postgrest:v16.3' });
  });
  it('keeps 16.3 or later', () => {
    for (const image of ['postgrest/postgrest:v16.3', 'public.ecr.aws/supabase/postgrest:v16.3', 'postgrest/postgrest:v17.0.1']) expect(restImagePlan(image), image).toEqual({ action: 'keep' });
  });
  it('refuses an unknown repository, an older version or an unpinned tag for manual review', () => {
    for (const image of ['evil.example/postgrest:v16.2', 'postgrest/postgrest:v12.2.3', 'postgrest/postgrest:latest', undefined]) expect(restImagePlan(image), String(image)).toEqual({ action: 'refuse' });
  });
});
