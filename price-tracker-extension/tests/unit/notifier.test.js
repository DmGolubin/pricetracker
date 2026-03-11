/**
 * Unit tests for lib/notifier.js
 */
const {
  evaluateFilter,
  shouldNotify,
  sendChromeNotification,
  sendTelegramNotification,
  notify,
  registerNotificationClickHandler,
  computeLineDiff,
  formatContentDiffHtml,
} = require('../../lib/notifier');

const { NotificationFilterType } = require('../../shared/constants');

// ─── Helpers ────────────────────────────────────────────────────────

function makeTracker(overrides = {}) {
  return {
    id: 'tracker-1',
    pageUrl: 'https://shop.com/product',
    cssSelector: '.price',
    productName: 'Test Product',
    imageUrl: 'https://shop.com/img.jpg',
    initialPrice: 100,
    currentPrice: 90,
    minPrice: 90,
    maxPrice: 100,
    checkIntervalHours: 12,
    notificationsEnabled: true,
    status: 'active',
    trackingType: 'price',
    checkMode: 'auto',
    unread: false,
    ...overrides,
  };
}

function makeSettings(overrides = {}) {
  return {
    apiBaseUrl: 'https://api.example.com',
    telegramBotToken: 'bot-token-123',
    telegramChatId: '12345',
    permanentPinTab: false,
    ...overrides,
  };
}

// ─── evaluateFilter ─────────────────────────────────────────────────

describe('evaluateFilter', () => {
  test('returns true when no filter and price changed', () => {
    const tracker = makeTracker({ initialPrice: 100 });
    expect(evaluateFilter(tracker, 80, 100)).toBe(true);
    expect(evaluateFilter(tracker, 110, 100)).toBe(true);
  });

  test('returns false when no filter and price unchanged', () => {
    const tracker = makeTracker({ initialPrice: 100 });
    expect(evaluateFilter(tracker, 100, 100)).toBe(false);
  });

  test('filter type "none" uses default behavior', () => {
    const tracker = makeTracker({
      initialPrice: 100,
      notificationFilter: { type: NotificationFilterType.NONE },
    });
    expect(evaluateFilter(tracker, 80, 100)).toBe(true);
    expect(evaluateFilter(tracker, 110, 100)).toBe(true);
    expect(evaluateFilter(tracker, 100, 100)).toBe(false);
  });

  test('filter type "contains" checks currentContent', () => {
    const tracker = makeTracker({
      notificationFilter: { type: NotificationFilterType.CONTAINS, value: 'sale' },
      currentContent: 'Big sale today!',
    });
    expect(evaluateFilter(tracker, 90, 100)).toBe(true);
  });

  test('filter type "contains" returns false when content does not match', () => {
    const tracker = makeTracker({
      notificationFilter: { type: NotificationFilterType.CONTAINS, value: 'sale' },
      currentContent: 'Regular price',
    });
    expect(evaluateFilter(tracker, 90, 100)).toBe(false);
  });

  test('filter type "contains" returns false when no currentContent', () => {
    const tracker = makeTracker({
      notificationFilter: { type: NotificationFilterType.CONTAINS, value: 'sale' },
    });
    expect(evaluateFilter(tracker, 90, 100)).toBe(false);
  });

  test('filter type "greaterThan" checks newPrice > threshold', () => {
    const tracker = makeTracker({
      notificationFilter: { type: NotificationFilterType.GREATER_THAN, value: 50 },
    });
    expect(evaluateFilter(tracker, 60, 40)).toBe(true);
    expect(evaluateFilter(tracker, 50, 40)).toBe(false);
    expect(evaluateFilter(tracker, 30, 40)).toBe(false);
  });

  test('filter type "lessThan" checks newPrice < threshold', () => {
    const tracker = makeTracker({
      notificationFilter: { type: NotificationFilterType.LESS_THAN, value: 50 },
    });
    expect(evaluateFilter(tracker, 40, 60)).toBe(true);
    expect(evaluateFilter(tracker, 50, 60)).toBe(false);
    expect(evaluateFilter(tracker, 60, 40)).toBe(false);
  });

  test('filter type "increased" checks newPrice > previousPrice', () => {
    const tracker = makeTracker({
      notificationFilter: { type: NotificationFilterType.INCREASED },
    });
    expect(evaluateFilter(tracker, 110, 100)).toBe(true);
    expect(evaluateFilter(tracker, 100, 100)).toBe(false);
    expect(evaluateFilter(tracker, 90, 100)).toBe(false);
  });

  test('filter type "decreased" checks newPrice < previousPrice', () => {
    const tracker = makeTracker({
      notificationFilter: { type: NotificationFilterType.DECREASED },
    });
    expect(evaluateFilter(tracker, 90, 100)).toBe(true);
    expect(evaluateFilter(tracker, 100, 100)).toBe(false);
    expect(evaluateFilter(tracker, 110, 100)).toBe(false);
  });

  test('unknown filter type falls back to default behavior', () => {
    const tracker = makeTracker({
      initialPrice: 100,
      notificationFilter: { type: 'unknownType' },
    });
    expect(evaluateFilter(tracker, 80, 100)).toBe(true);
    expect(evaluateFilter(tracker, 110, 100)).toBe(true);
    expect(evaluateFilter(tracker, 100, 100)).toBe(false);
  });
});


