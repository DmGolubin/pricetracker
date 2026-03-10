/**
 * Unit tests for PriceHistory component (dashboard/components/priceHistory.js)
 *
 * Requirements: 8.1, 8.2, 8.3
 */

const PriceHistory = require('../../dashboard/components/priceHistory');

// ─── Helpers ──────────────────────────────────────────────────────────

function makeTracker(overrides) {
  return Object.assign(
    {
      id: 'tracker-1',
      pageUrl: 'https://shop.example.com/product/1',
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
    },
    overrides || {}
  );
}

function makeRecord(overrides) {
  return Object.assign(
    {
      id: 'rec-1',
      trackerId: 'tracker-1',
      price: 100,
      checkedAt: '2024-06-01T12:00:00Z',
    },
    overrides || {}
  );
}

function createContainer() {
  var c = document.createElement('div');
  document.body.appendChild(c);
  return c;
}

function flushPromises() {
  return new Promise(function (resolve) {
    setTimeout(resolve, 0);
  });
}

// ─── Tests ────────────────────────────────────────────────────────────

describe('PriceHistory', () => {
  let container;

  beforeEach(() => {
    document.body.innerHTML = '';
    container = createContainer();
  });

  // ─── render() loads price history from service worker ───────────

  describe('render() loads price history', () => {
    test('sends getPriceHistory message with tracker id', async () => {
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        if (cb) cb([]);
      });

      PriceHistory.render(makeTracker({ id: 'ph-test' }), container);
      await flushPromises();

      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        { action: 'getPriceHistory', trackerId: 'ph-test' },
        expect.any(Function)
      );
    });

    test('handles response as array of records', async () => {
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        if (cb) cb([makeRecord()]);
      });

      PriceHistory.render(makeTracker(), container);
      await flushPromises();

      expect(container.querySelectorAll('[data-testid="price-history-record"]').length).toBe(1);
    });

    test('handles response with records property', async () => {
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        if (cb) cb({ records: [makeRecord(), makeRecord({ id: 'rec-2' })] });
      });

      PriceHistory.render(makeTracker(), container);
      await flushPromises();

      expect(container.querySelectorAll('[data-testid="price-history-record"]').length).toBe(2);
    });
  });

  // ─── Loading state ──────────────────────────────────────────────

  describe('loading state', () => {
    test('shows loading indicator before data arrives', () => {
      chrome.runtime.sendMessage.mockImplementation(() => {
        // Never call callback — stays in loading state
      });

      PriceHistory.render(makeTracker(), container);

      const loading = container.querySelector('[data-testid="price-history-loading"]');
      expect(loading).not.toBeNull();
      expect(loading.textContent).toContain('Загрузка');
    });

    test('loading indicator is removed after data loads', async () => {
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        if (cb) cb([makeRecord()]);
      });

      PriceHistory.render(makeTracker(), container);
      await flushPromises();

      expect(container.querySelector('[data-testid="price-history-loading"]')).toBeNull();
    });
  });

  // ─── Empty history ──────────────────────────────────────────────

  describe('empty history', () => {
    test('shows "Нет записей" when history is empty', async () => {
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        if (cb) cb([]);
      });

      PriceHistory.render(makeTracker(), container);
      await flushPromises();

      const empty = container.querySelector('[data-testid="price-history-empty"]');
      expect(empty).not.toBeNull();
      expect(empty.textContent).toBe('Нет записей');
    });

    test('shows "Нет записей" when response has empty records array', async () => {
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        if (cb) cb({ records: [] });
      });

      PriceHistory.render(makeTracker(), container);
      await flushPromises();

      expect(container.querySelector('[data-testid="price-history-empty"]')).not.toBeNull();
    });
  });

  // ─── Records sorted newest first (Req 8.2) ─────────────────────

  describe('records sorted newest first', () => {
    test('records are displayed in descending checkedAt order', async () => {
      const records = [
        makeRecord({ id: 'r1', price: 100, checkedAt: '2024-01-01T10:00:00Z' }),
        makeRecord({ id: 'r3', price: 80, checkedAt: '2024-03-01T10:00:00Z' }),
        makeRecord({ id: 'r2', price: 90, checkedAt: '2024-02-01T10:00:00Z' }),
      ];

      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        if (cb) cb(records);
      });

      PriceHistory.render(makeTracker(), container);
      await flushPromises();

      const values = container.querySelectorAll('[data-testid="price-history-value"]');
      // Newest first: r3 (80), r2 (90), r1 (100)
      expect(values[0].textContent).toBe('80.00');
      expect(values[1].textContent).toBe('90.00');
      expect(values[2].textContent).toBe('100.00');
    });
  });

  // ─── Each record shows date/time and price (Req 8.1) ───────────

  describe('record display', () => {
    test('each record shows date/time', async () => {
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        if (cb) cb([makeRecord({ checkedAt: '2024-06-15T14:30:00Z' })]);
      });

      PriceHistory.render(makeTracker(), container);
      await flushPromises();

      const dateEl = container.querySelector('[data-testid="price-history-date"]');
      expect(dateEl).not.toBeNull();
      expect(dateEl.textContent.length).toBeGreaterThan(0);
    });

    test('each record shows price value', async () => {
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        if (cb) cb([makeRecord({ price: 42.5 })]);
      });

      PriceHistory.render(makeTracker(), container);
      await flushPromises();

      const valueEl = container.querySelector('[data-testid="price-history-value"]');
      expect(valueEl).not.toBeNull();
      expect(valueEl.textContent).toBe('42.50');
    });
  });

  // ─── Price decrease records are highlighted (Req 8.3) ───────────

  describe('price decrease highlighting', () => {
    test('record with lower price than previous gets price-down-bg class', async () => {
      const records = [
        makeRecord({ id: 'r1', price: 100, checkedAt: '2024-01-01T10:00:00Z' }),
        makeRecord({ id: 'r2', price: 80, checkedAt: '2024-02-01T10:00:00Z' }),
      ];

      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        if (cb) cb(records);
      });

      PriceHistory.render(makeTracker(), container);
      await flushPromises();

      // Sorted newest first: r2 (80), r1 (100)
      // r2 (80) < r1 (100) → r2 is a decrease
      const items = container.querySelectorAll('[data-testid="price-history-record"]');
      expect(items[0].classList.contains('price-down-bg')).toBe(true);
    });

    test('record with higher price than previous does not get highlight', async () => {
      const records = [
        makeRecord({ id: 'r1', price: 80, checkedAt: '2024-01-01T10:00:00Z' }),
        makeRecord({ id: 'r2', price: 100, checkedAt: '2024-02-01T10:00:00Z' }),
      ];

      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        if (cb) cb(records);
      });

      PriceHistory.render(makeTracker(), container);
      await flushPromises();

      // Sorted newest first: r2 (100), r1 (80)
      // r2 (100) > r1 (80) → not a decrease
      const items = container.querySelectorAll('[data-testid="price-history-record"]');
      expect(items[0].classList.contains('price-down-bg')).toBe(false);
    });

    test('record with equal price does not get highlight', async () => {
      const records = [
        makeRecord({ id: 'r1', price: 100, checkedAt: '2024-01-01T10:00:00Z' }),
        makeRecord({ id: 'r2', price: 100, checkedAt: '2024-02-01T10:00:00Z' }),
      ];

      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        if (cb) cb(records);
      });

      PriceHistory.render(makeTracker(), container);
      await flushPromises();

      const items = container.querySelectorAll('[data-testid="price-history-record"]');
      expect(items[0].classList.contains('price-down-bg')).toBe(false);
    });

    test('last record (oldest) never gets highlight', async () => {
      const records = [
        makeRecord({ id: 'r1', price: 100, checkedAt: '2024-01-01T10:00:00Z' }),
      ];

      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        if (cb) cb(records);
      });

      PriceHistory.render(makeTracker(), container);
      await flushPromises();

      const items = container.querySelectorAll('[data-testid="price-history-record"]');
      expect(items[0].classList.contains('price-down-bg')).toBe(false);
    });

    test('multiple decreases are all highlighted', async () => {
      const records = [
        makeRecord({ id: 'r1', price: 100, checkedAt: '2024-01-01T10:00:00Z' }),
        makeRecord({ id: 'r2', price: 90, checkedAt: '2024-02-01T10:00:00Z' }),
        makeRecord({ id: 'r3', price: 80, checkedAt: '2024-03-01T10:00:00Z' }),
      ];

      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        if (cb) cb(records);
      });

      PriceHistory.render(makeTracker(), container);
      await flushPromises();

      // Sorted newest first: r3 (80), r2 (90), r1 (100)
      // r3 (80) < r2 (90) → decrease
      // r2 (90) < r1 (100) → decrease
      // r1 → oldest, no highlight
      const items = container.querySelectorAll('[data-testid="price-history-record"]');
      expect(items[0].classList.contains('price-down-bg')).toBe(true);
      expect(items[1].classList.contains('price-down-bg')).toBe(true);
      expect(items[2].classList.contains('price-down-bg')).toBe(false);
    });
  });

  // ─── Content tracker records show text content ──────────────────

  describe('content tracker records', () => {
    test('shows content text instead of price for content trackers', async () => {
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        if (cb) cb([makeRecord({ price: 0, content: 'В наличии', checkedAt: '2024-06-01T12:00:00Z' })]);
      });

      PriceHistory.render(makeTracker({ trackingType: 'content' }), container);
      await flushPromises();

      const valueEl = container.querySelector('[data-testid="price-history-value"]');
      expect(valueEl.textContent).toBe('В наличии');
    });

    test('shows price for price trackers even if content is present', async () => {
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        if (cb) cb([makeRecord({ price: 55.99, content: 'some text' })]);
      });

      PriceHistory.render(makeTracker({ trackingType: 'price' }), container);
      await flushPromises();

      const valueEl = container.querySelector('[data-testid="price-history-value"]');
      expect(valueEl.textContent).toBe('55.99');
    });
  });

  // ─── Error handling ─────────────────────────────────────────────

  describe('error handling', () => {
    test('shows error message when sendMessage fails', async () => {
      chrome.runtime.lastError = { message: 'Connection failed' };
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        if (cb) cb(undefined);
      });

      PriceHistory.render(makeTracker(), container);
      await flushPromises();

      const errorEl = container.querySelector('[data-testid="price-history-error"]');
      expect(errorEl).not.toBeNull();

      // Clean up
      chrome.runtime.lastError = null;
    });

    test('shows error when response contains error field', async () => {
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        if (cb) cb({ error: 'Server unavailable' });
      });

      PriceHistory.render(makeTracker(), container);
      await flushPromises();

      const errorEl = container.querySelector('[data-testid="price-history-error"]');
      expect(errorEl).not.toBeNull();
      expect(errorEl.textContent).toContain('Server unavailable');
    });
  });
});
