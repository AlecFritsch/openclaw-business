import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    env: {
      NODE_ENV: 'test',
      ENCRYPTION_KEY: 'test-encryption-key-that-is-at-least-32-chars-long',
      MONGODB_URI: 'mongodb://localhost:27017/openclaw_business_test',
      CLERK_SECRET_KEY: 'sk_test_fake',
    },
  },
});
