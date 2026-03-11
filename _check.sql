-- Снова ставим цену 5990, чтобы при следующей проверке было видно снижение и пришло уведомление
UPDATE trackers SET
  "currentPrice" = 5990,
  "previousPrice" = 5490,
  status = 'active',
  "errorMessage" = ''
WHERE id = 10;
