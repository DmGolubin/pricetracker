-- Fix tracker 112 (Devotion 50ml) - price 2930 is correct, just mark verified
UPDATE trackers SET "variantPriceVerified" = true WHERE id = 112;

-- Fix tracker 113 (Devotion 30ml) - correct price is 2128
UPDATE trackers SET "currentPrice" = 2128, "initialPrice" = 2128, "minPrice" = 2128, "maxPrice" = 2128, "variantPriceVerified" = true WHERE id = 113;

-- Fix tracker 114 (Devotion 100ml) - correct price is 2698
UPDATE trackers SET "currentPrice" = 2698, "initialPrice" = 2698, "minPrice" = 2698, "maxPrice" = 2698, "variantPriceVerified" = true WHERE id = 114;

-- Fix tracker 115 (Intense 30ml) - price 2096 is correct, just mark verified
UPDATE trackers SET "variantPriceVerified" = true WHERE id = 115;

-- Fix tracker 116 (Intense 50ml) - correct price is 2451
UPDATE trackers SET "currentPrice" = 2451, "initialPrice" = 2451, "minPrice" = 2451, "maxPrice" = 2451, "variantPriceVerified" = true WHERE id = 116;

-- Fix tracker 117 (Intense 100ml) - correct price is 2753
UPDATE trackers SET "currentPrice" = 2753, "initialPrice" = 2753, "minPrice" = 2753, "maxPrice" = 2753, "variantPriceVerified" = true WHERE id = 117;
