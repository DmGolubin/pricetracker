/**
 * API Client for Price Tracker Extension.
 * Communicates with external database via REST API.
 * Implements retry logic: one retry after API_RETRY_DELAY_MS on network errors.
 */
(function () {

var _constants = (typeof self !== 'undefined' && self.PriceTracker && self.PriceTracker.constants)
  ? self.PriceTracker.constants
  : require('../shared/constants');
var API_RETRY_DELAY_MS = _constants.API_RETRY_DELAY_MS;

/** Module-level base URL, configurable via setBaseUrl */
let baseUrl = 'http://85.115.209.141';

/** Module-level API token for optional authorization */
let apiToken = '';

/**
 * Set the API token for all API requests.
 * @param {string} token
 */
function setApiToken(token) {
  apiToken = token || '';
}

/**
 * Get the current API token.
 * @returns {string}
 */
function getApiToken() {
  return apiToken;
}

/**
 * Set the base URL for all API requests.
 * @param {string} url
 */
function setBaseUrl(url) {
  baseUrl = url.replace(/\/+$/, '');
}

/**
 * Get the current base URL.
 * @returns {string}
 */
function getBaseUrl() {
  return baseUrl;
}

/**
 * Determine if an error is a network error (fetch itself failed, not an HTTP error).
 * @param {Error} err
 * @returns {boolean}
 */
function isNetworkError(err) {
  return err instanceof TypeError || err.name === 'TypeError';
}

/**
 * Sleep for a given number of milliseconds.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Core fetch wrapper with retry-on-network-error logic.
 * On network error, retries once after API_RETRY_DELAY_MS.
 * On HTTP errors, throws an appropriate ApiError.
 *
 * @param {string} path - API path (e.g. '/trackers')
 * @param {RequestInit} [options={}]
 * @returns {Promise<Response>}
 */
async function request(path, options = {}) {
  const url = `${baseUrl}${path}`;
  const fetchOptions = {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(apiToken ? { 'Authorization': 'Bearer ' + apiToken } : {}),
      ...(options.headers || {}),
    },
  };

  let response;
  try {
    response = await fetch(url, fetchOptions);
  } catch (err) {
    if (isNetworkError(err)) {
      // Retry once after delay
      await sleep(API_RETRY_DELAY_MS);
      try {
        response = await fetch(url, fetchOptions);
      } catch (retryErr) {
        throw new ApiError(
          'Network error: server is unavailable after retry',
          0,
          'NETWORK_ERROR'
        );
      }
    } else {
      throw err;
    }
  }

  if (!response.ok) {
    await handleHttpError(response);
  }

  return response;
}

/**
 * Custom error class for API errors.
 */
class ApiError extends Error {
  /**
   * @param {string} message
   * @param {number} status - HTTP status code (0 for network errors)
   * @param {string} code - Error code string
   */
  constructor(message, status, code) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/**
 * Handle non-OK HTTP responses by throwing typed ApiError.
 * @param {Response} response
 */
async function handleHttpError(response) {
  let body;
  try {
    body = await response.json();
  } catch {
    body = {};
  }

  const message = body.message || body.error || response.statusText;

  switch (response.status) {
    case 404:
      throw new ApiError(
        message || 'Resource not found',
        404,
        'NOT_FOUND'
      );
    case 409:
      throw new ApiError(
        message || 'Duplicate tracker: a tracker with this URL and selector already exists',
        409,
        'DUPLICATE'
      );
    default:
      throw new ApiError(
        message || `HTTP error ${response.status}`,
        response.status,
        'HTTP_ERROR'
      );
  }
}

// ─── Offline Cache ──────────────────────────────────────────────

/**
 * Save data to chrome.storage.local for offline access.
 * @param {string} key
 * @param {*} data
 */
function cacheSet(key, data) {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    var obj = {};
    obj[key] = { data: data, cachedAt: new Date().toISOString() };
    chrome.storage.local.set(obj);
  }
}

/**
 * Get cached data from chrome.storage.local.
 * @param {string} key
 * @returns {Promise<{data: *, cachedAt: string}|null>}
 */
function cacheGet(key) {
  return new Promise(function (resolve) {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(key, function (result) {
        resolve(result[key] || null);
      });
    } else {
      resolve(null);
    }
  });
}

// ─── Tracker Methods ────────────────────────────────────────────────

