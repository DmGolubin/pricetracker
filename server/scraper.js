/**
 * Server-side Scraper — uses Puppeteer (headless Chromium) to extract prices
 * from JavaScript-rendered pages.
 *
 * Key design decisions:
 * - Single browser instance reused across all checks in a cycle
 * - Each tracker gets its own page (tab), closed after extraction
 * - Variant clicking supported (same logic as extension's priceExtractor)
 * - Fallback: auto-detect price on page if CSS selector fails
 * - Timeout per page: 30s load + 15s extraction
 */

const puppeteer = require('puppeteer-core');
const { parsePrice } = require('./priceParser');

const CHROMIUM_PATH = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium';
const PAGE_TIMEOUT_MS = 30000;

/**
 * Pool of realistic User-Agent strings for rotation.
 * Mix of Chrome versions on Windows/Mac to look like real traffic.
 */
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
];

/** Pick a random User-Agent from the pool */
function randomUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

/**
 * WAF/Cloudflare block detection patterns.
 * If page title or body matches these, the request was blocked.
 */
const WAF_BLOCK_TITLES = [
  'just a moment',
  'attention required',
  'access denied',
  'error: the request could not be satisfied',
  'please wait',
  'checking your browser',
  'ddos protection',
];

/**
 * Check if a page was blocked by WAF/Cloudflare.
 * @param {import('puppeteer-core').Page} page
 * @returns {Promise<boolean>}
 */
async function isWafBlocked(page) {
  try {
    var title = await page.title();
    var titleLower = (title || '').toLowerCase();
    for (var i = 0; i < WAF_BLOCK_TITLES.length; i++) {
      if (titleLower.indexOf(WAF_BLOCK_TITLES[i]) !== -1) return true;
    }
    return false;
  } catch (_) {
    return false;
  }
}

/**
 * Makeup.com.ua-specific price selectors — these are the elements
 * where the main product price is displayed. After a variant click,
 * the price in these elements updates dynamically.
 */
const MAKEUP_PRICE_SELECTORS = [
  // New React SPA layout (2025+)
  'span[class*="Price__priceCurrent"]',
  'div[class*="ProductBuySection__price"] span[class*="Price__priceCurrent"]',
  'div[class*="Price__price"] span[class*="Price__priceCurrent"]',
  // Structured data
  '.ProductBuySection__container meta[itemprop="price"]',
  // Legacy selectors (pre-2025)
  '.product-item__price .product-item__price-current',
  '.product-item__price',
  '.price-block__price',
];

/**
 * Last-resort fallback: extract price from productName field.
 * Some trackers store the price in the name, e.g.:
 *   "Very Good Girl Glam Eau de Parfum — 50ml — 5334"
 *   "Product Name — 80ml — 6860"
 * Pattern: "— PRICE" at the end (possibly with "грн"/"₴" suffix).
 * @param {string} productName
 * @returns {number|null}
 */
function extractPriceFromProductName(productName) {
  if (!productName) return null;
  // Match "— DIGITS" at the end, optionally followed by currency
  var match = productName.match(/—\s*([\d\s.,]+)\s*(?:грн|₴|UAH)?\s*$/);
  if (match) {
    var price = parsePrice(match[1]);
    if (price !== null && price > 0) return price;
  }
  return null;
}

/**
 * Extract volume (ml) from a Notino page via Puppeteer page.evaluate.
 * Checks: selected variant area, variant tile label, product specs, URL.
 * @param {import('puppeteer-core').Page} page
 * @returns {Promise<string|null>} e.g. "50 мл" or null
 */
async function extractNotinoVolume(page) {
  try {
    return await page.evaluate(function() {
      // 1. Selected variant area: #pdSelectedVariant [aria-live] span
      try {
        var selectedArea = document.querySelector('#pdSelectedVariant [aria-live]');
        if (selectedArea) {
          var spans = selectedArea.querySelectorAll('span');
          for (var i = 0; i < spans.length; i++) {
            var txt = (spans[i].textContent || '').replace(/\u00A0/g, ' ').trim();
            if (/^\d+\s*мл$/i.test(txt)) return txt;
          }
        }
      } catch (_) {}

      // 2. Selected variant tile label
      try {
        var selectedTile = document.querySelector('.pd-variant-selected .pd-variant-label');
        if (selectedTile) {
          var label = (selectedTile.textContent || '').replace(/\u00A0/g, ' ').trim();
          if (/^\d+\s*мл$/i.test(label)) return label;
        }
      } catch (_) {}

      // 3. Product specs: look for standalone volume, but SKIP "price / N мл" patterns
      try {
        var specs = document.querySelector('[data-testid="product-specifications"]');
        if (specs) {
          var specText = (specs.textContent || '').replace(/\u00A0/g, ' ');
          var specVolumes = specText.match(/(\d+)\s*мл/gi);
          if (specVolumes) {
            for (var sv = 0; sv < specVolumes.length; sv++) {
              var volCandidate = specVolumes[sv].trim();
              var volNum = parseInt(volCandidate, 10);
              var volIdx = specText.indexOf(volCandidate);
              var before = specText.substring(Math.max(0, volIdx - 5), volIdx).trim();
              if (before.endsWith('/')) continue;
              if (volNum > 0 && volNum <= 1000) return volCandidate;
            }
          }
        }
      } catch (_) {}

      // 4. URL pattern: /N-ml/
      try {
        var urlMatch = location.pathname.match(/(\d+)-ml\b/i);
        if (urlMatch) return urlMatch[1] + ' мл';
      } catch (_) {}

      return null;
    });
  } catch (err) {
    console.log('[Scraper] extractNotinoVolume error: ' + err.message);
    return null;
  }
}

/** @type {import('puppeteer-core').Browser | null} */
let browserInstance = null;

/**
 * Launch or reuse a Chromium browser instance.
 * @returns {Promise<import('puppeteer-core').Browser>}
 */
async function getBrowser() {
  if (browserInstance && browserInstance.connected) {
    return browserInstance;
  }

  console.log(`[Scraper] Launching Chromium from ${CHROMIUM_PATH}...`);
  const launchStart = Date.now();

  browserInstance = await puppeteer.launch({
    executablePath: CHROMIUM_PATH,
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-default-apps',
      '--disable-sync',
      '--disable-translate',
      '--metrics-recording-only',
      '--no-first-run',
      '--safebrowsing-disable-auto-update',
      '--disable-web-security',
      '--disable-blink-features=AutomationControlled',
    ],
  });

  const launchMs = Date.now() - launchStart;
  console.log(`[Scraper] Chromium launched in ${launchMs}ms (PID: ${browserInstance.process()?.pid || 'unknown'})`);

  return browserInstance;
}

/**
 * Close the browser instance (call after a check cycle).
 */
async function closeBrowser() {
  if (browserInstance) {
    try {
      console.log('[Scraper] Closing Chromium...');
      await browserInstance.close();
      console.log('[Scraper] Chromium closed.');
    } catch (err) {
      console.warn('[Scraper] Error closing Chromium:', err.message);
    }
    browserInstance = null;
  }
}

/**
 * Extract price from a page using CSS selector.
 * Handles variant clicking, retries, and auto-detection fallback.
 *
 * @param {Object} tracker — tracker row from DB
 * @returns {Promise<{success: boolean, price?: number, error?: string}>}
 */
