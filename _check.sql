-- Full system check
-- 1. Tracker state
SELECT id, "productName", "cssSelector", "currentPrice", "previousPrice", "minPrice", "maxPrice", status, "errorMessage", "checkMode", "notificationsEnabled", "notificationFilter"
FROM trackers WHERE id = 10;

-- 2. Settings
SELECT * FROM settings WHERE id = 'global';

-- 3. Price history (last 10)
SELECT id, "trackerId", price, "checkedAt" FROM price_history WHERE "trackerId" = 10 ORDER BY "checkedAt" DESC LIMIT 10;
