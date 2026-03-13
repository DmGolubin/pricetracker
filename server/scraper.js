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
    // For EVA with hash URLs and variant selector: strip the hash to avoid
    // SPA navigation issues during initial load. We'll click the variant later.
    var navigateUrl = tracker.pageUrl;
    if (isEvaPage && tracker.variantSelector && (navigateUrl || '').indexOf('#') !== -1) {
      navigateUrl = navigateUrl.split('#')[0];
      console.log(`[Scraper] #${trackerId} EVA: stripped hash, loading base URL: ${navigateUrl}`);
    }
    console.log(`[Scraper] #${trackerId} Loading: ${navigateUrl}`);
    const navStart = Date.now();
    await page.goto(navigateUrl, {
      waitUntil: 'networkidle2',
      timeout: PAGE_TIMEOUT_MS,
    });
    console.log(`[Scraper] #${trackerId} Page loaded in ${Date.now() - navStart}ms`);

    // Determine site-specific price selectors for this URL
    const isMakeup = (tracker.pageUrl || '').indexOf('makeup.com.ua') !== -1;
    const isEva = (tracker.pageUrl || '').indexOf('eva.ua') !== -1;
    const isNotino = (tracker.pageUrl || '').indexOf('notino.ua') !== -1;

    // ─── EVA.UA variant: click variant button found by title pattern ──────────
    // EVA is a Vue/Nuxt SPA. The variant buttons have title="VOLUME (PRODUCT_ID)".
    // Hash navigation doesn't work (EVA ignores the hash on initial load).
    // But clicking the button DOES work — we just need to find it by title.
    // Strategy: extract volume from productName, find button by title, click it,
    // wait for price to update.
    if (isEva && tracker.variantSelector) {
      // Extract desired volume from productName (e.g., "— 100" or "— 30")
      var volumeMatch = (tracker.productName || '').match(/—\s*(\d+)/);
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

        if (matched.selected && evaVariantResult.currentPrice) {
          // Variant is already selected (default variant) — just read the price
          var price = parsePrice(evaVariantResult.currentPrice);
          if (price !== null && price > 0) {
            var elapsed = Date.now() - pageStart;
            console.log('[Scraper] #' + trackerId + ' ✅ Price: ' + price + ' (EVA default variant, ' + elapsed + 'ms) — ' + shortName);
            return { success: true, price: price };
          }
        }

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
          await new Promise(function(r) { setTimeout(r, 4000); });

          // Try to read the price — may need multiple attempts if frame was detached
          var evaPrice = null;
          for (var readAttempt = 0; readAttempt < 3; readAttempt++) {
            try {
              await page.waitForSelector('[data-testid="product-price"]', { timeout: 10000 });
              evaPrice = await page.evaluate(function() {
                var el = document.querySelector('[data-testid="product-price"]');
                return el ? (el.textContent || '').trim() : null;
              });
              if (evaPrice) break;
            } catch (readErr) {
              console.log('[Scraper] #' + trackerId + ' EVA: read attempt ' + (readAttempt + 1) + ' failed: ' + readErr.message);
              await new Promise(function(r) { setTimeout(r, 3000); });
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
        } catch (clickErr) {
          console.log('[Scraper] #' + trackerId + ' EVA: click failed: ' + clickErr.message);
        }
      } else {
        console.log('[Scraper] #' + trackerId + ' EVA: no matching variant button found. Buttons:', JSON.stringify((evaVariantResult || {}).allButtons));
      }
    }

    // Notino is a React SPA — wait for the price element to render
    // Try multiple selectors: the main pd-price, or the price wrapper with content attr
    if (isNotino) {
      var pdPriceFound = false;
      var notinoSelectors = [
        '#pd-price span[data-testid="pd-price"]',
        'span[data-testid="pd-price"]',
        'div[data-testid="pd-price-wrapper"] span[content]',
        'span[data-testid="pd-price-wrapper"] span[content]',
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
              
              // Last resort: read the main displayed price (itemprop="price")
              var mainPrice = document.querySelector('span[itemprop="price"]');
              if (mainPrice) {
                return { found: true, price: mainPrice.textContent.trim(), method: 'main-itemprop-price' };
              }
              
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
      var notinoPrice = null;
      for (var notinoAttempt = 0; notinoAttempt < 2; notinoAttempt++) {
        try {
          notinoPrice = await page.evaluate(function() {
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
