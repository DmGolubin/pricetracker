-- Change currentContent to a different value so next check triggers a "content changed" alert
UPDATE trackers
SET "currentContent" = E'80 мл\n4 200грн\n50 мл\n3 200грн\n30 мл\n2 400грн',
    "previousContent" = E'80 мл\n4 100грн\n50 мл\n3 100грн\n30 мл\n2 300грн',
    status = 'active',
    "notificationsEnabled" = true,
    "updatedAt" = now()
WHERE id = 25;

-- Verify
SELECT id, "productName", status, "notificationsEnabled",
       "currentContent", "previousContent"
FROM trackers WHERE id = 25;
