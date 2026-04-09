/**
 * Mock objects for Chrome Extension APIs.
 * Provides jest.fn() mocks for all Chrome APIs used by the extension.
 */

const chrome = {
  alarms: {
    create: jest.fn(),
    clear: jest.fn(),
    clearAll: jest.fn(),
    get: jest.fn(),
    getAll: jest.fn(),
    onAlarm: {
      addListener: jest.fn()
    }
  },

  tabs: {
    create: jest.fn(),
    remove: jest.fn(),
    update: jest.fn(),
    query: jest.fn(),
    sendMessage: jest.fn(),
    captureVisibleTab: jest.fn().mockResolvedValue('data:image/jpeg;base64,mock'),
    onUpdated: {
      addListener: jest.fn(),
      removeListener: jest.fn()
    }
  },

  notifications: {
    create: jest.fn(),
    clear: jest.fn(),
    onClicked: {
      addListener: jest.fn()
    }
  },

  runtime: {
    sendMessage: jest.fn(),
    onMessage: {
      addListener: jest.fn(),
      removeListener: jest.fn()
    },
    onInstalled: {
      addListener: jest.fn()
    },
    onStartup: {
      addListener: jest.fn()
    },
    getURL: jest.fn((path) => `chrome-extension://mock-id/${path}`)
  },

  scripting: {
    executeScript: jest.fn()
  },

  action: {
    setBadgeText: jest.fn(),
    setBadgeBackgroundColor: jest.fn()
  },

  storage: {
    local: {
      get: jest.fn((key, cb) => { if (cb) cb({}); }),
      set: jest.fn((obj, cb) => { if (cb) cb(); }),
    }
  }
};

module.exports = chrome;
