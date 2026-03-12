SELECT id, "productName", "initialPrice", "currentPrice", "variantPriceVerified", "updatedAt"
FROM trackers
WHERE id IN (112, 113, 114, 115, 116, 117)
ORDER BY id;
