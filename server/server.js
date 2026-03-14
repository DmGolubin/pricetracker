const express = require('express');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');
const autoGrouper = require('./autoGrouper.js');
const scheduler = require('./scheduler.js');
const TelegramBot = require('./telegramBot.js');

const app = express();
const PORT = process.env.PORT || 3000;

// PostgreSQL connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ─── Request logging middleware ─────────────────────────────────────
app.use((req, res, next) => {
  const start = Date.now();
  const { method, url } = req;

  // Log request body for mutations
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    console.log(`→ ${method} ${url}`, JSON.stringify(req.body).slice(0, 500));
  }

  res.on('finish', () => {
    const duration = Date.now() - start;
    const status = res.statusCode;
    const level = status >= 500 ? 'ERROR' : status >= 400 ? 'WARN' : 'INFO';
    console.log(`[${level}] ${method} ${url} → ${status} (${duration}ms)`);
  });

  next();
});

// ─── Initialize DB tables ───────────────────────────────────────────
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS trackers (
      id SERIAL PRIMARY KEY,
      "pageUrl" TEXT NOT NULL,
      "cssSelector" TEXT NOT NULL,
      "productName" TEXT DEFAULT '',
      "imageUrl" TEXT DEFAULT '',
      "initialPrice" NUMERIC DEFAULT 0,
      "currentPrice" NUMERIC DEFAULT 0,
      "minPrice" NUMERIC DEFAULT 0,
      "maxPrice" NUMERIC DEFAULT 0,
      "previousPrice" NUMERIC DEFAULT 0,
      "checkIntervalHours" NUMERIC DEFAULT 3,
      "trackingType" TEXT DEFAULT 'price',
      "isAutoDetected" BOOLEAN DEFAULT false,
      status TEXT DEFAULT 'active',
      unread BOOLEAN DEFAULT false,
      "errorMessage" TEXT DEFAULT '',
      "checkMode" TEXT DEFAULT 'auto',
      "notificationFilter" JSONB DEFAULT '{"type":"none","value":""}',
      "initialContent" TEXT DEFAULT '',
      "currentContent" TEXT DEFAULT '',
      "previousContent" TEXT DEFAULT '',
      "excludedSelectors" JSONB DEFAULT '[]',
      "notificationsEnabled" BOOLEAN DEFAULT true,
      "productGroup" TEXT DEFAULT '',
      "createdAt" TIMESTAMP DEFAULT NOW(),
      "updatedAt" TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS price_history (
      id SERIAL PRIMARY KEY,
      "trackerId" INTEGER REFERENCES trackers(id) ON DELETE CASCADE,
      price NUMERIC,
      "contentValue" TEXT DEFAULT '',
      "previousContent" TEXT DEFAULT '',
      "screenshotUrl" TEXT DEFAULT '',
      "checkedAt" TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS settings (
      id TEXT PRIMARY KEY DEFAULT 'global',
      "apiBaseUrl" TEXT DEFAULT '',
      "notificationsEnabled" BOOLEAN DEFAULT true,
      "telegramBotToken" TEXT DEFAULT '',
      "telegramChatId" TEXT DEFAULT '',
      "persistentPinTab" BOOLEAN DEFAULT false
    );

    INSERT INTO settings (id) VALUES ('global') ON CONFLICT (id) DO NOTHING;
  `);

  // Migration: add variantSelector column if missing
  await pool.query(`
    ALTER TABLE trackers ADD COLUMN IF NOT EXISTS "variantSelector" TEXT DEFAULT '';
  `);

  // Migration: add notificationsEnabled column if missing
  await pool.query(`
    ALTER TABLE trackers ADD COLUMN IF NOT EXISTS "notificationsEnabled" BOOLEAN DEFAULT true;
  `);

  // Migration: add productGroup column if missing
  await pool.query(`
    ALTER TABLE trackers ADD COLUMN IF NOT EXISTS "productGroup" TEXT DEFAULT '';
  `);

  // Migration: add screenshotUrl column to price_history if missing
  await pool.query(`
    ALTER TABLE price_history ADD COLUMN IF NOT EXISTS "screenshotUrl" TEXT DEFAULT '';
  `);

  // Migration: change checkIntervalHours from INTEGER to NUMERIC for sub-hour intervals
  await pool.query(`
    ALTER TABLE trackers ALTER COLUMN "checkIntervalHours" TYPE NUMERIC USING "checkIntervalHours"::NUMERIC;
  `);

  // Migration: add variantPriceVerified flag for variant trackers
  await pool.query(`
    ALTER TABLE trackers ADD COLUMN IF NOT EXISTS "variantPriceVerified" BOOLEAN DEFAULT false;
  `);

  // Mark existing variant trackers that have already been checked as verified
  await pool.query(`
    UPDATE trackers SET "variantPriceVerified" = true
    WHERE "variantSelector" != '' AND "variantSelector" IS NOT NULL AND "variantPriceVerified" = false
    AND "updatedAt" > "createdAt" + INTERVAL '1 minute';
  `);

  // Migration: add variantPriceVerified flag for variant trackers
  await pool.query(`
    ALTER TABLE trackers ADD COLUMN IF NOT EXISTS "variantPriceVerified" BOOLEAN DEFAULT false;
  `);

  // Migration: add thresholdConfig JSONB to settings for smart notification thresholds
  await pool.query(`
    ALTER TABLE settings ADD COLUMN IF NOT EXISTS "thresholdConfig" JSONB DEFAULT '{"mode":"adaptive","absoluteValue":50,"percentageValue":5,"adaptiveTiers":[{"min":0,"max":1000,"percent":8},{"min":1001,"max":5000,"percent":5},{"min":5001,"max":20000,"percent":4},{"min":20001,"max":50000,"percent":3},{"min":50001,"max":999999999,"percent":2}]}';
  `);

  // Migration: add telegramDigestEnabled to settings for digest mode toggle
  await pool.query(`
    ALTER TABLE settings ADD COLUMN IF NOT EXISTS "telegramDigestEnabled" BOOLEAN DEFAULT true;
  `);

  // Migration: add telegramPersonalChatId for bot DM notifications (separate from group chat)
  await pool.query(`
    ALTER TABLE settings ADD COLUMN IF NOT EXISTS "telegramPersonalChatId" TEXT DEFAULT '';
  `);

  // Migration: add per-tracker notification threshold override
  await pool.query(`
    ALTER TABLE trackers ADD COLUMN IF NOT EXISTS "notificationThreshold" JSONB DEFAULT NULL;
  `);

  // Migration: add lastCheckedAt for sorting by last check date
  await pool.query(`
    ALTER TABLE trackers ADD COLUMN IF NOT EXISTS "lastCheckedAt" TIMESTAMP DEFAULT NULL;
  `);

  // Migration: deduplicate trackers by pageUrl+cssSelector (keep oldest with most history)
  await pool.query(`
    DELETE FROM trackers
    WHERE id NOT IN (
      SELECT DISTINCT ON ("pageUrl", "cssSelector") id
      FROM trackers
      ORDER BY "pageUrl", "cssSelector", "createdAt" ASC
    );
  `);

  // Migration: add unique index to prevent future duplicates
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_trackers_url_selector
    ON trackers ("pageUrl", "cssSelector");
  `);

  console.log('Database tables initialized');
}

