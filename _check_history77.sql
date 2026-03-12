SELECT id, "trackerId", price, "checkedAt"
FROM price_history
WHERE "trackerId" = 77
ORDER BY "checkedAt" DESC
LIMIT 10;
