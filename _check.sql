SELECT id, "productName", "currentPrice", "minPrice", "maxPrice", status, "updatedAt", "errorMessage"
FROM trackers WHERE id = 10;

SELECT id, "trackerId", price, "contentValue", "checkedAt"
FROM price_history WHERE "trackerId" = 10
ORDER BY "checkedAt" DESC LIMIT 5;
