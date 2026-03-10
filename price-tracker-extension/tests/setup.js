/**
 * Jest setup file (setupFiles) — exposes Chrome API mocks globally.
 * Runs before the test framework is initialized.
 */
const chrome = require('./__mocks__/chrome');

global.chrome = chrome;
