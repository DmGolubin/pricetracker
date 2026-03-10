/**
 * Jest setup file (setupFilesAfterFramework) — resets mocks between tests.
 * Runs after the test framework is initialized, so beforeEach is available.
 */
beforeEach(() => {
  jest.clearAllMocks();
});
