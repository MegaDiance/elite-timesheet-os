module.exports = {
  transform: {
    '^.+\\.(t|j)sx?$': '@swc/jest',
  },
  testMatch: ['<rootDir>/tests/**/*.test.ts'],
  // Builds a fresh database from the real migrations (see tests/setup/globalSetup.js).
  globalSetup: '<rootDir>/tests/setup/globalSetup.js',
  setupFiles: ['<rootDir>/tests/setup/env.js'],
};
