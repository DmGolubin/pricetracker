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
 * Makeup.com.ua-specific price selectors — these are the elements
 * where the main product price is displayed. After a variant click,
 * the price in these elements updates dynamically.
 */
const MAKEUP_PRICE_SELECTORS = [
  '.product-item__price .product-item__price-current',
  '.product-item__price',
  '.price-block__price',
];

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
async function extractPrice(tracker) {
  const browser = await getBrowser();
  let page;
  const pageStart = Date.now();
  const trackerId = tracker.id;
  const shortName = (tracker.productName || '').substring(0, 50);

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

    // Set a realistic user agent
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    );

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
    console.log(`[Scraper] #${trackerId} Loading: ${tracker.pageUrl}`);
    const navStart = Date.now();
    await page.goto(tracker.pageUrl, {
      waitUntil: 'networkidle2',
      timeout: PAGE_TIMEOUT_MS,
    });
    console.log(`[Scraper] #${trackerId} Page loaded in ${Date.now() - navStart}ms`);

    // Determine site-specific price selectors for this URL
    const isMakeup = (tracker.pageUrl || '').indexOf('makeup.com.ua') !== -1;
    const isEva = (tracker.pageUrl || '').indexOf('eva.ua') !== -1;
    const isNotino = (tracker.pageUrl || '').indexOf('notino.ua') !== -1;

    // EVA.UA with hash variant: after page load, trigger hash navigation via JS
    // EVA React SPA processes hash routes client-side after hydration
    if (isEva && (tracker.pageUrl || '').indexOf('#') !== -1 && tracker.variantSelector) {
      var hashPart = (tracker.pageUrl || '').split('#')[1] || '';
      if (hashPart) {
        console.log('[Scraper] #' + trackerId + ' EVA: triggering hash navigation to #' + hashPart);
        // Set hash and dispatch hashchange event to trigger React router
        await page.evaluate(function(hash) {
          window.location.hash = hash;
          window.dispatchEvent(new HashChangeEvent('hashchange'));
        }, hashPart);
        // Wait for React to process the hash change
        await new Promise(function(r) { setTimeout(r, 5000); });
        // Wait for price element
        try {
          await page.waitForSelector('[data-testid="product-price"]', { timeout: 10000 });
        } catch (_) {}
        await new Promise(function(r) { setTimeout(r, 2000); });
        
        // Read price after hash navigation
        var hashPrice = await page.evaluate(function() {
          var el = document.querySelector('[data-testid="product-price"]');
          return el ? (el.textContent || '').trim() : null;
        });
        console.log('[Scraper] #' + trackerId + ' EVA: price after hash navigation: ' + (hashPrice || 'none'));
      }
    }

    // Notino is a React SPA — wait for the price element to render
    if (isNotino) {
      var pdPriceFound = false;
      try {
        await page.waitForSelector('#pd-price span[data-testid="pd-price"]', { timeout: 15000 });
        pdPriceFound = true;
        console.log(`[Scraper] #${trackerId} Notino: #pd-price found`);
      } catch (_) {
        console.log(`[Scraper] #${trackerId} Notino: #pd-price not found after 15s, retrying after extra wait...`);
        await new Promise(r => setTimeout(r, 5000));
        var retryEl = await page.$('#pd-price');
        if (retryEl) {
          pdPriceFound = true;
          console.log(`[Scraper] #${trackerId} Notino: #pd-price found on retry`);
        } else {
          console.log(`[Scraper] #${trackerId} Notino: #pd-price still not found after retry`);
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
    // eva.ua requires clicking the variant button and reading the updated price.
    var variantClicked = false;
    if (tracker.variantSelector) {
      // MAKEUP.COM.UA: read data-price attribute directly from the variant element
      if (isMakeup) {
        var dataPrice = await page.evaluate(function(sel) {
          var el = document.querySelector(sel);
          // Fallback: if CSS-escaped data-variant-id selector fails, try extracting the ID
          if (!el && sel.indexOf('data-variant-id') !== -1) {
            var idMatch = sel.match(/data-variant-id[*~|^$]?=["']?\\?3?2?\s*(\d+)/);
            if (idMatch) {
              el = document.querySelector('[data-variant-id="' + idMatch[1] + '"]');
            }
          }
          // Fallback: if selector like [data-loyalty-text=""] matches wrong element, use .variant.checked
          if (!el || (!el.getAttribute('data-price') && !el.closest('[data-price]'))) {
            var checked = document.querySelector('.variant.checked[data-price]');
            if (checked) el = checked;
          }
          if (!el) return null;
          // The variant element itself or a parent may have data-price
          var dp = el.getAttribute('data-price');
          if (dp) return dp;
          // Walk up to find data-price on a parent (variant div wraps the clickable element)
          var parent = el.closest('[data-price]');
          if (parent) return parent.getAttribute('data-price');
          // Also check if the selector targets a child inside the variant div
          var variantDiv = el.closest('.variant');
          if (variantDiv && variantDiv.getAttribute('data-price')) return variantDiv.getAttribute('data-price');
          return null;
        }, tracker.variantSelector);

        if (dataPrice) {
          var price = parsePrice(dataPrice);
          if (price !== null && price > 0) {
            var elapsed = Date.now() - pageStart;
            console.log('[Scraper] #' + trackerId + ' ✅ Price: ' + price + ' (data-price attr, ' + elapsed + 'ms) — ' + shortName);
            return { success: true, price: price };
          }
          console.log('[Scraper] #' + trackerId + ' data-price found but parse failed: "' + dataPrice + '"');
        } else {
          console.log('[Scraper] #' + trackerId + ' No data-price attr on variant element, falling back to click...');
        }

        // Fallback: try reading meta itemprop="price" content inside the variant
        var metaPrice = await page.evaluate(function(sel) {
          var el = document.querySelector(sel);
          if (!el) return null;
          var variantDiv = el.closest('[data-variant-id]') || el.closest('.variant');
          if (!variantDiv) return null;
          var meta = variantDiv.querySelector('meta[itemprop="price"]');
          return meta ? meta.getAttribute('content') : null;
        }, tracker.variantSelector);

        if (metaPrice) {
          var price = parsePrice(metaPrice);
          if (price !== null && price > 0) {
            var elapsed = Date.now() - pageStart;
            console.log('[Scraper] #' + trackerId + ' ✅ Price: ' + price + ' (meta itemprop, ' + elapsed + 'ms) — ' + shortName);
            return { success: true, price: price };
          }
        }
      }

      // EVA.UA and others: click the variant and read the updated price
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

        // EVA.UA: React SPA — variant click causes full component re-render.
        // If hash navigation already set the correct variant, skip clicking.
        if (isEva) {
          // Check if hash navigation already loaded the correct variant
          var evaCurrentPrice = await page.evaluate(function() {
            var el = document.querySelector('[data-testid="product-price"]');
            return el ? (el.textContent || '').trim() : null;
          });
          
          if (evaCurrentPrice && evaCurrentPrice !== priceBeforeClick) {
            // Hash navigation worked — price changed from default
            console.log('[Scraper] #' + trackerId + ' EVA: hash navigation set variant price: ' + evaCurrentPrice);
            variantClicked = true;
          } else {
            // Hash navigation didn't work or no hash — try clicking
            console.log('[Scraper] #' + trackerId + ' EVA: clicking variant button...');
            
            var btnText = await page.evaluate(function(sel) {
              var btn = document.querySelector(sel);
              return btn ? (btn.textContent || '').trim() : 'not found';
            }, tracker.variantSelector);
            console.log('[Scraper] #' + trackerId + ' EVA: variant button text: "' + btnText + '"');

            // Try clicking with Promise.all to catch any navigation
            try {
              await Promise.all([
                page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 10000 }).catch(function() {}),
                page.click(tracker.variantSelector),
              ]);
            } catch (_) {}
            variantClicked = true;

            // Wait for React to re-render
            await new Promise(function(r) { setTimeout(r, 5000); });

            // Check if price element exists now
            var priceAfterEva = await page.evaluate(function() {
              var el = document.querySelector('[data-testid="product-price"]');
              return el ? (el.textContent || '').trim() : null;
            });
            console.log('[Scraper] #' + trackerId + ' EVA: price after click: ' + (priceAfterEva || 'none'));

            if (!priceAfterEva) {
              console.log('[Scraper] #' + trackerId + ' EVA: price gone, waiting for reappear...');
              try {
                await page.waitForSelector('[data-testid="product-price"]', { timeout: 15000 });
              } catch (_) {}
              await new Promise(function(r) { setTimeout(r, 2000); });
            }
          }
        } else {
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
      console.log('[Scraper] #' + trackerId + ' Site-specific selectors failed after variant click, trying auto-detect...');

      var autoPrice = await autoDetectPriceOnPage(page);
      if (autoPrice !== null) {
        var elapsed = Date.now() - pageStart;
        console.log('[Scraper] #' + trackerId + ' ✅ Price: ' + autoPrice + ' (auto-detect after variant, ' + elapsed + 'ms) — ' + shortName);
        return { success: true, price: autoPrice };
      }

      var elapsed = Date.now() - pageStart;
      console.log('[Scraper] #' + trackerId + ' ❌ Failed (variant, ' + elapsed + 'ms): Could not read price after variant click — ' + shortName);
      return { success: false, error: 'Could not read price after variant click for: ' + tracker.variantSelector };
    }

    // ─── Non-variant trackers: try the CSS selector directly ─────────

    // Notino special: read price from content attribute of span[data-testid="pd-price"]
    // This is more reliable than textContent because font tags may not render in headless
    if (isNotino) {
      var notinoPrice = await page.evaluate(function() {
        // Try content attribute first (most reliable)
        var span = document.querySelector('span[data-testid="pd-price"]');
        if (span) {
          var content = span.getAttribute('content');
          if (content && /\d/.test(content)) return content;
          var text = (span.textContent || '').trim();
          if (text && /\d/.test(text)) return text;
        }
        // Fallback: #pd-price textContent
        var pdPrice = document.querySelector('#pd-price');
        if (pdPrice) {
          var text = (pdPrice.textContent || '').trim();
          if (text && /\d/.test(text)) return text;
        }
        // Fallback: selected variant tile price (multi-variant pages)
        var selectedVariant = document.querySelector('a.pd-variant-selected span[data-testid="price-variant"]');
        if (selectedVariant) {
          var content = selectedVariant.getAttribute('content');
          if (content && /\d/.test(content)) return content;
          var text = (selectedVariant.textContent || '').trim();
          if (text && /\d/.test(text)) return text;
        }
        // Last resort: first variant tile price
        var anyVariant = document.querySelector('span[data-testid="price-variant"]');
        if (anyVariant) {
          var content = anyVariant.getAttribute('content');
          if (content && /\d/.test(content)) return content;
        }
        return null;
      });
      if (notinoPrice) {
        var price = parsePrice(notinoPrice);
        if (price !== null && price > 0) {
          var elapsed = Date.now() - pageStart;
          console.log('[Scraper] #' + trackerId + ' ✅ Price: ' + price + ' (notino content attr, ' + elapsed + 'ms) — ' + shortName);
          return { success: true, price: price };
        }
        console.log('[Scraper] #' + trackerId + ' Notino: found text "' + notinoPrice + '" but parse failed');
      } else {
        console.log('[Scraper] #' + trackerId + ' Notino: no price element found at all');
      }
    }

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
        var elapsed = Date.now() - pageStart;
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
      var elapsed = Date.now() - pageStart;
      console.log(`[Scraper] #${trackerId} ✅ Price: ${fallbackPrice} (auto-detect, ${elapsed}ms) — ${shortName}`);
      return { success: true, price: fallbackPrice };
    }

    // CSS selector element not found — try fallback selectors
    if (!result.found) {
      console.log(`[Scraper] #${trackerId} Trying fallback selectors...`);
      const fallbackResult = await tryFallbackSelectors(page, tracker.cssSelector);
      if (fallbackResult !== null) {
        var elapsed = Date.now() - pageStart;
        console.log(`[Scraper] #${trackerId} ✅ Price: ${fallbackResult} (fallback selector, ${elapsed}ms) — ${shortName}`);
        return { success: true, price: fallbackResult };
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
      // Makeup.ua specific (most reliable for this site)
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

module.exports = { getBrowser, closeBrowser, extractPrice, readPriceFromSelectors };
