/**
 * Unit tests for Dashboard (dashboard/dashboard.js)
 *
 * Tests: loading/rendering trackers, empty state, card clicks, error handling.
 * Requirements: 4.1, 4.5, 4.6, 12.1
 */

// ─── Helpers ──────────────────────────────────────────────────────────

function createDashboardDOM() {
  document.body.innerHTML =
    '<div id="toolbar-container" class="toolbar"></div>' +
    '<main class="dashboard-main">' +
      '<div id="tracker-grid" class="tracker-grid"></div>' +
      '<div id="empty-state" class="empty-state" hidden></div>' +
      '<div id="error-state" class="error-state" hidden>' +
        '<p id="error-message"></p>' +
        '<button id="btn-retry" class="btn btn-primary">Повторить</button>' +
      '</div>' +
      '<div id="loading-state" class="loading-state"></div>' +
    '</main>' +
    '<div id="modal-container"></div>';
}

function makeTracker(overrides = {}) {
  return {
    id: 'tracker-1',
    pageUrl: 'https://shop.example.com/product/123',
    cssSelector: '.price',
    productName: 'Test Product',
    imageUrl: 'https://shop.example.com/img.jpg',
    initialPrice: 100,
    currentPrice: 90,
    minPrice: 85,
    maxPrice: 110,
    checkIntervalHours: 12,
    notificationsEnabled: true,
    status: 'active',
    createdAt: '2024-01-01T00:00:00Z',
    trackingType: 'price',
    isAutoDetected: false,
    checkMode: 'auto',
    unread: false,
    ...overrides,
  };
}

function mockFetchResponse(data, ok = true, status = 200) {
  global.fetch = jest.fn(() =>
    Promise.resolve({
      ok,
      status,
      json: () => Promise.resolve(data),
    })
  );
}

function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// ─── Test suite ───────────────────────────────────────────────────────