// ─── shouldNotify ───────────────────────────────────────────────────

describe('shouldNotify', () => {
  test('chrome=true, telegram=true when filter passes and all configured', () => {
    const tracker = makeTracker({ initialPrice: 100, notificationsEnabled: true });
    const settings = makeSettings();
    const result = shouldNotify(tracker, 80, 100, settings);
    expect(result).toEqual({ chrome: true, telegram: true });
  });

  test('chrome=false when notificationsEnabled is false', () => {
    const tracker = makeTracker({ initialPrice: 100, notificationsEnabled: false });
    const settings = makeSettings();
    const result = shouldNotify(tracker, 80, 100, settings);
    expect(result.chrome).toBe(false);
    expect(result.telegram).toBe(true);
  });

  test('telegram=false when botToken is missing', () => {
    const tracker = makeTracker({ initialPrice: 100, notificationsEnabled: true });
    const settings = makeSettings({ telegramBotToken: '' });
    const result = shouldNotify(tracker, 80, 100, settings);
    expect(result.chrome).toBe(true);
    expect(result.telegram).toBe(false);
  });

  test('telegram=false when chatId is missing', () => {
    const tracker = makeTracker({ initialPrice: 100, notificationsEnabled: true });
    const settings = makeSettings({ telegramChatId: '' });
    const result = shouldNotify(tracker, 80, 100, settings);
    expect(result.chrome).toBe(true);
    expect(result.telegram).toBe(false);
  });

  test('telegram=false when both botToken and chatId are missing', () => {
    const tracker = makeTracker({ initialPrice: 100, notificationsEnabled: true });
    const settings = makeSettings({ telegramBotToken: undefined, telegramChatId: undefined });
    const result = shouldNotify(tracker, 80, 100, settings);
    expect(result.telegram).toBe(false);
  });

  test('both false when filter does not pass', () => {
    const tracker = makeTracker({ initialPrice: 100, notificationsEnabled: true });
    const settings = makeSettings();
    // Same price = no change = filter does not pass
    const result = shouldNotify(tracker, 100, 100, settings);
    expect(result).toEqual({ chrome: false, telegram: false });
  });

  test('uses evaluateFilter when notificationFilter is set', () => {
    const tracker = makeTracker({
      initialPrice: 100,
      notificationsEnabled: true,
      notificationFilter: { type: NotificationFilterType.GREATER_THAN, value: 50 },
    });
    const settings = makeSettings();
    // newPrice=60 > 50 → filter passes
    const result = shouldNotify(tracker, 60, 40, settings);
    expect(result).toEqual({ chrome: true, telegram: true });
  });

  test('filter "decreased" with previousPrice as oldPrice', () => {
    const tracker = makeTracker({
      initialPrice: 100,
      notificationsEnabled: true,
      notificationFilter: { type: NotificationFilterType.DECREASED },
    });
    const settings = makeSettings();
    // newPrice=80 < previousPrice=100 → passes
    const result = shouldNotify(tracker, 80, 100, settings);
    expect(result).toEqual({ chrome: true, telegram: true });
  });
});

// ─── sendChromeNotification ─────────────────────────────────────────

