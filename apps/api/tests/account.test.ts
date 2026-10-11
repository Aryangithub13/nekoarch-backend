import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Repository } from '../src/lib/repository.js';
import { BriefCreateSchema, LibraryPatchSchema, LibraryQuerySchema, ProjectBriefSchema, SettingsPatchSchema, TagSchema, UserSettingsSchema } from '../src/account/contracts.js';
import { projectContext } from '../src/services/account-service.js';

describe('Phase 33 contracts', () => {
  it('normalizes user-stated brief text and applies defaults, without inventing facts', () => {
    const brief = ProjectBriefSchema.parse({ summary: '  ３BHK​ home for a family of four\u0007 ', constraints: ['Keep the neem tree'], referenceIds: [] });
    expect(brief).toEqual({ summary: '3BHK home for a family of four', site: {}, program: {}, style: { keywords: [] }, constraints: ['Keep the neem tree'], referenceIds: [] });
    expect(ProjectBriefSchema.parse({ summary: 'x' }).budget).toBeUndefined(); // an unstated budget stays absent, never zero
  });
  it('refuses unknown fields, blank text, oversize lists and non-INR budgets', () => {
    const bad = [{ summary: '' }, { summary: 'x', extra: 1 }, { summary: 'x', constraints: Array(21).fill('c') },
      { summary: 'x', budget: { amount: 1, currency: 'USD', flexibility: 'LOW' } }, { summary: 'x', site: { plot: { width: 30, depth: 50, unit: 'yd' } } },
      { summary: 'x', referenceIds: ['not-a-uuid'] }];
    expect(bad.map(b => ProjectBriefSchema.safeParse(b).success)).toEqual(bad.map(() => false));
    expect(BriefCreateSchema.safeParse({ brief: { summary: 'x' } }).success).toBe(false); // expectedVersion is mandatory
  });
  it('dedupes linked references and sorts and dedupes tags', () => {
    const r = randomUUID();
    expect(ProjectBriefSchema.parse({ summary: 'x', referenceIds: [r, r] }).referenceIds).toEqual([r]);
    expect(LibraryPatchSchema.parse({ tags: ['villa', 'g-plus-1', 'villa'] })).toEqual({ tags: ['g-plus-1', 'villa'] });
    expect(['villa', 'g-plus-1', '2026'].map(t => TagSchema.safeParse(t).success)).toEqual([true, true, true]);
    expect(['Villa', '-x', 'a b', 'x'.repeat(33), ''].map(t => TagSchema.safeParse(t).success)).toEqual([false, false, false, false, false]);
  });
  it('accepts only complete, known settings and non-empty patches', () => {
    expect(UserSettingsSchema.safeParse({ units: 'METRIC', locale: 'hi-Latn', currency: 'INR', defaultRegion: null, defaultBuildingType: null }).success).toBe(true);
    expect(UserSettingsSchema.safeParse({ units: 'METRIC', locale: 'fr', currency: 'INR', defaultRegion: null, defaultBuildingType: null }).success).toBe(false);
    expect(SettingsPatchSchema.safeParse({ expectedVersion: 0, settings: {} }).success).toBe(false);
    expect(SettingsPatchSchema.safeParse({ expectedVersion: 0, settings: { theme: 'dark' } }).success).toBe(false);
    expect(SettingsPatchSchema.parse({ expectedVersion: 2, settings: { units: 'IMPERIAL' } })).toEqual({ expectedVersion: 2, settings: { units: 'IMPERIAL' } });
  });
  it('parses library queries with safe defaults and bounded text', () => {
    expect(LibraryQuerySchema.parse({})).toEqual({ status: 'ACTIVE', sort: 'updated', limit: 20 });
    expect(LibraryQuerySchema.parse({ q: ' 100%_villa ', starred: 'true', limit: '5' })).toMatchObject({ q: '100%_villa', starred: true, limit: 5 });
    expect([{ q: 'x'.repeat(101) }, { limit: '51' }, { sort: 'random' }, { starred: 'yes' }].map(q => LibraryQuerySchema.safeParse(q).success)).toEqual([false, false, false, false]);
  });
});

describe('Phase 33 context hash', () => {
  const projectId = randomUUID(), now = new Date().toISOString();
  const raw = (summary: string) => ({
    project: { id: projectId, title: 'Villa', status: 'ACTIVE', visibility: 'PRIVATE', revisionCount: 0, updatedAt: now, starred: false, tags: [] },
    settings: null, references: [], currentRevision: null, activeJobs: [],
    brief: { projectId, version: 1, brief: ProjectBriefSchema.parse({ summary }), briefHash: 'a'.repeat(64), createdBy: randomUUID(), createdAt: now,
      provenance: { source: 'USER_STATED', verified: false },
      claims: { siteVerified: 'NOT_CLAIMED', budgetVerified: 'NOT_CLAIMED', codeCompliance: 'NOT_CLAIMED', ownershipVerified: 'NOT_CLAIMED' } } });
  const repo = (value: unknown) => ({ accountRpc: async () => value }) as unknown as Repository;
  it('is stable for identical content, ignores generation time, and changes with the content', async () => {
    const same = raw('first'), a = await projectContext(repo(same), projectId);
    await new Promise(r => setTimeout(r, 5));
    const b = await projectContext(repo(structuredClone(same)), projectId), c = await projectContext(repo(raw('second')), projectId);
    expect(a.contextHash).toBe(b.contextHash);
    expect(c.contextHash).not.toBe(a.contextHash);
    expect(a.settings).toEqual({ version: 0, settings: { units: 'METRIC', locale: 'en-IN', currency: 'INR', defaultRegion: null, defaultBuildingType: null } });
    expect(Object.values(a.claims).every(v => v === 'NOT_CLAIMED')).toBe(true);
  });
});
