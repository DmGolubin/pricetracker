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
const VARIANT_SETTLE_MS = 2000;

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
      '--single-process',
      '--disable-web-security',
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
async function extractPrice(tracker) {
  const browser = await getBrowser();
  let page;
  const pageStart = Date.now();
  const trackerId = tracker.id;
  const shortName = (tracker.productName || '').substring(0, 50);

  try {
    page = await browser.newPage();

    // Block images, fonts, media to speed up loading
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const type = req.resourceType();
      if (['image', 'font', 'media', 'stylesheet'].includes(type)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    // Set a realistic user agent
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    );

    // Set viewport
    await page.setViewport({ width: 1366, height: 768 });

    // Navigate to the page
    console.log(`[Scraper] #${trackerId} Loading: ${tracker.pageUrl}`);
    const navStart = Date.now();
    await page.goto(tracker.pageUrl, {
      waitUntil: 'networkidle2',
      timeout: PAGE_TIMEOUT_MS,
    });
    console.log(`[Scraper] #${trackerId} Page loaded in ${Date.now() - navStart}ms`);

    // If tracker has a variant selector, click it and wait for price to update
    if (tracker.variantSelector) {
      try {
        console.log('[Scraper] #' + trackerId + ' Clicking variant: ' + tracker.variantSelector);
        await page.waitForSelector(tracker.variantSelector, { timeout: 5000 });

        // Capture the current price text BEFORE clicking the variant
        // so we can detect when it changes after the click
        var priceBeforeClick = await page.evaluate(function() {
          // Try common price selectors to get current displayed price
          var selectors = [
            '[data-testid="product-price"]',
            '[itemprop="price"]',
            '.product-price__big',
            '.product__price',
            '.price-current',
            '.product-price',
          ];
          for (var i = 0; i < selectors.length; i++) {
            try {
              var el = document.querySelector(selectors[i]);
              if (el) return (el.textContent || '').trim();
            } catch(e) {}
          }
          return null;
        });

        console.log('[Scraper] #' + trackerId + ' Price before variant click: ' + (priceBeforeClick || 'unknown'));

        // Click the variant
        await page.click(tracker.variantSelector);

        // Wait for DOM to settle using a smart approach:
        // 1. First wait for any network activity to finish
        // 2. Then wait for the price element to change (or timeout)
        await page.waitForNetworkIdle({ timeout: 3000 }).catch(function() {});

        // Wait for price to change on the page (up to 4 seconds)
        if (priceBeforeClick) {
          try {
            await page.waitForFunction(
              function(oldPrice) {
                var selectors = [
                  '[data-testid="product-price"]',
                  '[itemprop="price"]',
                  '.product-price__big',
                  '.product__price',
                  '.price-current',
                  '.product-price',
                ];
                for (var i = 0; i < selectors.length; i++) {
                  try {
                    var el = document.querySelector(selectors[i]);
                    if (el) {
                      var current = (el.textContent || '').trim();
                      if (current && current !== oldPrice) return true;
                    }
                  } catch(e) {}
                }
                return false;
              },
              { timeout: 4000 },
              priceBeforeClick
            );
            console.log('[Scraper] #' + trackerId + ' Price changed after variant click.');
          } catch (waitErr) {
            // Price didn't change — might be same price for this variant, or click didn't work
            console.log('[Scraper] #' + trackerId + ' Price did not change after variant click (may be same price or click failed).');
          }
        } else {
          // No price detected before click — just wait a fixed time
          await new Promise(function(r) { setTimeout(r, 2000); });
        }

        // Additional settle time for any animations/transitions
        await new Promise(function(r) { setTimeout(r, 500); });

        // Log the price after variant click
        var priceAfterClick = await page.evaluate(function() {
          var selectors = [
            '[data-testid="product-price"]',
            '[itemprop="price"]',
            '.product-price__big',
            '.product__price',
            '.price-current',
            '.product-price',
          ];
          for (var i = 0; i < selectors.length; i++) {
            try {
              var el = document.querySelector(selectors[i]);
              if (el) return (el.textContent || '').trim();
            } catch(e) {}
          }
          return null;
        });
        console.log('[Scraper] #' + trackerId + ' Price after variant click: ' + (priceAfterClick || 'unknown'));

      } catch (variantErr) {
        console.warn('[Scraper] #' + trackerId + ' ⚠ Variant click failed: ' + variantErr.message);
      }
    }

    // Wait a bit for any remaining JS rendering
    await new Promise(r => setTimeout(r, 1500));

    // Try to extract price using the CSS selector
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
        const elapsed = Date.now() - pageStart;
        console.log(`[Scraper] #${trackerId} ✅ Price: ${price} (from selector, ${elapsed}ms) — ${shortName}`);
        return { success: true, price };
      }
      console.log(`[Scraper] #${trackerId} Selector found but parse failed: "${result.text.substring(0, 80)}"`);
    } else {
      console.log(`[Scraper] #${trackerId} Selector not found: ${tracker.cssSelector}`);
    }

    // Fallback: try auto-detecting price on the page
    console.log(`[Scraper] #${trackerId} Trying auto-detect fallback...`);
    const fallbackPrice = await autoDetectPriceOnPage(page);
    if (fallbackPrice !== null) {
      const elapsed = Date.now() - pageStart;
      console.log(`[Scraper] #${trackerId} ✅ Price: ${fallbackPrice} (auto-detect, ${elapsed}ms) — ${shortName}`);
      return { success: true, price: fallbackPrice };
    }

    // CSS selector element not found — try fallback selectors
    if (!result.found) {
      console.log(`[Scraper] #${trackerId} Trying fallback selectors...`);
      const fallbackResult = await tryFallbackSelectors(page, tracker.cssSelector);
      if (fallbackResult !== null) {
        const elapsed = Date.now() - pageStart;
        console.log(`[Scraper] #${trackerId} ✅ Price: ${fallbackResult} (fallback selector, ${elapsed}ms) — ${shortName}`);
        return { success: true, price: fallbackResult };
      }
    }

    const elapsed = Date.now() - pageStart;
    const errorMsg = result.found
      ? `Could not parse price from text: "${result.text}"`
      : `Element not found: ${tracker.cssSelector}`;
    console.log(`[Scraper] #${trackerId} ❌ Failed (${elapsed}ms): ${errorMsg} — ${shortName}`);

    return { success: false, error: errorMsg };
  } catch (err) {
    const elapsed = Date.now() - pageStart;
    console.error(`[Scraper] #${trackerId} ❌ Error (${elapsed}ms): ${err.message} — ${shortName}`);
    return { success: false, error: err.message };
  } finally {
    if (page) {
      try { await page.close(); } catch (_) {}
    }
  }
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
      // Makeup.ua specific
      '.product-item__price .product-item__price-current',
      '.product-item__price',
      '.price-block__price',
      // EVA.ua specific
      '[data-testid="product-price"]', '[data-testid="price"]',
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

module.exports = { getBrowser, closeBrowser, extractPrice };
