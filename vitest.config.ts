import { defineConfig } from 'vitest/config';
export default defineConfig({ test: {
  include: ['packages/shared/tests/**/*.test.ts', 'packages/generator/tests/**/*.test.ts', 'packages/blueprint-qa/tests/**/*.test.ts', 'apps/api/tests/**/*.test.ts', 'supabase/tests/**/*.test.ts'],
  exclude: ['apps/api/tests/supabase.live.test.ts'],
  testTimeout: 20_000, hookTimeout: 90_000, fileParallelism: false
} });
