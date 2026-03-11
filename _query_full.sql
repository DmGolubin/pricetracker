-- Full tracker data
SELECT * FROM trackers WHERE id = 25;

-- Price history
SELECT * FROM price_history WHERE "trackerId" = 25 ORDER BY "checkedAt" DESC LIMIT 10;