async function extractPrice(tracker, options) {
  const browser = await getBrowser();
  let page;
  const pageStart = Date.now();
  const trackerId = tracker.id;
  const shortName = (tracker.productName || '').substring(0, 50);
  var siteCookies = (options && options.siteCookies) || null;

  try {
    page = await browser.newPage();

    // Anti-detection: patch navigator properties before any page scripts run
    await page.evaluateOnNewDocument(() => {
      // Override webdriver flag
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      // Override plugins to look like a real browser
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5],
      });
      // Override languages
      Object.defineProperty(navigator, 'languages', {
        get: () => ['uk-UA', 'uk', 'ru', 'en-US', 'en'],
      });
      // Override chrome runtime
      window.chrome = { runtime: {} };
      // Override permissions query
      const origQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (params) =>
        params.name === 'notifications'
          ? Promise.resolve({ state: Notification.permission })
          : origQuery(params);
    });

    // Block images, fonts, media to speed up loading
    // Don't block stylesheets for Notino (React SPA may need CSS)
    const isNotinoPage = (tracker.pageUrl || '').indexOf('notino.ua') !== -1;
    const isEvaPage = (tracker.pageUrl || '').indexOf('eva.ua') !== -1;
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const type = req.resourceType();
      // Don't block stylesheets for React SPAs (Notino, EVA) — they need CSS for rendering
      const blockTypes = (isNotinoPage || isEvaPage)
        ? ['image', 'font', 'media']
        : ['image', 'font', 'media', 'stylesheet'];
      if (blockTypes.includes(type)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    // Set a realistic user agent (randomized from pool)
    var selectedUA = randomUA();
    await page.setUserAgent(selectedUA);

    // Set viewport
    await page.setViewport({ width: 1366, height: 768 });

    // Set extra HTTP headers to look more like a real browser
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'uk-UA,uk;q=0.9,ru;q=0.8,en-US;q=0.7,en;q=0.6',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'sec-ch-ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
    });

    // Navigate to the page
    // For EVA with hash URLs and variant selector: strip the hash to avoid
    // SPA navigation issues during initial load. We'll click the variant later.
    var navigateUrl = tracker.pageUrl;
    if (isEvaPage && tracker.variantSelector && (navigateUrl || '').indexOf('#') !== -1) {
      navigateUrl = navigateUrl.split('#')[0];
      console.log(`[Scraper] #${trackerId} EVA: stripped hash, loading base URL: ${navigateUrl}`);
    }
    console.log(`[Scraper] #${trackerId} Loading: ${navigateUrl}`);

    // ─── Cookie injection: set site-specific cookies before navigation ───
    if (siteCookies && Array.isArray(siteCookies)) {
      try {
        var pageUrlObj = new URL(navigateUrl);
        var pageDomain = pageUrlObj.hostname.replace(/^www\./, '');
        var matchingEntry = siteCookies.find(function(entry) {
          if (!entry || !entry.domain) return false;
          var entryDomain = entry.domain.replace(/^www\./, '').replace(/^\./, '');
          return pageDomain === entryDomain || pageDomain.endsWith('.' + entryDomain);
        });
        if (matchingEntry && Array.isArray(matchingEntry.cookies) && matchingEntry.cookies.length > 0) {
          var puppeteerCookies = matchingEntry.cookies.map(function(c) {
            var pc = {
              name: c.name,
              value: c.value,
              domain: c.domain || pageDomain,
              path: c.path || '/',
            };
            if (c.secure) pc.secure = true;
            if (c.httpOnly) pc.httpOnly = true;
            if (c.sameSite) {
              var ss = c.sameSite.charAt(0).toUpperCase() + c.sameSite.slice(1).toLowerCase();
              if (['Strict', 'Lax', 'None'].indexOf(ss) !== -1) pc.sameSite = ss;
            }
            if (c.expirationDate && c.expirationDate > 0) pc.expires = c.expirationDate;
            return pc;
          });
          await page.setCookie.apply(page, puppeteerCookies);
          console.log(`[Scraper] #${trackerId} 🍪 Injected ${puppeteerCookies.length} cookies for ${pageDomain}`);
        }
      } catch (cookieErr) {
        console.warn(`[Scraper] #${trackerId} ⚠ Cookie injection failed: ${cookieErr.message}`);
      }
    }

    const navStart = Date.now();
    try {
      await page.goto(navigateUrl, {
        waitUntil: 'networkidle2',
        timeout: PAGE_TIMEOUT_MS,
      });
    } catch (navErr) {
      // If networkidle2 times out, the page content is likely already loaded —
      // sites like Kasta keep persistent connections open (analytics, websockets)
      // that prevent networkidle2 from ever firing. Don't reload, just continue
      // with the already-loaded page and wait for the tracker's CSS selector.
      if (navErr.message && navErr.message.indexOf('timeout') !== -1) {
        console.log(`[Scraper] #${trackerId} networkidle2 timed out — page likely loaded, waiting for selector...`);
        // Wait for the tracker's CSS selector to appear (JS rendering)
        var selectorToWait = tracker.cssSelector;
        if (selectorToWait) {
          try {
            await page.waitForSelector(selectorToWait, { timeout: 10000 });
            console.log(`[Scraper] #${trackerId} Selector found after networkidle2 timeout`);
          } catch (_) {
            console.log(`[Scraper] #${trackerId} Selector not found after 10s wait, continuing anyway...`);
          }
        } else {
          // No specific selector — just wait a bit for JS rendering
          await new Promise(function(r) { setTimeout(r, 5000); });
        }
      } else {
        throw navErr;
      }
    }
    console.log(`[Scraper] #${trackerId} Page loaded in ${Date.now() - navStart}ms`);

    // WAF/Cloudflare block detection — if blocked, return error with special flag
    var wafBlocked = await isWafBlocked(page);
    if (wafBlocked) {
      var pageTitle = '';
      try { pageTitle = await page.title(); } catch(_) {}
      var elapsed = Date.now() - pageStart;
      console.log(`[Scraper] #${trackerId} ⛔ WAF blocked (${elapsed}ms): "${pageTitle}" — ${shortName}`);
      return { success: false, error: 'WAF_BLOCKED: ' + pageTitle, wafBlocked: true };
    }

    // Determine site-specific price selectors for this URL
    const isMakeup = (tracker.pageUrl || '').indexOf('makeup.com.ua') !== -1;
    const isEva = (tracker.pageUrl || '').indexOf('eva.ua') !== -1;
    const isNotino = (tracker.pageUrl || '').indexOf('notino.ua') !== -1;
    const isKasta = (tracker.pageUrl || '').indexOf('kasta.ua') !== -1;

    // ─── Notino wait-page detection ──────────────────────────────────
    // Notino shows "Трохи зачекайте…" (Please wait) page as bot protection.
    // Unlike Cloudflare WAF, this page sometimes resolves after a few seconds.
    // Strategy: detect it, wait up to 30s for the real page, then treat as WAF if stuck.
    if (isNotino) {
      var notinoTitle = '';
      try { notinoTitle = await page.title(); } catch(_) {}
      var isWaitPage = /зачекайте|please wait|moment/i.test(notinoTitle);
      if (isWaitPage) {
        console.log(`[Scraper] #${trackerId} Notino: wait page detected ("${notinoTitle}"), waiting for real page...`);
        var waitPageResolved = false;
        for (var waitAttempt = 0; waitAttempt < 6; waitAttempt++) {
          await new Promise(function(r) { setTimeout(r, 5000); });
          try {
            var currentTitle = await page.title();
            if (!/зачекайте|please wait|moment/i.test(currentTitle)) {
              console.log(`[Scraper] #${trackerId} Notino: wait page resolved after ${(waitAttempt + 1) * 5}s — "${currentTitle}"`);
              waitPageResolved = true;
              // Give React app time to hydrate after page resolves
              await new Promise(function(r) { setTimeout(r, 3000); });
              break;
            }
          } catch(_) {}
        }
        if (!waitPageResolved) {
          var elapsed = Date.now() - pageStart;
          console.log(`[Scraper] #${trackerId} ⛔ Notino wait page did not resolve after 30s (${elapsed}ms) — ${shortName}`);
          return { success: false, error: 'NOTINO_WAIT_PAGE: ' + notinoTitle, wafBlocked: true };
        }
      }
    }

    // ─── EVA.UA variant: click variant button found by title pattern ──────────
    // EVA is a Vue/Nuxt SPA. The variant buttons have title="VOLUME (PRODUCT_ID)".
    // Hash navigation doesn't work (EVA ignores the hash on initial load).
    // But clicking the button DOES work — we just need to find it by title.
    // Strategy: extract volume from productName, find button by title, click it,
    // wait for price to update.
    if (isEva && tracker.variantSelector) {
      // Extract desired volume from productName (e.g., "— 100" or "— 30" or "100 мл" or "30 мл")
      var volumeMatch = (tracker.productName || '').match(/—\s*(\d+)/);
      if (!volumeMatch) volumeMatch = (tracker.productName || '').match(/(\d+)\s*(?:мл|ml)\b/i);
      var desiredVolume = volumeMatch ? volumeMatch[1] : null;
      console.log('[Scraper] #' + trackerId + ' EVA: looking for variant, desired volume: ' + (desiredVolume || 'unknown'));

      var evaVariantResult = await page.evaluate(function(varSel, wantedVol) {
        // Find all variant buttons with title="VOLUME (ID)" pattern
        var allButtons = [];
        var matchedBtn = null;
        var matchedEl = null;
        var buttons = document.querySelectorAll('button[title]');
        buttons.forEach(function(b) {
          var t = (b.getAttribute('title') || '').trim();
          var m = t.match(/^(\d+)\s*\((\d+)\)$/);
          if (m) {
            var info = {
              title: t,
              volume: m[1],
              productId: m[2],
              selected: (b.className || '').indexOf('border-apple') !== -1,
              outOfStock: (b.className || '').indexOf('border-dark-900') !== -1
            };
            allButtons.push(info);
            if (wantedVol && m[1] === wantedVol) {
              matchedBtn = info;
            }
          }
        });

        // Read current price
        var priceEl = document.querySelector('[data-testid="product-price"]');
        var currentPrice = priceEl ? (priceEl.textContent || '').trim() : null;

        return {
          matched: matchedBtn,
          currentPrice: currentPrice,
          allButtons: allButtons
        };
      }, tracker.variantSelector, desiredVolume);

      console.log('[Scraper] #' + trackerId + ' EVA variant info:', JSON.stringify(evaVariantResult));

      if (evaVariantResult && evaVariantResult.matched) {
        var matched = evaVariantResult.matched;

        // NOTE: Do NOT trust matched.selected here. When EVA loads without hash
        // (which is always the case for server-side Puppeteer), the SSR HTML may
        // mark a variant button as "selected" (border-apple class) based on the
        // URL hash from the original page, but the DISPLAYED PRICE on the page
        // is always for the DEFAULT variant (usually 30ml). So we must ALWAYS
        // click the desired variant button to ensure the price updates correctly.

        // Click the variant button using title-based selector
        var titleSelector = 'button[title="' + matched.title + '"]';
        console.log('[Scraper] #' + trackerId + ' EVA: clicking variant via: ' + titleSelector);

        try {
          await page.waitForSelector(titleSelector, { timeout: 5000 });

          // Read price BEFORE click for comparison
          var priceBefore = await page.evaluate(function() {
            var el = document.querySelector('[data-testid="product-price"]');
            return el ? (el.textContent || '').trim() : null;
          });
          console.log('[Scraper] #' + trackerId + ' EVA: price before click: ' + (priceBefore || 'none'));

          // Use JS click via evaluate — Puppeteer's page.click() triggers
          // navigation detection on EVA SPA which causes "detached Frame" errors.
          // JS dispatchEvent stays in the same execution context.
          var clickCausedNavigation = false;
          try {
            await page.evaluate(function(sel) {
              var btn = document.querySelector(sel);
              if (btn) {
                // Dispatch both click and pointerup events for Vue compatibility
                btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
                btn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
                btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
              }
            }, titleSelector);
          } catch (clickErr) {
            console.log('[Scraper] #' + trackerId + ' EVA: JS click error: ' + clickErr.message);
            clickCausedNavigation = true;
          }

          // After click, the SPA may navigate. Wait for everything to settle.
          if (clickCausedNavigation) {
            // Wait for any pending navigation to complete
            try {
              await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 });
            } catch (_) {}
          }

          // Out-of-stock variants: EVA removes the price element entirely,
          // so use shorter timeouts to avoid wasting ~40s on retries.
          var isOutOfStock = matched.outOfStock;
          var settleDelay = isOutOfStock ? 2000 : 4000;
          var readRetries = isOutOfStock ? 1 : 3;
          var readTimeout = isOutOfStock ? 3000 : 10000;
          var retryDelay = isOutOfStock ? 1000 : 3000;

          if (isOutOfStock) {
            console.log('[Scraper] #' + trackerId + ' EVA: variant is out-of-stock, using fast path');
          }

          await new Promise(function(r) { setTimeout(r, settleDelay); });

          // Wait for price to actually change after variant click
          if (priceBefore && !isOutOfStock) {
            try {
              await page.waitForFunction(function(oldPrice) {
                var el = document.querySelector('[data-testid="product-price"]');
                if (!el) return false;
                var newPrice = (el.textContent || '').trim();
                return newPrice && newPrice !== oldPrice;
              }, { timeout: 8000 }, priceBefore);
              console.log('[Scraper] #' + trackerId + ' EVA: price changed after variant click');
            } catch (_) {
              console.log('[Scraper] #' + trackerId + ' EVA: price did not change after click (may be same price for this variant)');
            }
          }

          // Try to read the price — may need multiple attempts if frame was detached
          var evaPrice = null;
          for (var readAttempt = 0; readAttempt < readRetries; readAttempt++) {
            try {
              await page.waitForSelector('[data-testid="product-price"]', { timeout: readTimeout });
              evaPrice = await page.evaluate(function() {
                var el = document.querySelector('[data-testid="product-price"]');
                return el ? (el.textContent || '').trim() : null;
              });
              if (evaPrice) break;
            } catch (readErr) {
              console.log('[Scraper] #' + trackerId + ' EVA: read attempt ' + (readAttempt + 1) + ' failed: ' + readErr.message);
              if (readAttempt < readRetries - 1) {
                await new Promise(function(r) { setTimeout(r, retryDelay); });
              }
            }
          }
          console.log('[Scraper] #' + trackerId + ' EVA: price after click: ' + (evaPrice || 'none'));

          if (evaPrice) {
            var price = parsePrice(evaPrice);
            if (price !== null && price > 0) {
              var elapsed = Date.now() - pageStart;
              console.log('[Scraper] #' + trackerId + ' ✅ Price: ' + price + ' (EVA variant click, ' + elapsed + 'ms) — ' + shortName);
              return { success: true, price: price };
            }
          }

          // EVA variant click didn't produce a price — variant likely out of stock
          var elapsed = Date.now() - pageStart;
          console.log('[Scraper] #' + trackerId + ' ❌ EVA variant price not found after click (' + elapsed + 'ms) — ' + shortName);
          return { success: false, error: 'EVA variant out of stock or price not found' };
        } catch (clickErr) {
          console.log('[Scraper] #' + trackerId + ' EVA: click failed: ' + clickErr.message);
        }
      } else {
        console.log('[Scraper] #' + trackerId + ' EVA: no matching variant button found. Buttons:', JSON.stringify((evaVariantResult || {}).allButtons));
        return { success: false, error: 'EVA variant button not found on page' };
      }
    }

    // Notino is a React SPA — wait for the price element to render.
    // Gift set pages may have a different layout (originalPriceWrapper + discount badge).
    // Try multiple selectors including parent containers that appear earlier in render.
    if (isNotino) {
      var pdPriceFound = false;
      var notinoSelectors = [
        '#pd-price span[data-testid="pd-price"]',
        'span[data-testid="pd-price"]',
        '#pd-price',
        '#pdSelectedVariant',
        'div[data-testid="pd-price-wrapper"] span[content]',
        'span[data-testid="pd-price-wrapper"] span[content]',
        '[data-testid="originalPriceWrapper"]',
      ];
      for (var nsi = 0; nsi < notinoSelectors.length && !pdPriceFound; nsi++) {
        try {
          await page.waitForSelector(notinoSelectors[nsi], { timeout: nsi === 0 ? 15000 : 3000 });
          pdPriceFound = true;
          console.log(`[Scraper] #${trackerId} Notino: found via ${notinoSelectors[nsi]}`);
        } catch (_) {}
      }
      if (!pdPriceFound) {
        console.log(`[Scraper] #${trackerId} Notino: no price selector found after all attempts, retrying after extra wait...`);
        await new Promise(r => setTimeout(r, 5000));
        for (var nsi2 = 0; nsi2 < notinoSelectors.length && !pdPriceFound; nsi2++) {
          var retryEl = await page.$(notinoSelectors[nsi2]);
          if (retryEl) {
            pdPriceFound = true;
            console.log(`[Scraper] #${trackerId} Notino: found on retry via ${notinoSelectors[nsi2]}`);
          }
        }
        if (!pdPriceFound) {
          // Diagnostic: log what IS on the page to help debug
          try {
            var diagInfo = await page.evaluate(function() {
              var title = document.title || '';
              var bodyLen = (document.body && document.body.innerHTML) ? document.body.innerHTML.length : 0;
              var hasReactRoot = !!document.querySelector('#__next') || !!document.querySelector('[data-reactroot]') || !!document.querySelector('#root');
              var hasPdPage = !!document.querySelector('[class*="pd-"]') || !!document.querySelector('[data-testid*="pd-"]');
              var priceTexts = [];
              // Look for any element with "price" in data-testid
              document.querySelectorAll('[data-testid*="price"]').forEach(function(el) {
                priceTexts.push(el.getAttribute('data-testid') + ': ' + (el.getAttribute('content') || el.textContent || '').substring(0, 50));
              });
              return { title: title.substring(0, 80), bodyLen: bodyLen, hasReactRoot: hasReactRoot, hasPdPage: hasPdPage, priceElements: priceTexts.slice(0, 5) };
            });
            console.log(`[Scraper] #${trackerId} Notino diagnostic: title="${diagInfo.title}", bodyLen=${diagInfo.bodyLen}, react=${diagInfo.hasReactRoot}, pdElements=${diagInfo.hasPdPage}, priceEls=${JSON.stringify(diagInfo.priceElements)}`);
          } catch (diagErr) {
            console.log(`[Scraper] #${trackerId} Notino: diagnostic failed: ${diagErr.message}`);
          }
          console.log(`[Scraper] #${trackerId} Notino: still not found after retry`);
        }
      }
    }

    // Build the list of selectors to watch for price changes after variant click
    var priceWatchSelectors = [];
    if (isMakeup) {
      priceWatchSelectors = MAKEUP_PRICE_SELECTORS.slice();
    } else if (isEva) {
      priceWatchSelectors = ['[data-testid="product-price"]'];
    } else {
      priceWatchSelectors = [
        '[data-testid="product-price"]', '[itemprop="price"]',
        '.product-price__big', '.product__price', '.price-current', '.product-price',
      ];
    }

    // ─── Variant handling ────────────────────────────────────────────
    // makeup.com.ua stores prices in data-price attributes on variant elements,
    // so we can read the price directly without clicking.
    // eva.ua is handled above with direct URL navigation.
    var variantClicked = false;
    if (tracker.variantSelector) {
      // MAKEUP.COM.UA: read data-price attribute directly from the variant element
      // The variant divs have data-variant-id and data-price attributes.
      // We try multiple strategies to find the right variant element.
      if (isMakeup) {
        // Wait for page to fully settle (Makeup may do JS redirects)
        await new Promise(function(r) { setTimeout(r, 2000); });

        // ─── New React SPA layout (2025+) ───
        // Variants are div[class*="ProductBuySection__variant"] with meta[itemprop="price"]
        // The selected variant has class *="ProductBuySection__selected"
        // Each variant has a title div with volume text (e.g. "80ml")
        var makeupNewLayout = await page.evaluate(function() {
          return !!document.querySelector('div[class*="ProductBuySection__variant"]') ||
                 !!document.querySelector('span[class*="Price__priceCurrent"]');
        });

        if (makeupNewLayout) {
          console.log('[Scraper] #' + trackerId + ' Makeup: detected new React SPA layout');

          // Extract desired volume from productName or variantSelector
          var volMatch = (tracker.productName || '').match(/—\s*(\d+)ml/i);
          if (!volMatch) volMatch = (tracker.productName || '').match(/(\d+)\s*ml\b/i);
          if (!volMatch) volMatch = (tracker.variantSelector || '').match(/(\d+)ml/i);
          var desiredVolume = volMatch ? volMatch[1] : null;

          // Also try to extract variant ID from the selector
          var wantedVariantId = null;
          // New format: #variantId (e.g. #2921590_3)
          var hashIdMatch = (tracker.variantSelector || '').match(/^#(.+)$/);
          if (hashIdMatch) {
            wantedVariantId = hashIdMatch[1];
          }
          // Old format: [data-variant-id="..."]
          if (!wantedVariantId) {
            var vidMatch = (tracker.variantSelector || '').match(/data-variant-id[*~|^$]?=["']?([^"'\]]+)/);
            if (vidMatch) {
              wantedVariantId = vidMatch[1]
                .replace(/\\3(\d)\s*/g, function(_, d) { return String.fromCharCode(0x30 + parseInt(d)); })
                .replace(/\\(\d)/g, function(_, d) { return d; })
                .replace(/\\/g, '')
                .trim();
            }
          }

          // Detect EU region from productName (e.g. "... — 80ml (ЕС)")
          var wantEU = /\(ЕС\)/i.test(tracker.productName || '') || /_3$/.test(wantedVariantId || '');

          console.log('[Scraper] #' + trackerId + ' Makeup: looking for volume=' + (desiredVolume || 'unknown') + ', variantId=' + (wantedVariantId || 'unknown') + ', wantEU=' + wantEU);

          var makeupResult = await page.evaluate(function(wantedVol, wantedVid, wantEU) {
            var variants = document.querySelectorAll('div[class*="ProductBuySection__variant"]');
            var allVariants = [];
            var matchedPrice = null;

            for (var i = 0; i < variants.length; i++) {
              var v = variants[i];
              var id = v.getAttribute('id') || '';
              var meta = v.querySelector('meta[itemprop="price"]');
              var price = meta ? meta.getAttribute('content') : null;
              var titleEl = v.querySelector('div[class*="ProductBuySection__title"]');
              var title = titleEl ? (titleEl.textContent || '').trim() : '';
              var isSelected = (v.className || '').indexOf('selected') !== -1 ||
                               (v.className || '').indexOf('Selected') !== -1;
              var hasFlag = !!v.querySelector('img[class*="Flag"]');

              allVariants.push({ id: id, title: title, price: price, selected: isSelected, eu: hasFlag });

              // Match by exact variant ID
              if (wantedVid && id === wantedVid) {
                if (price) matchedPrice = price;
              }
            }

            // If no exact ID match, try matching by volume + region
            if (!matchedPrice && wantedVol) {
              for (var j = 0; j < allVariants.length; j++) {
                var av = allVariants[j];
                var volNum = av.title.match(/(\d+)/);
                if (volNum && volNum[1] === wantedVol && av.eu === wantEU) {
                  if (av.price) { matchedPrice = av.price; break; }
                }
              }
              // Fallback: match volume without region check
              if (!matchedPrice) {
                for (var k = 0; k < allVariants.length; k++) {
                  var av2 = allVariants[k];
                  var volNum2 = av2.title.match(/(\d+)/);
                  if (volNum2 && volNum2[1] === wantedVol) {
                    if (av2.price) { matchedPrice = av2.price; break; }
                  }
                }
              }
            }

            // Also check li[role="option"] in the dropdown selector
            if (!matchedPrice) {
              var options = document.querySelectorAll('li[role="option"] meta[itemprop="price"]');
              for (var j = 0; j < options.length; j++) {
                var optMeta = options[j];
                var optContainer = optMeta.closest('li[role="option"]') || optMeta.closest('div[itemprop="offers"]');
                if (!optContainer) continue;
                var optName = optContainer.querySelector('meta[itemprop="name"]');
                var optNameText = optName ? (optName.getAttribute('content') || '') : (optContainer.textContent || '');
                var optPrice = optMeta.getAttribute('content');

                if (wantedVid) {
                  var optUrl = optContainer.querySelector('meta[itemprop="url"]');
                  var optUrlText = optUrl ? (optUrl.getAttribute('content') || '') : '';
                  if (optUrlText.indexOf(wantedVid) !== -1 && optPrice) {
                    matchedPrice = optPrice;
                    break;
                  }
                }
                if (wantedVol && optNameText.indexOf(wantedVol + 'ml') !== -1) {
                  if (optPrice) { matchedPrice = optPrice; break; }
                }
              }
            }

            // Fallback: read the currently displayed price
            var displayedPrice = null;
            var priceEl = document.querySelector('span[class*="Price__priceCurrent"]');
            if (priceEl) displayedPrice = (priceEl.textContent || '').trim();

            return {
              matchedPrice: matchedPrice,
              displayedPrice: displayedPrice,
              allVariants: allVariants
            };
          }, desiredVolume, wantedVariantId, wantEU);

          console.log('[Scraper] #' + trackerId + ' Makeup new layout result:', JSON.stringify(makeupResult));

          if (makeupResult) {
            var priceStr = makeupResult.matchedPrice || makeupResult.displayedPrice;
            if (priceStr) {
              var price = parsePrice(priceStr);
              if (price !== null && price > 0) {
                var elapsed = Date.now() - pageStart;
                var method = makeupResult.matchedPrice ? 'variant meta' : 'displayed price';
                console.log('[Scraper] #' + trackerId + ' ✅ Price: ' + price + ' (Makeup ' + method + ', ' + elapsed + 'ms) — ' + shortName);
                return { success: true, price: price };
              }
            }
          }
        }

        // ─── Legacy layout fallback ───
        // Wait for variant elements to appear in DOM
        try {
          await page.waitForSelector('.variant[data-variant-id]', { timeout: 8000 });
          console.log('[Scraper] #' + trackerId + ' Makeup: variant elements found in DOM');
        } catch (_) {
          console.log('[Scraper] #' + trackerId + ' Makeup: variant elements not found after 8s wait');
        }

        var makeupResult = null;
        for (var makeupRetry = 0; makeupRetry < 2; makeupRetry++) {
          try {
            makeupResult = await page.evaluate(function(sel) {
          var el = null;
          
          // Strategy 1: try the selector as-is
          try { el = document.querySelector(sel); } catch(e) {}
          
          // Strategy 2: extract variant ID from selector and search directly
          if (!el && sel.indexOf('data-variant-id') !== -1) {
            // Extract the raw variant ID from various selector formats:
            // [data-variant-id="\35 03001_3"] → 503001_3
            // [data-variant-id="503001_3"] → 503001_3
            // .variant[data-variant-id*="503001"] → 503001
            var rawMatch = sel.match(/data-variant-id[*~|^$]?=["']?([^"'\]]+)/);
            if (rawMatch) {
              var rawId = rawMatch[1]
                // Decode CSS unicode escapes: \35 → "5", \33 → "3", etc.
                .replace(/\\3(\d)\s*/g, function(_, d) { return String.fromCharCode(0x30 + parseInt(d)); })
                .replace(/\\(\d)/g, function(_, d) { return d; })
                .replace(/\\/g, '')
                .trim();
              
              // Try exact match first
              el = document.querySelector('[data-variant-id="' + rawId + '"]');
              
              // Try contains match if exact fails
              if (!el) {
                var allVariants = document.querySelectorAll('.variant[data-variant-id]');
                for (var i = 0; i < allVariants.length; i++) {
                  var vid = allVariants[i].getAttribute('data-variant-id') || '';
                  if (vid === rawId || vid.indexOf(rawId) !== -1 || rawId.indexOf(vid) !== -1) {
                    el = allVariants[i];
                    break;
                  }
                }
              }
            }
          }
          
          // Strategy 3: if selector is like .variant:nth-child(N), try it
          if (!el && /variant.*nth-child/i.test(sel)) {
            try { el = document.querySelector(sel); } catch(e) {}
          }
          
          if (!el) return { found: false, allVariants: [] };
          
          // Read data-price from the element itself or walk up to find it
          var dp = el.getAttribute('data-price');
          if (!dp) {
            var parent = el.closest('[data-price]');
            if (parent) dp = parent.getAttribute('data-price');
          }
          if (!dp) {
            var variantDiv = el.closest('.variant') || el;
            dp = variantDiv.getAttribute('data-price');
          }
          
          // Also try meta itemprop="price" inside the variant
          var metaContent = null;
          var variantContainer = el.closest('[data-variant-id]') || el.closest('.variant') || el;
          var meta = variantContainer.querySelector('meta[itemprop="price"]');
          if (meta) metaContent = meta.getAttribute('content');
          
          // Collect all variants for debugging
          var allVariants = [];
          document.querySelectorAll('.variant[data-variant-id]').forEach(function(v) {
            allVariants.push({
              id: v.getAttribute('data-variant-id'),
              price: v.getAttribute('data-price'),
              title: (v.getAttribute('title') || '').trim(),
              checked: v.classList.contains('checked')
            });
          });
          
          return {
            found: true,
            dataPrice: dp,
            metaPrice: metaContent,
            variantId: (el.getAttribute('data-variant-id') || ''),
            allVariants: allVariants
          };
        }, tracker.variantSelector);
            break; // Success — exit retry loop
          } catch (evalErr) {
            console.log('[Scraper] #' + trackerId + ' Makeup: evaluate failed (attempt ' + (makeupRetry + 1) + '): ' + evalErr.message);
            if (makeupRetry === 0) {
              // Wait and retry — page may have navigated
              await new Promise(function(r) { setTimeout(r, 3000); });
            }
          }
        }

        console.log('[Scraper] #' + trackerId + ' Makeup variant result:', JSON.stringify(makeupResult));

        if (makeupResult && makeupResult.found) {
          // Prefer data-price, fall back to meta itemprop price
          var priceStr = makeupResult.dataPrice || makeupResult.metaPrice;
          if (priceStr) {
            var price = parsePrice(priceStr);
            if (price !== null && price > 0) {
              var elapsed = Date.now() - pageStart;
              console.log('[Scraper] #' + trackerId + ' ✅ Price: ' + price + ' (Makeup data-price, ' + elapsed + 'ms) — ' + shortName);
              return { success: true, price: price };
            }
            console.log('[Scraper] #' + trackerId + ' Makeup: found price text "' + priceStr + '" but parse failed');
          } else {
            console.log('[Scraper] #' + trackerId + ' Makeup: variant found but no data-price or meta price');
          }
        } else {
          console.log('[Scraper] #' + trackerId + ' Makeup: variant element not found, trying meta price fallback...');
          
          // Fallback: extract variant ID from selector, find any element with that data-variant-id
          // or read price from meta[itemprop="price"] matching the variant volume from productName
          var metaFallbackResult = null;
          try {
            metaFallbackResult = await page.evaluate(function(sel, prodName) {
              // Extract variant ID from selector
              var rawMatch = sel.match(/data-variant-id[*~|^$]?=["']?([^"'\]]+)/);
              var variantId = rawMatch ? rawMatch[1].replace(/\\/g, '').trim() : null;
              
              // Try finding element by data-variant-id without .variant class requirement
              var el = null;
              if (variantId) {
                el = document.querySelector('[data-variant-id="' + variantId + '"]');
              }
              if (el) {
                var dp = el.getAttribute('data-price');
                var meta = el.querySelector('meta[itemprop="price"]');
                var metaPrice = meta ? meta.getAttribute('content') : null;
                return { found: true, price: dp || metaPrice, method: 'data-variant-id-no-class' };
              }
              
              // Try extracting volume from productName (e.g., "— 50ml — 5334")
              var volMatch = (prodName || '').match(/—\s*(\d+)ml/i);
              var wantedVol = volMatch ? volMatch[1] + 'ml' : null;
              
              // Search all elements with data-variant-id (any tag/class)
              var allVarEls = document.querySelectorAll('[data-variant-id]');
              for (var i = 0; i < allVarEls.length; i++) {
                var v = allVarEls[i];
                var title = (v.getAttribute('title') || '').trim().toLowerCase();
                var dp2 = v.getAttribute('data-price');
                var vid = v.getAttribute('data-variant-id');
                if (variantId && vid === variantId && dp2) {
                  return { found: true, price: dp2, method: 'any-element-variant-id' };
                }
                if (wantedVol && title === wantedVol.toLowerCase() && dp2) {
                  return { found: true, price: dp2, method: 'volume-title-match' };
                }
              }
              
              // Do NOT fall back to main displayed price — it may be a different variant
              return { found: false };
            }, tracker.variantSelector, tracker.productName);
          } catch (e) {
            console.log('[Scraper] #' + trackerId + ' Makeup: meta fallback evaluate error: ' + e.message);
          }
          
          if (metaFallbackResult && metaFallbackResult.found && metaFallbackResult.price) {
            var price = parsePrice(metaFallbackResult.price);
            if (price !== null && price > 0) {
              var elapsed = Date.now() - pageStart;
              console.log('[Scraper] #' + trackerId + ' ✅ Price: ' + price + ' (Makeup ' + metaFallbackResult.method + ', ' + elapsed + 'ms) — ' + shortName);
              return { success: true, price: price };
            }
          }
          console.log('[Scraper] #' + trackerId + ' Makeup: meta fallback result:', JSON.stringify(metaFallbackResult));
        }
      }

      // EVA.UA: variant was handled above (before Notino section) with direct URL navigation.
      // If it didn't return a price, mark as variantClicked so we try price selectors below.
      if (isEva) {
        variantClicked = true;
      }

      // Makeup: if data-price approach above didn't return, mark as variantClicked
      // so we try reading from price watch selectors as fallback.
      if (isMakeup) {
        variantClicked = true;
      }

      // Non-Makeup, non-EVA sites: click the variant and read the updated price
      // EVA is handled above with direct URL navigation.
      // Makeup is handled above with data-price attributes.
      if (!isMakeup && !isEva) {
        try {
          console.log('[Scraper] #' + trackerId + ' Clicking variant: ' + tracker.variantSelector);
          await page.waitForSelector(tracker.variantSelector, { timeout: 5000 });

          // Capture the current price text BEFORE clicking
          var priceBeforeClick = await page.evaluate(function(selectors) {
            for (var i = 0; i < selectors.length; i++) {
              try {
                var el = document.querySelector(selectors[i]);
                if (el) {
                  var text = (el.textContent || '').trim();
                  if (text && /\d/.test(text)) return text;
                }
              } catch(e) {}
            }
            return null;
          }, priceWatchSelectors);

          console.log('[Scraper] #' + trackerId + ' Price before click: ' + (priceBeforeClick || 'not found'));

          await page.click(tracker.variantSelector);
          variantClicked = true;

          // Wait for network + DOM to settle
          await page.waitForNetworkIdle({ timeout: 3000 }).catch(function() {});

          if (priceBeforeClick) {
            try {
              await page.waitForFunction(
                function(oldPrice, selectors) {
                  for (var i = 0; i < selectors.length; i++) {
                    try {
                      var el = document.querySelector(selectors[i]);
                      if (el) {
                        var current = (el.textContent || '').trim();
                        if (current && /\d/.test(current) && current !== oldPrice) return true;
                      }
                    } catch(e) {}
                  }
                  return false;
                },
                { timeout: 5000 },
                priceBeforeClick,
                priceWatchSelectors
              );
              console.log('[Scraper] #' + trackerId + ' ✅ Price changed after variant click');
            } catch (waitErr) {
              console.log('[Scraper] #' + trackerId + ' ⚠ Price did not change after click (same price or click failed)');
            }
          } else {
            await new Promise(function(r) { setTimeout(r, 2500); });
          }

          await new Promise(function(r) { setTimeout(r, 500); });

          var priceAfterClick = await page.evaluate(function(selectors) {
            for (var i = 0; i < selectors.length; i++) {
              try {
                var el = document.querySelector(selectors[i]);
                if (el) {
                  var text = (el.textContent || '').trim();
                  if (text && /\d/.test(text)) return text;
                }
              } catch(e) {}
            }
            return null;
          }, priceWatchSelectors);
          console.log('[Scraper] #' + trackerId + ' Price after click: ' + (priceAfterClick || 'not found'));

        } catch (variantErr) {
          console.warn('[Scraper] #' + trackerId + ' ⚠ Variant click failed: ' + variantErr.message);
        }

        variantClicked = true;
      }
    }

    // Wait a bit for any remaining JS rendering
    await new Promise(r => setTimeout(r, 1500));

    // For variant trackers that used click approach: read from price selectors
    if (variantClicked) {
      var variantPrice = await readPriceFromSelectors(page, priceWatchSelectors);
      if (variantPrice !== null) {
        var elapsed = Date.now() - pageStart;
        console.log('[Scraper] #' + trackerId + ' ✅ Price: ' + variantPrice + ' (variant price selector, ' + elapsed + 'ms) — ' + shortName);
        return { success: true, price: variantPrice };
      }

      // NO FALLBACK for variant trackers — auto-detect or productName extraction
      // would pick up the wrong variant's price. Mark as error instead.
      var elapsed = Date.now() - pageStart;
      console.log('[Scraper] #' + trackerId + ' ❌ Failed (variant, ' + elapsed + 'ms): Could not read price after variant click — ' + shortName);
      return { success: false, error: 'Variant price not found (variant may be out of stock): ' + tracker.variantSelector };
    }

    // ─── Non-variant trackers: try the CSS selector directly ─────────

    // Notino special: read price from content attribute of span[data-testid="pd-price"]
    // This is more reliable than textContent because font tags may not render in headless
    // IMPORTANT: Notino has two price blocks:
    //   1. originalPriceDiscountWrapper → pd-price-wrapper outside #pd-price = OLD/original price
    //   2. #pd-price → span[data-testid="pd-price"] = CURRENT discounted price (the real selling price)
    // Always prioritize #pd-price — it contains the actual price the customer pays.
    if (isNotino) {
      var notinoPrice = null;
      for (var notinoAttempt = 0; notinoAttempt < 2; notinoAttempt++) {
        try {
          notinoPrice = await page.evaluate(function() {
        // Priority 1: Current price from #pd-price (the actual selling price)
        // This is ALWAYS the discounted/current price, even when there's a sale.
        var currentSpan = document.querySelector('#pd-price span[data-testid="pd-price"]');
        if (!currentSpan) currentSpan = document.querySelector('span[data-testid="pd-price"]');
        if (currentSpan) {
          var content = currentSpan.getAttribute('content');
          if (content && /\d/.test(content)) return content;
          var text = (currentSpan.textContent || '').trim();
          if (text && /\d/.test(text)) return text;
        }

        // Priority 2: #pd-price container textContent
        var pdPrice = document.querySelector('#pd-price');
        if (pdPrice) {
          var text2 = (pdPrice.textContent || '').trim();
          if (text2 && /\d/.test(text2)) return text2;
        }

        // Priority 3: Selected variant tile price (multi-variant pages)
        var selectedVariant = document.querySelector('a.pd-variant-selected span[data-testid="price-variant"]');
        if (selectedVariant) {
          var vc = selectedVariant.getAttribute('content');
          if (vc && /\d/.test(vc)) return vc;
          var vt = (selectedVariant.textContent || '').trim();
          if (vt && /\d/.test(vt)) return vt;
        }

        // Priority 4: First variant tile price
        var anyVariant = document.querySelector('span[data-testid="price-variant"]');
        if (anyVariant) {
          var avc = anyVariant.getAttribute('content');
          if (avc && /\d/.test(avc)) return avc;
        }

        // Priority 5: #pdSelectedVariant container (gift sets)
        var pdSelected = document.querySelector('#pdSelectedVariant');
        if (pdSelected) {
          var innerSpan = pdSelected.querySelector('span[data-testid="pd-price"]') ||
                          pdSelected.querySelector('span[content]');
          if (innerSpan) {
            var ic = innerSpan.getAttribute('content');
            if (ic && /\d/.test(ic) && !/^[A-Z]{3}$/.test(ic.trim())) return ic;
          }
          var selText = (pdSelected.textContent || '').trim();
          var priceMatch = selText.match(/([\d\s]+)\s*грн/);
          if (priceMatch) return priceMatch[1].trim();
        }

        return null;
      });
          if (notinoPrice) break; // Got a result, exit retry loop
        } catch (notinoEvalErr) {
          console.log('[Scraper] #' + trackerId + ' Notino: evaluate attempt ' + (notinoAttempt + 1) + ' failed: ' + notinoEvalErr.message);
          if (notinoAttempt === 0) {
            // Wait and retry — page may have navigated (detached frame)
            await new Promise(function(r) { setTimeout(r, 3000); });
          }
        }
      }
      if (notinoPrice) {
        var price = parsePrice(notinoPrice);
        // Sanity check: Notino prices should be at least 300 грн for perfume
        // Values like 50, 80, 100, 200 are likely volume (ml) not price
        if (price !== null && price > 0 && price < 300) {
          console.log('[Scraper] #' + trackerId + ' Notino: suspicious low price ' + price + ' (likely volume, not price). Skipping.');
          price = null;
        }
        if (price !== null && price > 0) {
          var volume = await extractNotinoVolume(page);
          var elapsed = Date.now() - pageStart;
          console.log('[Scraper] #' + trackerId + ' ✅ Price: ' + price + (volume ? ' | Volume: ' + volume : '') + ' (notino content attr, ' + elapsed + 'ms) — ' + shortName);
          return { success: true, price: price, volume: volume };
        }
        console.log('[Scraper] #' + trackerId + ' Notino: found text "' + notinoPrice + '" but parse failed');
      } else {
        console.log('[Scraper] #' + trackerId + ' Notino: no price element found at all');
      }
    }

    // For Notino fallback paths: extract volume once before generic selectors
    var notinoVolume = isNotino ? await extractNotinoVolume(page) : null;

    const result = await page.evaluate((cssSelector, excludedSelectors) => {
      const el = document.querySelector(cssSelector);
      if (!el) return { found: false, text: null };

      let target = el;
      if (excludedSelectors && excludedSelectors.length > 0) {
        target = el.cloneNode(true);
        excludedSelectors.forEach(sel => {
          target.querySelectorAll(sel).forEach(n => n.remove());
        });
      }

      return { found: true, text: (target.textContent || '').trim() };
    }, tracker.cssSelector, tracker.excludedSelectors || []);

    if (result.found && result.text) {
      const price = parsePrice(result.text);
      if (price !== null && price > 0) {
        // Kasta: if the CSS selector contains a dynamic ID (#kcPrice), prefer
        // the Kasta Card price (.kcPrice span.t-bold) which is the discounted price.
        if (isKasta && /^#kcPrice/i.test(tracker.cssSelector)) {
          var kastaCardPrice = await page.evaluate(function() {
            // .kcPrice span.t-bold is the Kasta Visa Card price (lower)
            var kcBold = document.querySelector('.kcPrice span.t-bold');
            if (kcBold) {
              var text = (kcBold.textContent || '').trim();
              if (text && /^\d/.test(text)) return text;
            }
            return null;
          });
          if (kastaCardPrice) {
            var cardPrice = parsePrice(kastaCardPrice);
            if (cardPrice !== null && cardPrice > 0 && cardPrice !== price) {
              console.log(`[Scraper] #${trackerId} Kasta: dynamic selector gave ${price}, card price is ${cardPrice} — using card price`);
              var elapsed = Date.now() - pageStart;
              return { success: true, price: cardPrice };
            }
          }
        }
        var elapsed = Date.now() - pageStart;
        console.log(`[Scraper] #${trackerId} ✅ Price: ${price} (from selector, ${elapsed}ms) — ${shortName}`);
        return { success: true, price, volume: notinoVolume };
      }
      console.log(`[Scraper] #${trackerId} Selector found but parse failed: "${result.text.substring(0, 80)}"`);
    } else {
      console.log(`[Scraper] #${trackerId} Selector not found: ${tracker.cssSelector}`);
    }

    // ─── Kasta.ua fallback: dynamic CSS selectors (#kcPriceXXX) don't work ───
    // Kasta generates unique IDs per session, so selectors like #kcPrice5767287522
    // won't exist on server-side Puppeteer. Use stable selectors instead.
    // Also trigger when selector was found but price parse failed (e.g. empty text).
    // Priority: .kcPrice (Kasta Card price, lower) > #productPrice (regular) > JSON-LD
    // IMPORTANT: Exclude BNPL/installment prices (46 ₴ / 2 weeks) — these are NOT product prices.
    if (isKasta && (!result.found || (result.found && (parsePrice(result.text) === null || parsePrice(result.text) <= 0)))) {
      console.log(`[Scraper] #${trackerId} Kasta: original selector ${result.found ? 'found but parse failed' : 'not found'}, trying stable fallbacks...`);
      var kastaPrice = await page.evaluate(function() {
        // 1. .kcPrice span.t-bold — Kasta Visa Card price (preferred, lower price)
        var kcBold = document.querySelector('.kcPrice span.t-bold');
        if (kcBold) {
          var boldText = (kcBold.textContent || '').trim();
          if (boldText && /^\d/.test(boldText)) return { text: boldText, source: '.kcPrice span.t-bold' };
        }
        // 2. #productPrice — main regular price (stable ID)
        var productPrice = document.querySelector('#productPrice');
        if (productPrice) {
          var text = (productPrice.textContent || '').trim();
          if (text && /\d/.test(text)) return { text: text, source: '#productPrice' };
        }
        // 3. #productOldPrice — original price before discount
        var oldPrice = document.querySelector('#productOldPrice');
        if (oldPrice) {
          var oldText = (oldPrice.textContent || '').trim();
          if (oldText && /\d/.test(oldText)) return { text: oldText, source: '#productOldPrice (old price)' };
        }
        // 4. JSON-LD structured data — SalePrice from priceSpecification
        try {
          var scripts = document.querySelectorAll('script[type="application/ld+json"]');
          for (var s = 0; s < scripts.length; s++) {
            var data = JSON.parse(scripts[s].textContent);
            if (data && data['@type'] === 'Product' && data.offers) {
              var offers = data.offers;
              // Check priceSpecification for SalePrice
              if (offers.priceSpecification && Array.isArray(offers.priceSpecification)) {
                for (var ps = 0; ps < offers.priceSpecification.length; ps++) {
                  var spec = offers.priceSpecification[ps];
                  if (spec.priceType && spec.priceType.indexOf('SalePrice') !== -1 && spec.price) {
                    return { text: String(spec.price), source: 'JSON-LD SalePrice' };
                  }
                }
                // Fallback: first priceSpecification with a price
                for (var ps2 = 0; ps2 < offers.priceSpecification.length; ps2++) {
                  if (offers.priceSpecification[ps2].price) {
                    return { text: String(offers.priceSpecification[ps2].price), source: 'JSON-LD priceSpecification' };
                  }
                }
              }
              // Direct price on offers
              if (offers.price) return { text: String(offers.price), source: 'JSON-LD offers.price' };
            }
          }
        } catch (_) {}
        // 5. [itemprop="price"] — structured data meta tag
        var itemprop = document.querySelector('[itemprop="price"]');
        if (itemprop) {
          var content = itemprop.getAttribute('content');
          if (content && /\d/.test(content)) return { text: content, source: 'itemprop price' };
        }
        return null;
      });
      if (kastaPrice) {
        var price = parsePrice(kastaPrice.text);
        if (price !== null && price > 0) {
          var elapsed = Date.now() - pageStart;
          console.log(`[Scraper] #${trackerId} ✅ Price: ${price} (Kasta ${kastaPrice.source}, ${elapsed}ms) — ${shortName}`);
          return { success: true, price: price };
        }
        console.log(`[Scraper] #${trackerId} Kasta: found "${kastaPrice.text}" via ${kastaPrice.source} but parse failed`);
      } else {
        console.log(`[Scraper] #${trackerId} Kasta: no stable selectors found either`);
      }
    }

    // ─── Makeup.com.ua fallback: new React SPA layout (2025+) ───
    // Old selectors like .product-item__price don't exist in the new layout.
    // Try new selectors: Price__priceCurrent, meta[itemprop="price"]
    if (isMakeup && !result.found) {
      console.log(`[Scraper] #${trackerId} Makeup: original selector failed, trying new React SPA selectors...`);
      var makeupFallbackPrice = await page.evaluate(function() {
        // 1. span[class*="Price__priceCurrent"] — main displayed price
        var priceCurrent = document.querySelector('span[class*="Price__priceCurrent"]');
        if (priceCurrent) {
          var text = (priceCurrent.textContent || '').trim();
          if (text && /\d/.test(text)) return { text: text, source: 'Price__priceCurrent' };
        }
        // 2. meta[itemprop="price"] in the buy section
        var buySection = document.querySelector('div[class*="ProductBuySection"]');
        if (buySection) {
          var meta = buySection.querySelector('meta[itemprop="price"]');
          if (meta) {
            var content = meta.getAttribute('content');
            if (content && /\d/.test(content)) return { text: content, source: 'ProductBuySection meta' };
          }
        }
        // 3. First meta[itemprop="price"] on page
        var anyMeta = document.querySelector('meta[itemprop="price"]');
        if (anyMeta) {
          var c = anyMeta.getAttribute('content');
          if (c && /\d/.test(c)) return { text: c, source: 'itemprop price' };
        }
        return null;
      });
      if (makeupFallbackPrice) {
        var price = parsePrice(makeupFallbackPrice.text);
        if (price !== null && price > 0) {
          var elapsed = Date.now() - pageStart;
          console.log(`[Scraper] #${trackerId} ✅ Price: ${price} (Makeup ${makeupFallbackPrice.source}, ${elapsed}ms) — ${shortName}`);
          return { success: true, price: price };
        }
        console.log(`[Scraper] #${trackerId} Makeup: found "${makeupFallbackPrice.text}" via ${makeupFallbackPrice.source} but parse failed`);
      } else {
        console.log(`[Scraper] #${trackerId} Makeup: no new selectors found either`);
      }
    }

    // ─── Universal fallback: auto-detect price on page ─────────────────
    // If the CSS selector didn't find the price (site redesign, dynamic classes),
    // try auto-detecting the price from the page as last resort.
    // This is better than returning an error — at least we get the main price.
    if (!tracker.variantSelector) {
      var autoDetectedPrice = await autoDetectPriceOnPage(page);
      if (autoDetectedPrice !== null) {
        var elapsed = Date.now() - pageStart;
        console.log(`[Scraper] #${trackerId} ✅ Price: ${autoDetectedPrice} (auto-detect fallback, ${elapsed}ms) — ${shortName}`);
        return { success: true, price: autoDetectedPrice };
      }
    }

    var elapsed = Date.now() - pageStart;
    const errorMsg = result.found
      ? `Could not parse price from text: "${result.text}"`
      : `Element not found: ${tracker.cssSelector}`;
    console.log(`[Scraper] #${trackerId} ❌ Failed (${elapsed}ms): ${errorMsg} — ${shortName}`);

    return { success: false, error: errorMsg };
  } catch (err) {
    var elapsed = Date.now() - pageStart;
    console.error(`[Scraper] #${trackerId} ❌ Error (${elapsed}ms): ${err.message} — ${shortName}`);
    return { success: false, error: err.message };
  } finally {
    if (page) {
      try { await page.close(); } catch (_) {}
    }
  }
}

/**
 * Read price from a list of CSS selectors.
 * Returns the first successfully parsed price, or null.
 * @param {import('puppeteer-core').Page} page
 * @param {string[]} selectors
 * @returns {Promise<number|null>}
 */
async function readPriceFromSelectors(page, selectors) {
  const priceText = await page.evaluate(function(sels) {
    for (var i = 0; i < sels.length; i++) {
      try {
        var el = document.querySelector(sels[i]);
        if (el) {
          // Try content attribute first (meta itemprop="price" content="2930")
          var content = el.getAttribute('content');
          if (content && /\d/.test(content)) return content;
          var text = (el.textContent || '').trim();
          if (text && /\d/.test(text) && text.length < 80) return text;
        }
      } catch(e) {}
    }
    return null;
  }, selectors);

  if (priceText) {
    var price = parsePrice(priceText);
    if (price !== null && price > 0) return price;
  }
  return null;
}

/**
 * Try well-known price selectors and scan visible elements for prices.
 * Mirrors the extension's tryAutoDetectPrice logic.
 * @param {import('puppeteer-core').Page} page
 * @returns {Promise<number|null>}
 */
async function autoDetectPriceOnPage(page) {
  const priceText = await page.evaluate(() => {
    const PRICE_SELECTORS = [
      // Kasta.ua stable selectors — Kasta Card price first (lower, preferred)
      '.kcPrice span.t-bold',
      '#productPrice',
      // Makeup.ua new React SPA (2025+)
      'span[class*="Price__priceCurrent"]',
      'div[class*="ProductBuySection__price"] span[class*="Price__priceCurrent"]',
      // Makeup.ua legacy
      '.product-item__price .product-item__price-current',
      '.product-item__price',
      '.price-block__price',
      // EVA.ua specific
      '[data-testid="product-price"]', '[data-testid="price"]',
      // Notino.ua specific
      'span[data-testid="pd-price"]',
      '#pd-price',
      // Generic
      '[itemprop="price"]', '[data-price]',
      '.product-price__big', '.product__price', '.price-current',
      '.product-price', '.price__value', '.price-value',
      '.current-price', '.product__price-current',
    ];

    for (const sel of PRICE_SELECTORS) {
      try {
        const el = document.querySelector(sel);
        if (el) {
          const content = el.getAttribute('content');
          if (content && /\d/.test(content)) return content;
          const text = (el.textContent || '').trim();
          if (text && /\d/.test(text) && text.length < 60) return text;
        }
      } catch (_) {}
    }

    // Scan visible elements with currency symbols
    const CURRENCY_RE = /₴|грн|UAH|USD|\$|€|₽|руб|£|¥|₩|zł|kr/i;
    let bestText = null;
    let bestScore = -1;

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    let node;
    while ((node = walker.nextNode())) {
      const tag = node.tagName;
      if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG'].includes(tag)) continue;

      // Skip BNPL/installment price elements (Kasta "рассрочка" blocks)
      // These contain per-payment amounts (e.g. "46 ₴ / 2 weeks") not product prices
      const isInsideBnpl = node.closest && (
        node.closest('.BnplPayment') ||
        node.closest('[id^="bnplPayment"]') ||
        node.closest('[id^="bnplBtn"]') ||
        node.closest('.p__bnpl') ||
        node.closest('[class*="bnpl"]')
      );
      if (isInsideBnpl) continue;

      let ownText = '';
      for (const child of node.childNodes) {
        if (child.nodeType === 3) ownText += child.textContent;
      }
      const fullText = (node.textContent || '').trim();
      let textToCheck = ownText.trim();
      if (!textToCheck && fullText.length <= 30) textToCheck = fullText;
      if (!textToCheck || textToCheck.length > 60) continue;
      if (!CURRENCY_RE.test(textToCheck) && !CURRENCY_RE.test(fullText)) continue;

      const rect = node.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;

      let score = 0;
      const cls = (typeof node.className === 'string') ? node.className.toLowerCase() : '';
      if (/price|цена|ціна/.test(cls)) score += 15;
      if (node.getAttribute('itemprop') === 'price') score += 20;
      if (rect.top < 600) score += 8;
      else if (rect.top < 1000) score += 4;
      try {
        const fontSize = parseFloat(window.getComputedStyle(node).fontSize);
        if (fontSize >= 24) score += 12;
        else if (fontSize >= 18) score += 8;
        else if (fontSize >= 14) score += 3;
      } catch (_) {}
      score += Math.max(0, 20 - textToCheck.length);
      try {
        const td = window.getComputedStyle(node).textDecorationLine || '';
        if (/line-through/.test(td)) score -= 20;
      } catch (_) {}

      if (score > bestScore) {
        bestScore = score;
        bestText = CURRENCY_RE.test(textToCheck) ? textToCheck : fullText;
      }
    }

    return bestText;
  });

  if (priceText) {
    const price = parsePrice(priceText);
    if (price !== null && price > 0) return price;
  }
  return null;
}

/**
 * Try fallback selectors by stripping translation tags and shortening the path.
 * @param {import('puppeteer-core').Page} page
 * @param {string} originalSelector
 * @returns {Promise<number|null>}
 */
async function tryFallbackSelectors(page, originalSelector) {
  const parts = originalSelector.split(/\s*>\s*/);
  const translationTags = /^(font|i|b)(:nth-child\(\d+\))?$/i;

  const fallbacks = [];

  // For notino.ua selectors starting with #pd-price, try the base ID first
  if (parts[0] && parts[0].trim() === '#pd-price' && parts.length > 1) {
    fallbacks.push('#pd-price');
  }

  const cleaned = parts.filter(p => !translationTags.test(p.trim()));
  if (cleaned.length > 0 && cleaned.length < parts.length) {
    fallbacks.push(cleaned.join(' > '));
  }
  for (let i = parts.length - 1; i >= 1; i--) {
    const shorter = parts.slice(0, i).join(' > ');
    if (!fallbacks.includes(shorter)) fallbacks.push(shorter);
  }

  for (const sel of fallbacks) {
    try {
      const text = await page.evaluate((s) => {
        const el = document.querySelector(s);
        return el ? (el.textContent || '').trim() : null;
      }, sel);

      if (text) {
        const price = parsePrice(text);
        if (price !== null && price > 0) return price;
      }
    } catch (_) {}
  }

  return null;
}

module.exports = { getBrowser, closeBrowser, extractPrice, readPriceFromSelectors, isWafBlocked, randomUA };
