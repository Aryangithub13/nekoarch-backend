import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COLLABORATION_ROUTES, ROLE_PERMISSIONS } from '../src/collaboration/contracts.js';

// Audit B INT-B-004 / INT-B-027: the B44 API document lists exactly the routes and role permissions the code serves.
describe('B44 API document', () => {
  const doc = readFileSync(new URL('../../../docs/phase44/phase44-api.md', import.meta.url), 'utf8');
  it('names every collaboration route, and no other collaboration route', () => {
    const documented = new Set([...doc.matchAll(/`(GET|POST|DELETE|PATCH) (\/api\/projects\/:projectId\/collaboration[^`\s]*)`/g)].map(m => m[2]));
    expect([...documented].sort()).toEqual([...new Set(Object.values(COLLABORATION_ROUTES))].sort());
  });
  it('states each role\'s permissions as the code grants them', () => {
    for (const [role, permissions] of Object.entries(ROLE_PERMISSIONS)) {
      const row = doc.split('\n').find(line => line.startsWith(`| \`${role}\` |`));
      expect(row?.split('|')[2]?.match(/[A-Z_]{4,}/g), role).toEqual([...permissions]);
    }
  });
});
