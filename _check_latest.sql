SELECT id, "productName", "pageUrl", "cssSelector", "variantSelector", "initialPrice", "currentPrice", "variantPriceVerified", "createdAt"
FROM trackers
ORDER BY id DESC
LIMIT 12;