describe('sendChromeNotification', () => {
  test('calls chrome.notifications.create with correct params', () => {
    const tracker = makeTracker();
    sendChromeNotification(tracker, 100, 80);

    expect(chrome.notifications.create).toHaveBeenCalledWith(
      'price-tracker-tracker-1',
      expect.objectContaining({
        type: 'basic',
        title: 'Test Product',
        message: expect.stringContaining('100'),
      })
    );
    // Message should also contain the new price
    const callArgs = chrome.notifications.create.mock.calls[0][1];
    expect(callArgs.message).toContain('80');
  });

  test('uses tracker imageUrl as iconUrl', () => {
    const tracker = makeTracker({ imageUrl: 'https://shop.com/product.png' });
    sendChromeNotification(tracker, 100, 80);

    const callArgs = chrome.notifications.create.mock.calls[0][1];
    expect(callArgs.iconUrl).toBe('https://shop.com/product.png');
  });

  test('falls back to extension icon when imageUrl is empty', () => {
    const tracker = makeTracker({ imageUrl: '' });
    sendChromeNotification(tracker, 100, 80);

    const callArgs = chrome.notifications.create.mock.calls[0][1];
    expect(callArgs.iconUrl).toContain('icons/icon128.png');
  });
});

// ─── sendTelegramNotification ───────────────────────────────────────

