const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// PostgreSQL connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

app.use(cors());
app.use(express.json());

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
      "checkIntervalHours" INTEGER DEFAULT 12,
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
      "createdAt" TIMESTAMP DEFAULT NOW(),
      "updatedAt" TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS price_history (
      id SERIAL PRIMARY KEY,
      "trackerId" INTEGER REFERENCES trackers(id) ON DELETE CASCADE,
      price NUMERIC,
      "contentValue" TEXT DEFAULT '',
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

  // Migration: add notificationsEnabled column if missing
  await pool.query(`
    ALTER TABLE trackers ADD COLUMN IF NOT EXISTS "notificationsEnabled" BOOLEAN DEFAULT true;
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
    const { rows } = await pool.query(
      `INSERT INTO trackers (
        "pageUrl", "cssSelector", "productName", "imageUrl",
        "initialPrice", "currentPrice", "minPrice", "maxPrice",
        "checkIntervalHours", "trackingType", "isAutoDetected",
        "initialContent", "currentContent", "excludedSelectors"
      ) VALUES ($1,$2,$3,$4,$5,$5,$5,$5,$6,$7,$8,$9,$9,$10) RETURNING *`,
      [
        d.pageUrl, d.cssSelector, d.productName || '', d.imageUrl || '',
        d.initialPrice || 0, d.checkIntervalHours || 12,
        d.trackingType || 'price', d.isAutoDetected || false,
        d.initialContent || '', JSON.stringify(d.excludedSelectors || []),
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
    ];

    for (const key of allowed) {
      if (d[key] !== undefined) {
        const val = (key === 'notificationFilter' || key === 'excludedSelectors')
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

// ─── Price History ──────────────────────────────────────────────────

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
      `INSERT INTO price_history ("trackerId", price, "contentValue", "checkedAt")
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [d.trackerId, d.price || 0, d.contentValue || '', d.checkedAt || new Date().toISOString()]
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
    const { rows } = await pool.query(
      `UPDATE settings SET
        "apiBaseUrl" = $1,
        "notificationsEnabled" = $2,
        "telegramBotToken" = $3,
        "telegramChatId" = $4,
        "persistentPinTab" = $5
       WHERE id = 'global' RETURNING *`,
      [
        d.apiBaseUrl || '',
        d.notificationsEnabled !== false,
        d.telegramBotToken || '',
        d.telegramChatId || '',
        d.persistentPinTab || false,
      ]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('PUT /settings/global error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Start ──────────────────────────────────────────────────────────

initDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  });
