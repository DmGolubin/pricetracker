-- Reset currentPrice to 5990 (the "simulated" price) so when the real check
-- finds 5490 on the page, it will detect a price decrease and trigger notification
UPDATE trackers
SET "currentPrice" = 5990,
    "previousPrice" = 5490
WHERE id = 10
RETURNING id, "currentPrice", "previousPrice", status;
