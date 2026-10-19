import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = new URL('../../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');

// SEC-005: a moved tag or a republished base image changes what CI runs and what ships without any change in this repository.
describe('supply-chain pins', () => {
  it('pins every GitHub Action to a full commit SHA', () => {
    const uses = readdirSync(new URL('.github/workflows/', root)).filter(f => /\.ya?ml$/.test(f))
      .flatMap(f => [...read(`.github/workflows/${f}`).matchAll(/^\s*(?:-\s*)?uses:\s*(\S+)/gm)].map(m => `${f}: ${m[1]}`));
    expect(uses.length).toBeGreaterThan(0);
    expect(uses.filter(u => !/^[^:]+: (\.\/|docker:\/\/[^@]+@sha256:[a-f0-9]{64}$|[\w.-]+\/[\w./-]+@[a-f0-9]{40}$)/.test(u))).toEqual([]);
  });
  it('pins every Dockerfile base image by digest', () => {
    const from = [...read('Dockerfile').matchAll(/^FROM\s+(\S+)/gm)].map(m => m[1]!);
    expect(from.length).toBeGreaterThan(0);
    expect(from.filter(image => !/@sha256:[a-f0-9]{64}$/.test(image))).toEqual([]);
  });
});
