SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'trackers' AND column_name = 'variantPriceVerified';