// ─── Trackers ───────────────────────────────────────────────────────

app.get('/trackers', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM trackers ORDER BY id DESC');
    res.json(rows);
  } catch (err) {
    console.error('GET /trackers error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/trackers/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM trackers WHERE id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Tracker not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error(`GET /trackers/${req.params.id} error:`, err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/trackers', async (req, res) => {
  try {
    const d = req.body;
    // Check for existing tracker with same URL + selector
    const existing = await pool.query(
      'SELECT * FROM trackers WHERE "pageUrl" = $1 AND "cssSelector" = $2',
      [d.pageUrl, d.cssSelector]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Tracker already exists', tracker: existing.rows[0] });
    }
    const { rows } = await pool.query(
      `INSERT INTO trackers (
        "pageUrl", "cssSelector", "productName", "imageUrl",
        "initialPrice", "currentPrice", "minPrice", "maxPrice",
        "checkIntervalHours", "trackingType", "isAutoDetected",
        "initialContent", "currentContent", "excludedSelectors",
        "checkMode", "productGroup", "variantSelector"
      ) VALUES ($1,$2,$3,$4,$5,$5,$5,$5,$6,$7,$8,$9,$9,$10,$11,$12,$13) RETURNING *`,
      [
        d.pageUrl, d.cssSelector, d.productName || '', d.imageUrl || '',
        d.initialPrice || 0, d.checkIntervalHours || 3,
        d.trackingType || 'price', d.isAutoDetected || false,
        d.initialContent || '', JSON.stringify(d.excludedSelectors || []),
        d.checkMode || 'auto', d.productGroup || '', d.variantSelector || '',
      ]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('POST /trackers error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.put('/trackers/:id', async (req, res) => {
  try {
    const d = req.body;
    // Build dynamic SET clause from provided fields
    const fields = [];
    const values = [];
    let idx = 1;

    const allowed = [
      'pageUrl', 'cssSelector', 'productName', 'imageUrl',
      'initialPrice', 'currentPrice', 'minPrice', 'maxPrice', 'previousPrice',
      'checkIntervalHours', 'trackingType', 'status', 'unread',
      'errorMessage', 'checkMode', 'notificationFilter',
      'initialContent', 'currentContent', 'previousContent', 'excludedSelectors',
      'notificationsEnabled',
      'productGroup',
      'variantSelector',
      'variantPriceVerified',
      'notificationThreshold',
      'lastCheckedAt',
    ];

    for (const key of allowed) {
      if (d[key] !== undefined) {
        const val = (key === 'notificationFilter' || key === 'excludedSelectors' || key === 'notificationThreshold')
          ? JSON.stringify(d[key]) : d[key];
        fields.push(`"${key}" = $${idx}`);
        values.push(val);
        idx++;
      }
    }

    if (fields.length === 0) {
      const { rows } = await pool.query('SELECT * FROM trackers WHERE id = $1', [req.params.id]);
      return res.json(rows[0]);
    }

    fields.push(`"updatedAt" = NOW()`);
    values.push(req.params.id);

    const { rows } = await pool.query(
      `UPDATE trackers SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Tracker not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error(`PUT /trackers/${req.params.id} error:`, err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/trackers/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM trackers WHERE id = $1', [req.params.id]);
    res.status(204).end();
  } catch (err) {
    console.error(`DELETE /trackers/${req.params.id} error:`, err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/trackers/auto-group', async (req, res) => {
  try {
    const result = await autoGrouper.autoGroupAll(pool);
    res.json({ grouped: result.grouped, total: result.total, newGroups: result.newGroups || 0 });
  } catch (err) {
    console.error('POST /trackers/auto-group error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Price History ──────────────────────────────────────────────────

// Clear all price history and reset tracker prices to initialPrice
app.post('/priceHistory/clear-all', async (req, res) => {
  try {
    await pool.query('DELETE FROM price_history');
    const { rowCount } = await pool.query(`
      UPDATE trackers SET
        "currentPrice" = 0,
        "minPrice" = 0,
        "maxPrice" = 0,
        "previousPrice" = 0,
        "initialPrice" = 0,
        status = 'active',
        unread = false,
        "errorMessage" = '',
        "lastCheckedAt" = NULL,
        "updatedAt" = NOW()
    `);
    res.json({ cleared: true, trackersReset: rowCount });
  } catch (err) {
    console.error('POST /priceHistory/clear-all error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/priceHistory', async (req, res) => {
  try {
    const trackerId = req.query.trackerId;
    const { rows } = await pool.query(
      'SELECT * FROM price_history WHERE "trackerId" = $1 ORDER BY "checkedAt" DESC',
      [trackerId]
    );
    res.json(rows);
  } catch (err) {
    console.error('GET /priceHistory error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/priceHistory', async (req, res) => {
  try {
    const d = req.body;
    const { rows } = await pool.query(
      `INSERT INTO price_history ("trackerId", price, "contentValue", "previousContent", "screenshotUrl", "checkedAt")
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [d.trackerId, d.price || 0, d.contentValue || '', d.previousContent || '', d.screenshotUrl || '', d.checkedAt || new Date().toISOString()]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('POST /priceHistory error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Settings ───────────────────────────────────────────────────────

app.get('/settings/global', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM settings WHERE id = $1', ['global']);
    res.json(rows[0] || {});
  } catch (err) {
    console.error('GET /settings/global error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.put('/settings/global', async (req, res) => {
  try {
    const d = req.body;
    // Build dynamic SET clause from provided fields
    const fields = [];
    const values = [];
    let idx = 1;

    const allowed = [
      'apiBaseUrl', 'notificationsEnabled', 'telegramBotToken',
      'telegramChatId', 'persistentPinTab',
      'thresholdConfig', 'telegramDigestEnabled',
      'telegramPersonalChatId',
    ];

    const jsonbFields = ['thresholdConfig'];

    for (const key of allowed) {
      if (d[key] !== undefined) {
        const val = jsonbFields.includes(key) ? JSON.stringify(d[key]) : d[key];
        fields.push(`"${key}" = $${idx}`);
        values.push(val);
        idx++;
      }
    }

    if (fields.length === 0) {
      const { rows } = await pool.query("SELECT * FROM settings WHERE id = 'global'");
      return res.json(rows[0]);
    }

    values.push('global');
    const { rows } = await pool.query(
      `UPDATE settings SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('PUT /settings/global error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Telegram Mini App (static files) ───────────────────────────────

app.use('/webapp', express.static(path.join(__dirname, 'webapp')));

// Mini App API: trigger price check
app.post('/webapp/api/check', async (req, res) => {
  try {
    const result = await scheduler.triggerManualCheck(pool);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Server-side Price Check (Scheduler) ────────────────────────────

// Version endpoint to verify deployment
app.get('/version', (req, res) => {
  res.json({ version: 'v2.15.0', deployedAt: new Date().toISOString(), commit: 'productName-price-fallback' });
});

app.post('/server-check', async (req, res) => {
  try {
    const result = await scheduler.triggerManualCheck(pool);
    res.json(result);
  } catch (err) {
    console.error('POST /server-check error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/server-check/status', (req, res) => {
  res.json(scheduler.getStatus());
});

// Test single tracker extraction (debug)
app.post('/server-check/test/:id', async (req, res) => {
  const scraper = require('./scraper');
  try {
    const { rows } = await pool.query('SELECT * FROM trackers WHERE id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Tracker not found' });
    const tracker = rows[0];
    const result = await scraper.extractPrice(tracker);
    await scraper.closeBrowser();
    res.json({ trackerId: tracker.id, productName: tracker.productName, cssSelector: tracker.cssSelector, variantSelector: tracker.variantSelector, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Debug EVA variant buttons — show HTML, links, and structure
app.post('/server-check/eva-debug', async (req, res) => {
  const scraper = require('./scraper');
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'url required' });
  let page;
  try {
    const browser = await scraper.getBrowser();
    page = await browser.newPage();
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });
    await page.setRequestInterception(true);
    page.on('request', (r) => {
      const t = r.resourceType();
      if (['image', 'font', 'media'].includes(t)) r.abort(); else r.continue();
    });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1366, height: 768 });
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

    const debug = await page.evaluate(() => {
      // Find volume buttons container
      var results = { buttons: [], containerHTML: '', links: [] };
      // Look for buttons with "мл" text
      var allBtns = document.querySelectorAll('button');
      allBtns.forEach(function(btn, i) {
        var text = (btn.textContent || '').trim();
        if (text.match(/\d+\s*мл/)) {
          var parent = btn.parentElement;
          var grandparent = parent ? parent.parentElement : null;
          // Check for <a> tags inside or wrapping the button
          var innerA = btn.querySelector('a');
          var outerA = btn.closest('a');
          results.buttons.push({
            index: i,
            text: text,
            outerHTML: btn.outerHTML.substring(0, 300),
            parentTag: parent ? parent.tagName : null,
            parentClass: parent ? (parent.className || '').substring(0, 100) : null,
            grandparentTag: grandparent ? grandparent.tagName : null,
            hasInnerA: !!innerA,
            innerAHref: innerA ? innerA.href : null,
            hasOuterA: !!outerA,
            outerAHref: outerA ? outerA.href : null,
            dataAttrs: {},
          });
          // Collect data attributes
          for (var j = 0; j < btn.attributes.length; j++) {
            var attr = btn.attributes[j];
            if (attr.name.startsWith('data-')) {
              results.buttons[results.buttons.length - 1].dataAttrs[attr.name] = attr.value;
            }
          }
        }
      });
      // Also look for <a> tags with "мл" text (maybe variants are links, not buttons)
      var allLinks = document.querySelectorAll('a');
      allLinks.forEach(function(a) {
        var text = (a.textContent || '').trim();
        if (text.match(/\d+\s*мл/)) {
          results.links.push({ text: text, href: a.href, outerHTML: a.outerHTML.substring(0, 300) });
        }
      });
      return results;
    });

    await scraper.closeBrowser();
    res.json(debug);
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (page) try { await page.close(); } catch(_) {}
  }
});

// Diagnostic endpoint: inspect what Puppeteer sees on a page
app.post('/server-check/diagnose', async (req, res) => {
  const scraper = require('./scraper');
  const { url, variantSelector, waitAfterClick } = req.body;
  if (!url) return res.status(400).json({ error: 'url required' });

  let page;
  try {
    const browser = await scraper.getBrowser();
    page = await browser.newPage();

    // Anti-detection
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });
    await page.setRequestInterception(true);
    page.on('request', (r) => {
      const t = r.resourceType();
      if (['image', 'font', 'media', 'stylesheet'].includes(t)) r.abort(); else r.continue();
    });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
    await page.setViewport({ width: 1366, height: 768 });
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

    const pageInfo = await page.evaluate(() => ({
      title: document.title,
      url: window.location.href,
      bodyLen: (document.body && document.body.innerHTML || '').length,
      hasPrice: !!document.querySelector('[itemprop="price"]'),
      hasVariant: !!document.querySelector('[data-variant-id]'),
    }));

    // Collect all price-related elements BEFORE variant click
    const beforeClick = await page.evaluate(() => {
      const sels = [
        '.product-item__price-current', '.product-item__price', '.price-block__price',
        '[data-testid="product-price"]', '[itemprop="price"]', '#pd-price',
        '.product-price__big', '.product__price', '.price-current', '.product-price',
      ];
      const results = {};
      for (const s of sels) {
        try {
          const el = document.querySelector(s);
          results[s] = el ? { text: (el.textContent || '').trim().substring(0, 100), tag: el.tagName, cls: el.className } : null;
        } catch(e) { results[s] = { error: e.message }; }
      }
      return results;
    });

    let afterClick = null;
    let variantFound = false;
    let variantButtons = null;
    let urlAfterClick = null;

    // List all variant buttons on the page
    variantButtons = await page.evaluate(() => {
      var buttons = [];
      document.querySelectorAll('button').forEach(function(btn) {
        var text = (btn.textContent || '').trim();
        if (text && text.length < 30 && /\d/.test(text)) {
          var rect = btn.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            // Build a simple selector path
            var parent = btn.parentElement;
            var idx = parent ? Array.from(parent.children).indexOf(btn) + 1 : 0;
            buttons.push({ text: text, tag: btn.tagName, cls: btn.className.substring(0, 80), childIndex: idx });
          }
        }
      });
      return buttons;
    });

    if (variantSelector) {
      try {
        await page.waitForSelector(variantSelector, { timeout: 5000 });
        variantFound = true;

        var urlBefore = await page.url();
        await page.click(variantSelector);

        // Wait for URL change (pushState)
        await page.waitForFunction(
          function(old) { return window.location.href !== old; },
          { timeout: 5000 },
          urlBefore
        ).catch(function() {});

        await page.waitForNetworkIdle({ timeout: 5000 }).catch(() => {});

        // Wait for price element to reappear
        try {
          await page.waitForSelector('[data-testid="product-price"]', { timeout: 10000 });
        } catch(_) {}

        await new Promise(r => setTimeout(r, 2000));
        urlAfterClick = await page.url();

        afterClick = await page.evaluate(() => {
          const sels = [
            '.product-item__price-current', '.product-item__price', '.price-block__price',
            '[data-testid="product-price"]', '[itemprop="price"]', '#pd-price',
            '.product-price__big', '.product__price', '.price-current', '.product-price',
          ];
          const results = {};
          for (const s of sels) {
            try {
              const el = document.querySelector(s);
              results[s] = el ? { text: (el.textContent || '').trim().substring(0, 100), tag: el.tagName, cls: el.className } : null;
            } catch(e) { results[s] = { error: e.message }; }
          }
          return results;
        });
      } catch(e) { afterClick = { error: e.message }; }
    }

    res.json({ pageInfo, beforeClick, afterClick, variantFound, variantSelector, variantButtons, urlAfterClick });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (page) try { await page.close(); } catch(_) {}
  }
});

// ─── Server Start ───────────────────────────────────────────────────

initDB()
  .then(async () => {
    app.listen(PORT, () => {
      console.log('═══════════════════════════════════════════════');
      console.log('🚀 Server running on port ' + PORT);
      console.log('   Node.js: ' + process.version);
      console.log('   Environment: ' + (process.env.NODE_ENV || 'development'));
      console.log('   Database: ' + (process.env.DATABASE_URL ? 'configured' : 'NOT configured'));
      console.log('   Chromium: ' + (process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium'));
      console.log('═══════════════════════════════════════════════');

      // Start the cron scheduler for background price checks
      // Default: every 3 hours. Override with CRON_SCHEDULE env var.
      const cronExpr = process.env.CRON_SCHEDULE || '0 */3 * * *';
      scheduler.start(pool, cronExpr);
    });

    // Initialize Telegram Bot (polling mode)
    try {
      const bot = new TelegramBot(pool);
      await bot.init();
    } catch (err) {
      console.error('[TelegramBot] Failed to initialize:', err.message);
    }
  })
  .catch((err) => {
    console.error('❌ Failed to initialize database:', err);
    process.exit(1);
  });