describe('sendTelegramNotification', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('sends POST to Telegram Bot API with correct URL', async () => {
    const tracker = makeTracker();
    const settings = makeSettings({ telegramBotToken: 'mytoken', telegramChatId: '999' });

    await sendTelegramNotification(tracker, 100, 80, settings);

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.telegram.org/botmytoken/sendMessage',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
    );
  });

  test('message body contains chat_id, text with product info, and parse_mode', async () => {
    const tracker = makeTracker({ productName: 'Cool Gadget', pageUrl: 'https://shop.com/gadget' });
    const settings = makeSettings({ telegramBotToken: 'tok', telegramChatId: '42' });

    await sendTelegramNotification(tracker, 100, 80, settings);

    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.chat_id).toBe('42');
    expect(body.parse_mode).toBe('HTML');
    expect(body.text).toContain('Cool Gadget');
    expect(body.text).toContain('100');
    expect(body.text).toContain('80');
    expect(body.text).toContain('https://shop.com/gadget');
    // Inline keyboard with URL button
    expect(body.reply_markup).toBeDefined();
    expect(body.reply_markup.inline_keyboard[0][0].text).toBe('Открыть страницу');
    expect(body.reply_markup.inline_keyboard[0][0].url).toBe('https://shop.com/gadget');
  });

  test('skips sending when botToken is missing', async () => {
    const tracker = makeTracker();
    const settings = makeSettings({ telegramBotToken: '' });

    await sendTelegramNotification(tracker, 100, 80, settings);

    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('skips sending when chatId is missing', async () => {
    const tracker = makeTracker();
    const settings = makeSettings({ telegramChatId: '' });

    await sendTelegramNotification(tracker, 100, 80, settings);

    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('logs error and does not throw on fetch failure', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const tracker = makeTracker();
    const settings = makeSettings();

    await expect(
      sendTelegramNotification(tracker, 100, 80, settings)
    ).resolves.toBeUndefined();

    expect(consoleSpy).toHaveBeenCalledWith(
      'Telegram notification error:',
      expect.any(Error)
    );

    consoleSpy.mockRestore();
  });
});

// ─── notify (convenience) ───────────────────────────────────────────

describe('notify', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('sends both chrome and telegram when conditions met', async () => {
    const tracker = makeTracker({ initialPrice: 100, notificationsEnabled: true });
    const settings = makeSettings();

    await notify(tracker, 100, 80, settings);

    expect(chrome.notifications.create).toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalled();
  });

  test('sends only chrome when telegram not configured', async () => {
    const tracker = makeTracker({ initialPrice: 100, notificationsEnabled: true });
    const settings = makeSettings({ telegramBotToken: '', telegramChatId: '' });

    await notify(tracker, 100, 80, settings);

    expect(chrome.notifications.create).toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('sends only telegram when chrome notifications disabled', async () => {
    const tracker = makeTracker({ initialPrice: 100, notificationsEnabled: false });
    const settings = makeSettings();

    await notify(tracker, 100, 80, settings);

    expect(chrome.notifications.create).not.toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalled();
  });

  test('sends nothing when filter does not pass', async () => {
    const tracker = makeTracker({ initialPrice: 100, notificationsEnabled: true });
    const settings = makeSettings();

    // Same price = no change = filter does not pass
    await notify(tracker, 100, 100, settings);

    expect(chrome.notifications.create).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

// ─── registerNotificationClickHandler ───────────────────────────────

describe('registerNotificationClickHandler', () => {
  test('registers a listener on chrome.notifications.onClicked', () => {
    registerNotificationClickHandler();
    expect(chrome.notifications.onClicked.addListener).toHaveBeenCalledWith(
      expect.any(Function)
    );
  });

  test('clears notification when clicked with price-tracker prefix', () => {
    registerNotificationClickHandler();
    const listener = chrome.notifications.onClicked.addListener.mock.calls[0][0];

    listener('price-tracker-tracker-1');

    expect(chrome.notifications.clear).toHaveBeenCalledWith('price-tracker-tracker-1');
  });
});

// ─── computeLineDiff ────────────────────────────────────────────────

describe('computeLineDiff', () => {
  test('returns empty array for identical content', () => {
    expect(computeLineDiff('hello', 'hello')).toEqual([
      { type: 'equal', value: 'hello' },
    ]);
  });

  test('detects added lines', () => {
    var ops = computeLineDiff('line1', 'line1\nline2');
    expect(ops).toEqual([
      { type: 'equal', value: 'line1' },
      { type: 'added', value: 'line2' },
    ]);
  });

  test('detects removed lines', () => {
    var ops = computeLineDiff('line1\nline2', 'line1');
    expect(ops).toEqual([
      { type: 'equal', value: 'line1' },
      { type: 'removed', value: 'line2' },
    ]);
  });

  test('detects changed lines', () => {
    var ops = computeLineDiff('old line', 'new line');
    var types = ops.map(function (o) { return o.type; });
    expect(types).toContain('removed');
    expect(types).toContain('added');
  });

  test('handles empty old text', () => {
    var ops = computeLineDiff('', 'new');
    expect(ops).toEqual([{ type: 'added', value: 'new' }]);
  });

  test('handles empty new text', () => {
    var ops = computeLineDiff('old', '');
    expect(ops).toEqual([{ type: 'removed', value: 'old' }]);
  });

  test('handles both empty', () => {
    expect(computeLineDiff('', '')).toEqual([]);
  });
});

// ─── formatContentDiffHtml ──────────────────────────────────────────

describe('formatContentDiffHtml', () => {
  test('formats removed lines with strikethrough', () => {
    var html = formatContentDiffHtml('old line', 'new line');
    expect(html).toContain('<s>');
    expect(html).toContain('➖');
  });

  test('formats added lines with bold', () => {
    var html = formatContentDiffHtml('old line', 'new line');
    expect(html).toContain('<b>');
    expect(html).toContain('➕');
  });

  test('escapes HTML in content', () => {
    var html = formatContentDiffHtml('<script>alert(1)</script>', 'safe');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  test('returns fallback for identical content', () => {
    var html = formatContentDiffHtml('same', 'same');
    expect(html).toBe('Контент изменился');
  });

  test('handles multiline content diff', () => {
    var old = '80 мл\n4 200грн\n50 мл\n3 200грн';
    var newC = '80 мл\n4 305грн\n50 мл\n3 305грн';
    var html = formatContentDiffHtml(old, newC);
    expect(html).toContain('➖');
    expect(html).toContain('➕');
    expect(html).toContain('4 200грн');
    expect(html).toContain('4 305грн');
  });
});

// ─── Content tracker Telegram notification ──────────────────────────

describe('sendTelegramNotification for content trackers', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('sends diff-formatted message for content tracker', async () => {
    var tracker = makeTracker({
      trackingType: 'content',
      productName: 'Test Content',
    });
    var settings = makeSettings();
    var oldContent = '80 мл\n4 200грн';
    var newContent = '80 мл\n4 305грн';

    await sendTelegramNotification(tracker, oldContent, newContent, settings);

    var body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.text).toContain('➖');
    expect(body.text).toContain('➕');
    expect(body.text).toContain('<s>');
    expect(body.text).toContain('<b>');
    expect(body.text).not.toContain('Было:');
    expect(body.text).not.toContain('Стало:');
  });

  test('Chrome notification uses compact diff for content tracker', () => {
    var tracker = makeTracker({
      trackingType: 'content',
      productName: 'Test Content',
    });
    var oldContent = '80 мл\n4 200грн';
    var newContent = '80 мл\n4 305грн';

    sendChromeNotification(tracker, oldContent, newContent);

    var callArgs = chrome.notifications.create.mock.calls[0][1];
    expect(callArgs.message).toContain('−');
    expect(callArgs.message).toContain('+');
  });
});
