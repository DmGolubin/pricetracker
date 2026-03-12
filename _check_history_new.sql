SELECT ph.id, ph."trackerId", ph.price, ph."checkedAt"
FROM price_history ph
WHERE ph."trackerId" IN (112, 113, 114, 115, 116, 117)
ORDER BY ph."trackerId", ph."checkedAt" DESC;
