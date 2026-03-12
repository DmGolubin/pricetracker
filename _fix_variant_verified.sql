-- Mark all existing variant trackers as verified (they've already had their first check)
UPDATE trackers SET "variantPriceVerified" = true
WHERE "variantSelector" != '' AND "variantSelector" IS NOT NULL;

-- Reset error status on variant trackers so they get rechecked
UPDATE trackers SET status = 'active', "errorMessage" = ''
WHERE "variantSelector" != '' AND "variantSelector" IS NOT NULL AND status = 'error';
