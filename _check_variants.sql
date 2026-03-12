SELECT id, LEFT("productName", 60) as name, "cssSelector", "variantSelector", "currentPrice", status, LEFT("errorMessage", 80) as err
FROM trackers
ORDER BY id DESC
LIMIT 5;
