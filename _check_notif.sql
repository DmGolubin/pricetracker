SELECT id, "productName", "currentPrice", "initialPrice", "notificationsEnabled", "notificationFilter", "variantSelector"
FROM trackers
WHERE "currentPrice" = 2307 OR "initialPrice" = 2537
ORDER BY id DESC
LIMIT 5;
