import { defineConfig } from 'vitest/config';

// Vitest configuration for the backend test suite.
//
// The tests are INTEGRATION tests: each one imports the real Express `app`
// (built in src/app.ts without opening a port) and drives it with Supertest,
// so a request flows through the whole stack — routing, zod validation, auth
// middleware, controllers, services, and the real Prisma client against a real
// Postgres test database. That is where this codebase's logic actually lives.
export default defineConfig({
  test: {
    // Node/Express code — no browser DOM needed.
    environment: 'node',

    // Force NODE_ENV=test so src/config/env.ts loads `.env.test` (the separate
    // test database) instead of `.env`. Belt-and-suspenders: Vitest sets this
    // by default, but we make it explicit because the whole DB-isolation
    // guarantee hinges on it.
    env: { NODE_ENV: 'test' },

    // Runs once per test file, before any test in it — resets the DB before
    // each test and disconnects Prisma at the end. See src/test/setup.ts.
    setupFiles: ['./src/test/setup.ts'],

    // A single shared test database means test FILES must NOT run in parallel,
    // or one file's TRUNCATE would wipe another file's data mid-run. Tests
    // within a file already run sequentially. (Each test still starts from a
    // clean DB via the beforeEach reset in setup.ts.)
    fileParallelism: false,

    // Neon can cold-start after idling; give requests generous headroom so a
    // slow first connection isn't a spurious failure.
    testTimeout: 30_000,
    hookTimeout: 30_000,

    include: ['src/**/*.test.ts'],
  },
});
