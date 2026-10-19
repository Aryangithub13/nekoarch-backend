import { describe, expect, it } from 'vitest';
import { embeddedPostgresPreflight } from '../../test-support/postgres.js';

// TEST-003 (BACKEND_AUDIT_REPORT.md F-1/F-2): name the two host prerequisites instead of an initdb failure and a hook timeout.
describe('embedded PostgreSQL host preflight', () => {
  const locales = 'C\nC.utf8\nen_US.utf8\nPOSIX\n';
  it('refuses root with an actionable message', () => {
    expect(embeddedPostgresPreflight({ uid: 0, platform: 'linux', locales })).toMatch(/cannot run as root.*non-root user/);
  });
  it('names the missing en_US.UTF-8 locale on Linux', () => {
    expect(embeddedPostgresPreflight({ uid: 1000, platform: 'linux', locales: 'C\nC.utf8\nPOSIX\n' })).toMatch(/en_US\.UTF-8 locale.*locale-gen/);
    expect(embeddedPostgresPreflight({ uid: 1000, platform: 'linux', locales: 'en_US.UTF-8\n' })).toBeNull();
  });
  it('passes a prepared host, and does not guess where the locale cannot be listed', () => {
    expect(embeddedPostgresPreflight({ uid: 1000, platform: 'linux', locales })).toBeNull();
    expect(embeddedPostgresPreflight({ uid: 1000, platform: 'linux', locales: null })).toBeNull();
    expect(embeddedPostgresPreflight({ uid: undefined, platform: 'win32', locales: null })).toBeNull();
  });
  it('names skipped install scripts when initdb cannot load its bundled libraries (npm 12 allowScripts)', () => {
    const initdbError = 'initdb: error while loading shared libraries: libpq.so.5: cannot open shared object file: No such file or directory';
    expect(embeddedPostgresPreflight({ uid: 1000, platform: 'linux', locales, initdbError })).toMatch(/install script was skipped.*install-scripts ls/);
    expect(embeddedPostgresPreflight({ uid: 1000, platform: 'linux', locales, initdbError: null })).toBeNull();
  });
});
