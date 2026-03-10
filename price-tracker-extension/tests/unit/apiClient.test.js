/**
 * Unit tests for lib/apiClient.js
 */
const {
  setBaseUrl,
  getBaseUrl,
  getTrackers,
  getTracker,
  createTracker,
  updateTracker,
  deleteTracker,
  getPriceHistory,
  addPriceRecord,
  getSettings,
  saveSettings,
  ApiError,
} = require('../../lib/apiClient');

const { API_RETRY_DELAY_MS } = require('../../shared/constants');

// ─── Helpers ────────────────────────────────────────────────────────

const BASE = 'http://localhost:3000';

function jsonResponse(data, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    statusText: 'OK',
    json: () => Promise.resolve(data),
  });
}

function errorResponse(status, body = {}) {
  return Promise.resolve({
    ok: false,
    status,
    statusText: `Error ${status}`,
    json: () => Promise.resolve(body),
  });
}

// ─── Setup ──────────────────────────────────────────────────────────

beforeEach(() => {
  setBaseUrl(BASE);
  global.fetch = jest.fn();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
  delete global.fetch;
});

// ─── Base URL ───────────────────────────────────────────────────────

describe('setBaseUrl / getBaseUrl', () => {
  test('stores and returns the base URL', () => {
    setBaseUrl('http://example.com');
    expect(getBaseUrl()).toBe('http://example.com');
  });

  test('strips trailing slashes', () => {
    setBaseUrl('http://example.com///');
    expect(getBaseUrl()).toBe('http://example.com');
  });
});

// ─── Tracker CRUD ───────────────────────────────────────────────────

describe('getTrackers', () => {
  test('fetches all trackers', async () => {
    const trackers = [{ id: '1' }, { id: '2' }];
    global.fetch.mockReturnValue(jsonResponse(trackers));

    const result = await getTrackers();

    expect(global.fetch).toHaveBeenCalledWith(
      `${BASE}/trackers`,
      expect.objectContaining({ headers: expect.objectContaining({ 'Content-Type': 'application/json' }) })
    );
    expect(result).toEqual(trackers);
  });
});

describe('getTracker', () => {
  test('fetches a single tracker by id', async () => {
    const tracker = { id: 'abc', productName: 'Test' };
    global.fetch.mockReturnValue(jsonResponse(tracker));

    const result = await getTracker('abc');

    expect(global.fetch).toHaveBeenCalledWith(
      `${BASE}/trackers/abc`,
      expect.any(Object)
    );
    expect(result).toEqual(tracker);
  });

  test('throws NOT_FOUND on 404', async () => {
    global.fetch.mockReturnValue(errorResponse(404, { message: 'Not found' }));

    await expect(getTracker('missing')).rejects.toThrow(ApiError);
    await expect(getTracker('missing')).rejects.toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
    });
  });
});

describe('createTracker', () => {
  test('creates a tracker with POST', async () => {
    const payload = { pageUrl: 'http://shop.com', cssSelector: '.price' };
    const created = { id: '1', ...payload };
    global.fetch.mockReturnValue(jsonResponse(created, 201));

    const result = await createTracker(payload);

    expect(global.fetch).toHaveBeenCalledWith(
      `${BASE}/trackers`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(payload),
      })
    );
    expect(result).toEqual(created);
  });

  test('throws DUPLICATE on 409', async () => {
    global.fetch.mockReturnValue(
      errorResponse(409, { message: 'Duplicate tracker' })
    );

    await expect(
      createTracker({ pageUrl: 'http://shop.com', cssSelector: '.price' })
    ).rejects.toMatchObject({
      status: 409,
      code: 'DUPLICATE',
    });
  });
});

describe('updateTracker', () => {
  test('updates a tracker with PUT', async () => {
    const updated = { id: '1', productName: 'Updated' };
    global.fetch.mockReturnValue(jsonResponse(updated));

    const result = await updateTracker('1', { productName: 'Updated' });

    expect(global.fetch).toHaveBeenCalledWith(
      `${BASE}/trackers/1`,
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ productName: 'Updated' }),
      })
    );
    expect(result).toEqual(updated);
  });
});

