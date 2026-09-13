import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['apps/api/tests/supabase.live.test.ts'], testTimeout: 20_000, hookTimeout: 30_000 } });