/**
 * Get all trackers. Caches result; returns cache on failure.
 * @returns {Promise<Object[]>}
 */
async function getTrackers() {
  try {
    const res = await request('/trackers');
    const data = await res.json();
    cacheSet('cache_trackers', data);
    return data;
  } catch (err) {
    var cached = await cacheGet('cache_trackers');
    if (cached && cached.data) {
      cached.data._fromCache = true;
      cached.data._cachedAt = cached.cachedAt;
      return cached.data;
    }
    throw err;
  }
}

/**
 * Get a single tracker by ID.
 * @param {string} id
 * @returns {Promise<Object>}
 */
async function getTracker(id) {
  const res = await request(`/trackers/${encodeURIComponent(id)}`);
  return res.json();
}

/**
 * Create a new tracker.
 * @param {Object} data - CreateTrackerPayload
 * @returns {Promise<Object>}
 */
async function createTracker(data) {
  const res = await request('/trackers', {
    method: 'POST',
    body: JSON.stringify(data),
  });
  return res.json();
}

/**
 * Update an existing tracker.
 * @param {string} id
 * @param {Object} data - Partial<Tracker>
 * @returns {Promise<Object>}
 */
async function updateTracker(id, data) {
  const res = await request(`/trackers/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
  return res.json();
}

/**
 * Delete a tracker.
 * @param {string} id
 * @returns {Promise<void>}
 */
async function deleteTracker(id) {
  await request(`/trackers/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

// ─── Price History Methods ──────────────────────────────────────────

/**
 * Get price history for a tracker.
 * @param {string} trackerId
 * @returns {Promise<Object[]>}
 */
async function getPriceHistory(trackerId) {
  const res = await request(
    `/priceHistory?trackerId=${encodeURIComponent(trackerId)}`
  );
  return res.json();
}

/**
 * Add a price record to a tracker's history.
 * @param {string} trackerId
 * @param {Object} record - CreatePriceRecord
 * @returns {Promise<Object>}
 */
async function addPriceRecord(trackerId, record) {
  const res = await request(
    `/priceHistory`,
    {
      method: 'POST',
      body: JSON.stringify({ ...record, trackerId }),
    }
  );
  return res.json();
}

/**
 * Delete a single price history record.
 * @param {string|number} recordId
 * @returns {Promise<Object>}
 */
async function deletePriceRecord(recordId) {
  const res = await request(
    `/priceHistory/${encodeURIComponent(recordId)}`,
    { method: 'DELETE' }
  );
  return res.json();
}

// ─── Settings Methods ───────────────────────────────────────────────

/**
 * Get global settings. Caches result; returns cache on failure.
 * @returns {Promise<Object>}
 */
async function getSettings() {
  try {
    const res = await request('/settings/global');
    const data = await res.json();
    cacheSet('cache_settings', data);
    return data;
  } catch (err) {
    var cached = await cacheGet('cache_settings');
    if (cached && cached.data) return cached.data;
    throw err;
  }
}

/**
 * Save global settings.
 * @param {Object} settings - GlobalSettings
 * @returns {Promise<Object>}
 */
async function saveSettings(settings) {
  const res = await request('/settings/global', {
    method: 'PUT',
    body: JSON.stringify({ ...settings, id: 'global' }),
  });
  return res.json();
}

/**
 * Trigger server-side price check for a single tracker via Puppeteer.
 * @param {string|number} trackerId
 * @returns {Promise<Object>} - { status, tracker }
 */
async function serverCheckSingle(trackerId) {
  const res = await request(`/server-check/single/${encodeURIComponent(trackerId)}`, {
    method: 'POST',
  });
  return res.json();
}

// ─── Exports ────────────────────────────────────────────────────────

const _apiClient = {
  setBaseUrl,
  getBaseUrl,
  setApiToken,
  getApiToken,
  getTrackers,
  getTracker,
  createTracker,
  updateTracker,
  deleteTracker,
  getPriceHistory,
  addPriceRecord,
  deletePriceRecord,
  getSettings,
  saveSettings,
  serverCheckSingle,
  ApiError,
  // Exported for testing
  _request: request,
  _isNetworkError: isNetworkError,
  _sleep: sleep,
  _cacheSet: cacheSet,
  _cacheGet: cacheGet,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = _apiClient;
}
if (typeof self !== 'undefined' && self.PriceTracker) {
  self.PriceTracker.apiClient = _apiClient;
}

})();