describe('deleteTracker', () => {
  test('deletes a tracker with DELETE', async () => {
    global.fetch.mockReturnValue(
      Promise.resolve({ ok: true, status: 204, statusText: 'No Content', json: () => Promise.resolve({}) })
    );

    await expect(deleteTracker('1')).resolves.toBeUndefined();

    expect(global.fetch).toHaveBeenCalledWith(
      `${BASE}/trackers/1`,
      expect.objectContaining({ method: 'DELETE' })
    );
  });
});

// ─── Price History ──────────────────────────────────────────────────

describe('getPriceHistory', () => {
  test('fetches price history for a tracker', async () => {
    const history = [{ id: 'p1', price: 100 }];
    global.fetch.mockReturnValue(jsonResponse(history));

    const result = await getPriceHistory('t1');

    expect(global.fetch).toHaveBeenCalledWith(
      `${BASE}/priceHistory?trackerId=t1`,
      expect.any(Object)
    );
    expect(result).toEqual(history);
  });
});

describe('addPriceRecord', () => {
  test('adds a price record with POST', async () => {
    const record = { price: 99.5, checkedAt: '2024-01-01T00:00:00Z' };
    const created = { id: 'p2', trackerId: 't1', ...record };
    global.fetch.mockReturnValue(jsonResponse(created, 201));

    const result = await addPriceRecord('t1', record);

    expect(global.fetch).toHaveBeenCalledWith(
      `${BASE}/priceHistory`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ ...record, trackerId: 't1' }),
      })
    );
    expect(result).toEqual(created);
  });
});

// ─── Settings ───────────────────────────────────────────────────────

describe('getSettings', () => {
  test('fetches global settings', async () => {
    const settings = { apiBaseUrl: BASE, permanentPinTab: false };
    global.fetch.mockReturnValue(jsonResponse(settings));

    const result = await getSettings();

    expect(global.fetch).toHaveBeenCalledWith(
      `${BASE}/settings/global`,
      expect.any(Object)
    );
    expect(result).toEqual(settings);
  });
});

describe('saveSettings', () => {
  test('saves global settings with PUT', async () => {
    const settings = { apiBaseUrl: BASE, telegramBotToken: 'tok' };
    global.fetch.mockReturnValue(jsonResponse(settings));

    const result = await saveSettings(settings);

    expect(global.fetch).toHaveBeenCalledWith(
      `${BASE}/settings/global`,
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ ...settings, id: 'global' }),
      })
    );
    expect(result).toEqual(settings);
  });
});

// ─── Retry Logic ────────────────────────────────────────────────────

describe('retry on network error', () => {
  test('retries once on network error then succeeds', async () => {
    const trackers = [{ id: '1' }];
    global.fetch
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockReturnValueOnce(jsonResponse(trackers));

    const promise = getTrackers();
    // Advance past the retry delay
    await jest.advanceTimersByTimeAsync(API_RETRY_DELAY_MS);

    const result = await promise;
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(result).toEqual(trackers);
  });

  test('throws after retry also fails with network error', async () => {
    global.fetch
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));

    // Attach the catch handler immediately to avoid unhandled rejection
    const promise = getTrackers().catch((e) => e);
    await jest.advanceTimersByTimeAsync(API_RETRY_DELAY_MS + 100);

    const error = await promise;

    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe('NETWORK_ERROR');
    expect(error.status).toBe(0);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test('does not retry on HTTP errors (non-network)', async () => {
    global.fetch.mockReturnValue(errorResponse(500, { message: 'Server error' }));

    await expect(getTrackers()).rejects.toMatchObject({
      status: 500,
      code: 'HTTP_ERROR',
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});

// ─── Error Handling ─────────────────────────────────────────────────

describe('ApiError', () => {
  test('has correct properties', () => {
    const err = new ApiError('test', 404, 'NOT_FOUND');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('ApiError');
    expect(err.message).toBe('test');
    expect(err.status).toBe(404);
    expect(err.code).toBe('NOT_FOUND');
  });
});