describe('Dashboard', () => {
  let Dashboard;

  beforeEach(() => {
    jest.resetModules();
    createDashboardDOM();

    // Default: fetch returns empty array
    mockFetchResponse([]);

    // Default sendMessage for resetBadge etc
    chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
      cb({ success: true });
    });

    Dashboard = require('../../dashboard/dashboard');
  });

  afterEach(() => {
    delete global.fetch;
  });

  // ─── Loading & rendering ──────────────────────────────────────────

  describe('loadTrackers', () => {
    test('shows empty state when no trackers returned', async () => {
      await flushPromises();

      const emptyState = document.getElementById('empty-state');
      const trackerGrid = document.getElementById('tracker-grid');
      expect(emptyState.hidden).toBe(false);
      expect(trackerGrid.hidden).toBe(true);
    });

    test('renders tracker cards when trackers are returned', async () => {
      jest.resetModules();
      createDashboardDOM();

      const trackers = [
        makeTracker({ id: 't1', productName: 'Product A' }),
        makeTracker({ id: 't2', productName: 'Product B', currentPrice: 120 }),
      ];
      mockFetchResponse(trackers);
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => { cb({}); });

      Dashboard = require('../../dashboard/dashboard');
      await flushPromises();

      const grid = document.getElementById('tracker-grid');
      expect(grid.hidden).toBe(false);
      expect(grid.children.length).toBe(2);
    });

    test('renders tracker cards when response is a plain array', async () => {
      jest.resetModules();
      createDashboardDOM();

      const trackers = [makeTracker({ id: 't1' })];
      mockFetchResponse(trackers);
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => { cb({}); });

      Dashboard = require('../../dashboard/dashboard');
      await flushPromises();

      const grid = document.getElementById('tracker-grid');
      expect(grid.children.length).toBe(1);
    });

    test('card contains product name and domain', async () => {
      jest.resetModules();
      createDashboardDOM();

      const tracker = makeTracker({
        id: 't1',
        productName: 'My Widget',
        pageUrl: 'https://store.example.com/widget',
      });
      mockFetchResponse([tracker]);
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => { cb({}); });

      Dashboard = require('../../dashboard/dashboard');
      await flushPromises();

      const grid = document.getElementById('tracker-grid');
      const card = grid.children[0];
      expect(card.textContent).toContain('My Widget');
      expect(card.textContent).toContain('store.example.com');
    });

    test('resets badge on dashboard open', async () => {
      await flushPromises();

      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        { action: 'resetBadge' },
        expect.any(Function)
      );
    });
  });

  // ─── Empty tracker list ───────────────────────────────────────────

  describe('empty state', () => {
    test('shows empty state for empty tracker list', async () => {
      await flushPromises();

      const emptyState = document.getElementById('empty-state');
      expect(emptyState.hidden).toBe(false);
    });
  });

  // ─── Card click handling ──────────────────────────────────────────

  describe('card click', () => {
    test('clicking a card calls onCardClick with the tracker', async () => {
      jest.resetModules();
      createDashboardDOM();

      const tracker = makeTracker({ id: 'click-test' });
      mockFetchResponse([tracker]);
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => { cb({}); });

      Dashboard = require('../../dashboard/dashboard');
      await flushPromises();

      const openSpy = jest.fn();
      global.SettingsModal = { open: openSpy };

      const grid = document.getElementById('tracker-grid');
      const card = grid.children[0];
      card.click();

      expect(openSpy).toHaveBeenCalledTimes(1);
      expect(openSpy).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'click-test' }),
        expect.any(HTMLElement),
        expect.objectContaining({ onSave: expect.any(Function), onDelete: expect.any(Function) })
      );

      delete global.SettingsModal;
    });

    test('card is keyboard accessible (Enter key)', async () => {
      jest.resetModules();
      createDashboardDOM();

      const tracker = makeTracker({ id: 'kb-test' });
      mockFetchResponse([tracker]);
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => { cb({}); });

      Dashboard = require('../../dashboard/dashboard');
      await flushPromises();

      const openSpy = jest.fn();
      global.SettingsModal = { open: openSpy };

      const grid = document.getElementById('tracker-grid');
      const card = grid.children[0];

      const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
      card.dispatchEvent(event);

      expect(openSpy).toHaveBeenCalledTimes(1);

      delete global.SettingsModal;
    });
  });

  // ─── Error handling ───────────────────────────────────────────────

  describe('error handling', () => {
    test('shows error state when loading fails', async () => {
      jest.resetModules();
      createDashboardDOM();

      global.fetch = jest.fn(() => Promise.reject(new Error('Network error')));
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => { cb({}); });

      Dashboard = require('../../dashboard/dashboard');
      await flushPromises();

      const errorState = document.getElementById('error-state');
      const errorMsg = document.getElementById('error-message');
      expect(errorState.hidden).toBe(false);
      expect(errorMsg.textContent).toBe('Network error');
    });

    test('shows error state on HTTP error', async () => {
      jest.resetModules();
      createDashboardDOM();

      mockFetchResponse({}, false, 500);
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => { cb({}); });

      Dashboard = require('../../dashboard/dashboard');
      await flushPromises();

      const errorState = document.getElementById('error-state');
      expect(errorState.hidden).toBe(false);
    });

    test('retry button reloads trackers', async () => {
      jest.resetModules();
      createDashboardDOM();

      let callCount = 0;
      global.fetch = jest.fn(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.reject(new Error('Temporary error'));
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve([makeTracker()]),
        });
      });
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => { cb({}); });

      Dashboard = require('../../dashboard/dashboard');
      await flushPromises();

      expect(document.getElementById('error-state').hidden).toBe(false);

      document.getElementById('btn-retry').click();
      await flushPromises();

      const grid = document.getElementById('tracker-grid');
      expect(grid.hidden).toBe(false);
      expect(grid.children.length).toBe(1);
    });
  });

  // ─── Search and filter ────────────────────────────────────────────

  describe('search and filter', () => {
    let trackers;

    beforeEach(async () => {
      jest.resetModules();
      createDashboardDOM();

      trackers = [
        makeTracker({ id: 't1', productName: 'iPhone 15', currentPrice: 80, initialPrice: 100 }),
        makeTracker({ id: 't2', productName: 'Samsung Galaxy', currentPrice: 120, initialPrice: 100 }),
        makeTracker({ id: 't3', productName: 'iPhone Case', currentPrice: 100, initialPrice: 100 }),
      ];
      mockFetchResponse(trackers);
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => { cb({}); });

      Dashboard = require('../../dashboard/dashboard');
      await flushPromises();
    });

    test('search filters by product name (case-insensitive)', () => {
      Dashboard.onSearchChange('iphone');
      const grid = document.getElementById('tracker-grid');
      expect(grid.children.length).toBe(2);
    });

    test('price filter "down" shows only trackers with decreased price', () => {
      Dashboard.onFilterChange('down');
      const grid = document.getElementById('tracker-grid');
      expect(grid.children.length).toBe(1);
      expect(grid.children[0].textContent).toContain('iPhone 15');
    });

    test('price filter "up" shows only trackers with increased price', () => {
      Dashboard.onFilterChange('up');
      const grid = document.getElementById('tracker-grid');
      expect(grid.children.length).toBe(1);
      expect(grid.children[0].textContent).toContain('Samsung Galaxy');
    });

    test('combined search and filter', () => {
      Dashboard.onSearchChange('iphone');
      Dashboard.onFilterChange('down');
      const grid = document.getElementById('tracker-grid');
      expect(grid.children.length).toBe(1);
      expect(grid.children[0].textContent).toContain('iPhone 15');
    });

    test('shows "no matches" message when filters exclude all', () => {
      Dashboard.onSearchChange('nonexistent');
      const grid = document.getElementById('tracker-grid');
      expect(grid.textContent).toContain('Нет трекеров, соответствующих фильтру');
    });
  });

  // ─── Utility functions ────────────────────────────────────────────

  describe('utility functions', () => {
    test('extractDomain extracts hostname from URL', () => {
      expect(Dashboard.extractDomain('https://www.example.com/path')).toBe('www.example.com');
      expect(Dashboard.extractDomain('https://shop.test.org')).toBe('shop.test.org');
    });

    test('extractDomain returns input for invalid URL', () => {
      expect(Dashboard.extractDomain('not-a-url')).toBe('not-a-url');
      expect(Dashboard.extractDomain('')).toBe('');
    });

    test('formatPrice formats numbers', () => {
      expect(Dashboard.formatPrice(1234)).toBeTruthy();
      expect(Dashboard.formatPrice(null)).toBe('—');
      expect(Dashboard.formatPrice(undefined)).toBe('—');
    });

    test('escapeHtml escapes special characters', () => {
      expect(Dashboard.escapeHtml('<script>')).toBe('&lt;script&gt;');
      expect(Dashboard.escapeHtml('a & b')).toBe('a &amp; b');
    });
  });

  // ─── Tracker update/delete callbacks ──────────────────────────────

  describe('tracker update and delete callbacks', () => {
    beforeEach(async () => {
      jest.resetModules();
      createDashboardDOM();

      mockFetchResponse([makeTracker({ id: 'u1' }), makeTracker({ id: 'u2' })]);
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => { cb({}); });

      Dashboard = require('../../dashboard/dashboard');
      await flushPromises();
    });

    test('onTrackerUpdated updates the tracker in the list', () => {
      const updated = makeTracker({ id: 'u1', productName: 'Updated Name' });
      Dashboard.onTrackerUpdated(updated);

      const trackers = Dashboard.getAllTrackers();
      const found = trackers.find((t) => t.id === 'u1');
      expect(found.productName).toBe('Updated Name');
    });

    test('onTrackerDeleted removes the tracker from the list', () => {
      Dashboard.onTrackerDeleted('u1');

      const trackers = Dashboard.getAllTrackers();
      expect(trackers.length).toBe(1);
      expect(trackers[0].id).toBe('u2');
    });
  });
});
