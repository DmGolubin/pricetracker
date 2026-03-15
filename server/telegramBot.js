/**
 * Telegram Bot — handles commands and Mini App integration.
 * Sends alerts to private chat (user's DM with the bot).
 * Provides inline keyboard to open the Mini App.
 */

const TELEGRAM_API = 'https://api.telegram.org/bot';

class TelegramBot {
  constructor(pool) {
    this.pool = pool;
    this.token = null;
    this.webAppUrl = null;
    this.offset = 0;
    this.polling = false;
    this.pollTimer = null;
    this.knownUsers = new Map(); // chatId -> { firstName, username }
  }

  /**
   * Initialize bot with token from DB settings.
   */
  async init() {
    const { rows } = await this.pool.query("SELECT * FROM settings WHERE id = 'global'");
    const settings = rows[0] || {};
    this.token = settings.telegramBotToken;

    if (!this.token) {
      console.log('[TelegramBot] No bot token configured — bot disabled.');
      return false;
    }

    // Web App URL = server's public URL + /webapp
    const baseUrl = process.env.WEBAPP_URL || process.env.RAILWAY_PUBLIC_DOMAIN
      ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : null;

    if (baseUrl) {
      this.webAppUrl = baseUrl + '/webapp';
      console.log('[TelegramBot] Mini App URL:', this.webAppUrl);
    } else {
      console.log('[TelegramBot] ⚠ No WEBAPP_URL or RAILWAY_PUBLIC_DOMAIN — Mini App button disabled.');
    }

    // Set bot commands
    await this.setCommands();

    // Set Menu Button (the "Открыть" button shown in chat)
    if (this.webAppUrl) {
      const menuResult = await this.api('setChatMenuButton', {
        menu_button: {
          type: 'web_app',
          text: 'Открыть',
          web_app: { url: this.webAppUrl },
        },
      });
      console.log('[TelegramBot] setChatMenuButton result:', JSON.stringify(menuResult));
    }

    // Start polling
    this.startPolling();

    console.log('[TelegramBot] ✅ Bot initialized and polling.');
    return true;
  }

  /**
   * Register bot commands menu.
   */
  async setCommands() {
    await this.api('setMyCommands', {
      commands: [
        { command: 'start', description: '🏠 Главное меню' },
        { command: 'groups', description: '📦 Группы товаров' },
        { command: 'best', description: '🏆 Лучшие цены по группам' },
        { command: 'all', description: '📋 Все трекеры' },
        { command: 'stats', description: '📊 Статистика' },
        { command: 'check', description: '🔄 Запустить проверку цен' },
        { command: 'settings', description: '⚙️ Настройки' },
        { command: 'help', description: '❓ Справка' },
      ],
    });
  }

  /**
   * Call Telegram Bot API.
   */
  async api(method, body) {
    if (!this.token) return null;
    try {
      const res = await fetch(`${TELEGRAM_API}${this.token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!data.ok) {
        console.error(`[TelegramBot] API ${method} error:`, data.description);
      }
      return data;
    } catch (err) {
      console.error(`[TelegramBot] API ${method} fetch error:`, err.message);
      return null;
    }
  }

  /**
   * Send message with optional inline keyboard.
   */
  async sendMessage(chatId, text, options = {}) {
    const body = {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: options.disablePreview !== false,
    };
    if (options.keyboard) {
      body.reply_markup = { inline_keyboard: options.keyboard };
    }
    return this.api('sendMessage', body);
  }

  /**
   * Edit existing message.
   */
  async editMessage(chatId, messageId, text, keyboard) {
    const body = {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    };
    if (keyboard) {
      body.reply_markup = { inline_keyboard: keyboard };
    }
    return this.api('editMessageText', body);
  }

  /**
   * Answer callback query (dismiss loading indicator).
   */
  async answerCallback(callbackQueryId, text) {
    return this.api('answerCallbackQuery', {
      callback_query_id: callbackQueryId,
      text: text || '',
    });
  }

  // ─── Polling ────────────────────────────────────────────────────

  startPolling() {
    if (this.polling) return;
    this.polling = true;
    this.poll();
  }

  stopPolling() {
    this.polling = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  async poll() {
    if (!this.polling) return;
    try {
      const data = await this.api('getUpdates', {
        offset: this.offset,
        timeout: 30,
        allowed_updates: ['message', 'callback_query'],
      });

      if (data && data.ok && data.result) {
        for (const update of data.result) {
          this.offset = update.update_id + 1;
          await this.handleUpdate(update);
        }
      }
    } catch (err) {
      console.error('[TelegramBot] Poll error:', err.message);
    }

    // Schedule next poll
    this.pollTimer = setTimeout(() => this.poll(), 500);
  }

  // ─── Update Handler ─────────────────────────────────────────────

  async handleUpdate(update) {
    try {
      if (update.message) {
        await this.handleMessage(update.message);
      } else if (update.callback_query) {
        await this.handleCallback(update.callback_query);
      }
    } catch (err) {
      console.error('[TelegramBot] handleUpdate error:', err.message);
    }
  }

  async handleMessage(msg) {
    const chatId = msg.chat.id;
    const text = (msg.text || '').trim();

    // Save user info
    this.knownUsers.set(chatId, {
      firstName: msg.from?.first_name || '',
      username: msg.from?.username || '',
    });

    // Auto-save chatId to settings for notifications
    await this.saveChatId(chatId);

    if (text.startsWith('/start')) return this.cmdStart(chatId, msg.from);
    if (text.startsWith('/groups')) return this.cmdGroups(chatId);
    if (text.startsWith('/best')) return this.cmdBestPrices(chatId);
    if (text.startsWith('/all')) return this.cmdAllTrackers(chatId, 0);
    if (text.startsWith('/stats')) return this.cmdStats(chatId);
    if (text.startsWith('/check')) return this.cmdCheck(chatId);
    if (text.startsWith('/settings')) return this.cmdSettings(chatId);
    if (text.startsWith('/help')) return this.cmdHelp(chatId);

    // Unknown command
    await this.sendMessage(chatId, '🤔 Неизвестная команда. Нажми /help для справки.');
  }

  async handleCallback(cb) {
    const chatId = cb.message.chat.id;
    const msgId = cb.message.message_id;
    const data = cb.data || '';

    await this.answerCallback(cb.id);

    if (data.startsWith('group:')) {
      const groupName = data.slice(6);
      return this.showGroup(chatId, msgId, groupName);
    }
    if (data === 'check:confirm') {
      return this.doCheck(chatId, msgId);
    }
    if (data === 'check:cancel') {
      return this.editMessage(chatId, msgId, '❌ Проверка отменена.');
    }
    if (data === 'check:stop') {
      const scheduler = require('./scheduler');
      const cancelled = scheduler.requestCancel();
      const text = cancelled ? '⛔ Запрос на отмену отправлен. Проверка остановится после текущего трекера.' : '⚠️ Проверка не выполняется.';
      return this.editMessage(chatId, msgId, text);
    }
    if (data.startsWith('tracker:')) {
      const trackerId = parseInt(data.slice(8));
      return this.showTracker(chatId, msgId, trackerId);
    }
    if (data.startsWith('history:')) {
      const trackerId = parseInt(data.slice(8));
      return this.showHistory(chatId, msgId, trackerId);
    }
    if (data.startsWith('allpage:')) {
      const page = parseInt(data.slice(8));
      return this.cmdAllTrackers(chatId, page, msgId);
    }
    if (data === 'back:groups') {
      return this.cmdGroups(chatId, msgId);
    }
    if (data === 'back:best') {
      return this.cmdBestPrices(chatId, msgId);
    }
    if (data === 'refresh:best') {
      return this.cmdBestPrices(chatId, msgId);
    }
  }

  /**
   * Save personal chatId (bot DM) separately from group chatId.
   * This way bot DM notifications don't overwrite the group chat setting.
   */
  async saveChatId(chatId) {
    try {
      await this.pool.query(
        `UPDATE settings SET "telegramPersonalChatId" = $1 WHERE id = 'global'`,
        [String(chatId)]
      );
      // Also set telegramChatId if it's empty (first-time setup)
      await this.pool.query(
        `UPDATE settings SET "telegramChatId" = $1 WHERE id = 'global' AND ("telegramChatId" IS NULL OR "telegramChatId" = '')`,
        [String(chatId)]
      );
    } catch (err) {
      console.error('[TelegramBot] saveChatId error:', err.message);
    }
  }

  // ─── Commands ───────────────────────────────────────────────────

  async cmdStart(chatId, from) {
    const name = from?.first_name || 'друг';
    let text = `👋 Привет, ${name}!\n\n`;
    text += `Я <b>Price Tracker Bot</b> — помогаю отслеживать цены на товары.\n\n`;
    text += `📦 /groups — группы товаров\n`;
    text += `🏆 /best — лучшие цены по группам\n`;
    text += `📋 /all — все трекеры\n`;
    text += `📊 /stats — статистика\n`;
    text += `🔄 /check — запустить проверку\n`;
    text += `⚙️ /settings — настройки\n`;

    const keyboard = [];

    // Mini App button
    if (this.webAppUrl) {
      keyboard.push([{
        text: '📱 Открыть Price Tracker',
        web_app: { url: this.webAppUrl },
      }]);
    }

    keyboard.push([
      { text: '🏆 Лучшие цены', callback_data: 'refresh:best' },
      { text: '📦 Группы', callback_data: 'back:groups' },
    ]);

    await this.sendMessage(chatId, text, { keyboard });
  }

  async cmdGroups(chatId, editMsgId) {
    const { rows } = await this.pool.query(`
      SELECT "productGroup", COUNT(*) as cnt,
             MIN("currentPrice") FILTER (WHERE "currentPrice" > 0) as "bestPrice",
             MIN("minPrice") FILTER (WHERE "minPrice" > 0) as "histMin"
      FROM trackers
      WHERE "productGroup" IS NOT NULL AND "productGroup" != '' AND status != 'paused'
      GROUP BY "productGroup"
      ORDER BY "productGroup"
    `);

    if (rows.length === 0) {
      const text = '📦 Групп пока нет.\n\nГруппы создаются автоматически при добавлении трекеров через расширение.';
      if (editMsgId) return this.editMessage(chatId, editMsgId, text);
      return this.sendMessage(chatId, text);
    }

    let text = `📦 <b>Группы товаров</b> (${rows.length})\n\n`;

    const keyboard = [];
    for (const row of rows) {
      const name = row.productGroup;
      const shortName = name.length > 35 ? name.slice(0, 35) + '…' : name;
      const best = row.bestPrice ? `${Number(row.bestPrice).toFixed(0)} грн` : '—';
      const volCount = row.volCount ? `, ${row.volCount} объёмов` : '';
      text += `• <b>${escapeHtml(shortName)}</b>\n  ${row.cnt} трекеров${volCount} · лучшая: ${best}\n\n`;
      keyboard.push([{ text: `📦 ${shortName}`, callback_data: `group:${name.slice(0, 60)}` }]);
    }

    // Also show ungrouped count
    const { rows: ungrouped } = await this.pool.query(`
      SELECT COUNT(*) as cnt FROM trackers
      WHERE ("productGroup" IS NULL OR "productGroup" = '') AND status != 'paused'
    `);
    if (ungrouped[0] && parseInt(ungrouped[0].cnt) > 0) {
      text += `\n📎 Без группы: ${ungrouped[0].cnt} трекеров`;
    }

    if (editMsgId) return this.editMessage(chatId, editMsgId, text, keyboard);
    return this.sendMessage(chatId, text, { keyboard });
  }

  async cmdBestPrices(chatId, editMsgId) {
    // Get all active trackers with groups
    const { rows } = await this.pool.query(`
      SELECT t.id, t."productName", t."pageUrl", t."currentPrice", t."previousPrice",
             t."minPrice", t."maxPrice", t."productGroup", t."initialPrice"
      FROM trackers t
      WHERE t."productGroup" IS NOT NULL AND t."productGroup" != ''
        AND t."currentPrice" > 0 AND t.status != 'paused'
      ORDER BY t."productGroup", t."currentPrice" ASC
    `);

    if (rows.length === 0) {
      const text = '🏆 Нет данных о ценах по группам.';
      if (editMsgId) return this.editMessage(chatId, editMsgId, text);
      return this.sendMessage(chatId, text);
    }

    // Group by productGroup, then sub-group by volume
    const groupMap = {};
    for (const t of rows) {
      if (!groupMap[t.productGroup]) groupMap[t.productGroup] = [];
      groupMap[t.productGroup].push(t);
    }

    let text = `🏆 <b>Лучшие цены по группам</b>\n\n`;
    const keyboard = [];

    for (const [groupName, trackers] of Object.entries(groupMap).sort((a, b) => a[0].localeCompare(b[0]))) {
      const volumes = groupByVolume(trackers);
      const shortGroup = groupName.length > 40 ? groupName.slice(0, 40) + '…' : groupName;

      text += `🏷 <b>${escapeHtml(shortGroup)}</b>\n`;

      if (volumes.length === 1 && volumes[0].volume === null) {
        // No volume info — show single best price
        const best = trackers.reduce((a, b) => (Number(a.currentPrice) || Infinity) <= (Number(b.currentPrice) || Infinity) ? a : b);
        const shop = getShopLabel(extractDomain(best.pageUrl));
        const price = Number(best.currentPrice).toFixed(0);
        text += `   💰 ${price} грн · ${shop}\n\n`;
      } else {
        // Show best price per volume
        for (const vg of volumes) {
          const best = vg.trackers.reduce((a, b) => (Number(a.currentPrice) || Infinity) <= (Number(b.currentPrice) || Infinity) ? a : b);
          const shop = getShopLabel(extractDomain(best.pageUrl));
          const price = Number(best.currentPrice).toFixed(0);
          const volLabel = vg.volumeLabel || 'без объёма';
          text += `   📏 <b>${volLabel}</b>: ${price} грн · ${shop}\n`;
        }
        text += '\n';
      }

      keyboard.push([{ text: `🔍 ${shortGroup.slice(0, 30)}`, callback_data: `group:${groupName.slice(0, 60)}` }]);
    }

    const refreshBtn = [{ text: '🔄 Обновить', callback_data: 'refresh:best' }];
    keyboard.push(refreshBtn);

    if (editMsgId) return this.editMessage(chatId, editMsgId, text, keyboard);
    return this.sendMessage(chatId, text, { keyboard });
  }

  async showGroup(chatId, msgId, groupName) {
    const { rows } = await this.pool.query(`
      SELECT id, "productName", "pageUrl", "currentPrice", "previousPrice",
             "minPrice", "maxPrice", "initialPrice", status
      FROM trackers
      WHERE "productGroup" = $1 AND status != 'paused'
      ORDER BY "currentPrice" ASC
    `, [groupName]);

    if (rows.length === 0) {
      return this.editMessage(chatId, msgId, '📦 Группа пуста или не найдена.');
    }

    const shortGroup = groupName.length > 40 ? groupName.slice(0, 40) + '…' : groupName;
    let text = `📦 <b>${escapeHtml(shortGroup)}</b>\n`;
    text += `${rows.length} трекеров\n\n`;

    const volumes = groupByVolume(rows);
    const keyboard = [];

    for (const vg of volumes) {
      const volTitle = vg.volumeLabel || '📎 Без объёма';
      if (volumes.length > 1 || vg.volume !== null) {
        text += `━━━ 📏 <b>${volTitle}</b> ━━━\n`;
        if (vg.bestPrice > 0) {
          text += `🏆 Лучшая: ${vg.bestPrice.toFixed(0)} грн\n\n`;
        } else {
          text += '\n';
        }
      }

      for (const t of vg.trackers) {
        const name = cleanName(t.productName);
        const shortName = name.length > 35 ? name.slice(0, 35) + '…' : name;
        const domain = extractDomain(t.pageUrl);
        const shop = getShopLabel(domain);
        const price = Number(t.currentPrice);
        const priceStr = price > 0 ? `${price.toFixed(0)} грн` : '—';
        const isBest = price > 0 && price === vg.bestPrice;
        const bestTag = isBest ? ' 🏆' : '';
        const min = Number(t.minPrice);
        const isHistMin = price > 0 && min > 0 && price <= min;
        const histTag = isHistMin && !isBest ? ' ⭐' : '';
        const volInfo = t._volumeLabel ? ` · ${t._volumeLabel}` : '';

        text += `${isBest ? '🏆' : '•'} <b>${escapeHtml(shortName)}</b>\n`;
        text += `   ${priceStr} · ${shop}${volInfo}${bestTag}${histTag}\n`;

        if (min > 0) {
          text += `   📊 мін: ${min.toFixed(0)} / макс: ${Number(t.maxPrice).toFixed(0)} грн\n`;
        }
        text += '\n';

        const btnLabel = `${isBest ? '🏆' : '📊'} ${shop}${t._volumeLabel ? ' ' + t._volumeLabel : ''} — ${priceStr}`;
        keyboard.push([{
          text: btnLabel.slice(0, 60),
          callback_data: `tracker:${t.id}`,
        }]);
      }
    }

    keyboard.push([{ text: '⬅️ Назад к группам', callback_data: 'back:groups' }]);

    return this.editMessage(chatId, msgId, text, keyboard);
  }

  async showTracker(chatId, msgId, trackerId) {
    const { rows } = await this.pool.query('SELECT * FROM trackers WHERE id = $1', [trackerId]);
    if (rows.length === 0) {
      return this.editMessage(chatId, msgId, '❌ Трекер не найден.');
    }

    const t = rows[0];
    const name = cleanName(t.productName);
    const domain = extractDomain(t.pageUrl);
    const shop = getShopLabel(domain);
    const current = Number(t.currentPrice);
    const initial = Number(t.initialPrice);
    const min = Number(t.minPrice);
    const max = Number(t.maxPrice);
    const prev = Number(t.previousPrice);

    let text = `🏷 <b>${escapeHtml(name)}</b>\n\n`;
    const { volumeLabel } = extractVolume(t.productName);
    text += `🏪 Магазин: ${shop}\n`;
    if (volumeLabel) text += `📏 Объём: ${volumeLabel}\n`;
    text += `💰 Текущая цена: <b>${current > 0 ? current.toFixed(0) + ' грн' : '—'}</b>\n`;

    if (prev > 0 && prev !== current) {
      const diff = current - prev;
      const pct = prev > 0 ? ((diff / prev) * 100).toFixed(1) : '0';
      const arrow = diff > 0 ? '📈' : '📉';
      text += `${arrow} Изменение: ${diff > 0 ? '+' : ''}${diff.toFixed(0)} грн (${diff > 0 ? '+' : ''}${pct}%)\n`;
    }

    text += `\n📊 <b>Статистика:</b>\n`;
    if (initial > 0) text += `   Начальная: ${initial.toFixed(0)} грн\n`;
    if (min > 0) text += `   Минимум: ${min.toFixed(0)} грн\n`;
    if (max > 0) text += `   Максимум: ${max.toFixed(0)} грн\n`;

    if (min > 0 && max > 0 && max > min) {
      const range = max - min;
      const position = current > 0 ? ((current - min) / range * 100).toFixed(0) : '—';
      text += `   Позиция: ${position}% от диапазона\n`;
    }

    if (t.lastCheckedAt) {
      const checked = new Date(t.lastCheckedAt);
      text += `\n🕐 Проверено: ${formatDate(checked)}`;
    }

    text += `\n\n🔗 <a href="${t.pageUrl}">Открыть в магазине</a>`;

    const keyboard = [
      [{ text: '📈 История цен', callback_data: `history:${t.id}` }],
    ];

    if (t.productGroup) {
      keyboard.push([{ text: `⬅️ Назад к группе`, callback_data: `group:${t.productGroup.slice(0, 60)}` }]);
    }
    keyboard.push([{ text: '🏆 Лучшие цены', callback_data: 'back:best' }]);

    return this.editMessage(chatId, msgId, text, keyboard);
  }

  async showHistory(chatId, msgId, trackerId) {
    const { rows: trackerRows } = await this.pool.query('SELECT "productName" FROM trackers WHERE id = $1', [trackerId]);
    const name = trackerRows[0] ? cleanName(trackerRows[0].productName) : 'Трекер';

    const { rows } = await this.pool.query(
      `SELECT price, "checkedAt" FROM price_history
       WHERE "trackerId" = $1 AND price > 0
       ORDER BY "checkedAt" DESC LIMIT 20`,
      [trackerId]
    );

    if (rows.length === 0) {
      const text = `📈 <b>${escapeHtml(name)}</b>\n\nИстория цен пуста.`;
      return this.editMessage(chatId, msgId, text, [
        [{ text: '⬅️ Назад', callback_data: `tracker:${trackerId}` }],
      ]);
    }

    let text = `📈 <b>${escapeHtml(name)}</b>\nПоследние ${rows.length} проверок:\n\n`;

    let prevPrice = null;
    // Show in chronological order (oldest first)
    const sorted = rows.slice().reverse();
    for (const row of sorted) {
      const price = Number(row.price);
      const date = formatDate(new Date(row.checkedAt));
      let arrow = '  ';
      if (prevPrice !== null) {
        if (price < prevPrice) arrow = '📉';
        else if (price > prevPrice) arrow = '📈';
        else arrow = '➡️';
      }
      text += `${arrow} ${price.toFixed(0)} грн — ${date}\n`;
      prevPrice = price;
    }

    return this.editMessage(chatId, msgId, text, [
      [{ text: '⬅️ Назад к трекеру', callback_data: `tracker:${trackerId}` }],
    ]);
  }

  async cmdAllTrackers(chatId, page = 0, editMsgId) {
    const PAGE_SIZE = 10;
    const offset = page * PAGE_SIZE;

    const { rows: countRows } = await this.pool.query(
      `SELECT COUNT(*) as cnt FROM trackers WHERE status != 'paused'`
    );
    const total = parseInt(countRows[0].cnt);

    const { rows } = await this.pool.query(
      `SELECT id, "productName", "pageUrl", "currentPrice", status
       FROM trackers WHERE status != 'paused'
       ORDER BY "updatedAt" DESC
       LIMIT $1 OFFSET $2`,
      [PAGE_SIZE, offset]
    );

    if (rows.length === 0) {
      const text = '📋 Трекеров пока нет.';
      if (editMsgId) return this.editMessage(chatId, editMsgId, text);
      return this.sendMessage(chatId, text);
    }

    const totalPages = Math.ceil(total / PAGE_SIZE);
    let text = `📋 <b>Все трекеры</b> (${total})\nСтраница ${page + 1}/${totalPages}\n\n`;

    const keyboard = [];
    for (const t of rows) {
      const name = cleanName(t.productName);
      const shortName = name.length > 30 ? name.slice(0, 30) + '…' : name;
      const price = Number(t.currentPrice);
      const priceStr = price > 0 ? `${price.toFixed(0)} грн` : '—';
      const statusIcon = t.status === 'error' ? '❌' : t.status === 'updated' ? '🔔' : '✅';

      text += `${statusIcon} ${escapeHtml(shortName)} — ${priceStr}\n`;
      keyboard.push([{ text: `${statusIcon} ${shortName}`, callback_data: `tracker:${t.id}` }]);
    }

    // Pagination
    const navRow = [];
    if (page > 0) navRow.push({ text: '⬅️ Назад', callback_data: `allpage:${page - 1}` });
    if (page < totalPages - 1) navRow.push({ text: 'Вперёд ➡️', callback_data: `allpage:${page + 1}` });
    if (navRow.length > 0) keyboard.push(navRow);

    if (editMsgId) return this.editMessage(chatId, editMsgId, text, keyboard);
    return this.sendMessage(chatId, text, { keyboard });
  }

  async cmdStats(chatId) {
    const { rows: totalRows } = await this.pool.query('SELECT COUNT(*) as cnt FROM trackers');
    const { rows: activeRows } = await this.pool.query(`SELECT COUNT(*) as cnt FROM trackers WHERE status = 'active'`);
    const { rows: errorRows } = await this.pool.query(`SELECT COUNT(*) as cnt FROM trackers WHERE status = 'error'`);
    const { rows: groupRows } = await this.pool.query(`SELECT COUNT(DISTINCT "productGroup") as cnt FROM trackers WHERE "productGroup" IS NOT NULL AND "productGroup" != ''`);
    const { rows: histRows } = await this.pool.query('SELECT COUNT(*) as cnt FROM price_history');

    const { rows: priceDrops } = await this.pool.query(`
      SELECT COUNT(*) as cnt FROM trackers
      WHERE "currentPrice" > 0 AND "currentPrice" < "initialPrice"
    `);

    let text = `📊 <b>Статистика</b>\n\n`;
    text += `📋 Всего трекеров: ${totalRows[0].cnt}\n`;
    text += `✅ Активных: ${activeRows[0].cnt}\n`;
    text += `❌ С ошибками: ${errorRows[0].cnt}\n`;
    text += `📦 Групп: ${groupRows[0].cnt}\n`;
    text += `📈 Записей истории: ${histRows[0].cnt}\n`;
    text += `📉 Цена снизилась: ${priceDrops[0].cnt} трекеров\n`;

    const keyboard = [];
    if (this.webAppUrl) {
      keyboard.push([{ text: '📱 Открыть приложение', web_app: { url: this.webAppUrl } }]);
    }

    await this.sendMessage(chatId, text, { keyboard });
  }

  async cmdCheck(chatId) {
    await this.sendMessage(chatId, '🔄 Запустить проверку цен?', {
      keyboard: [
        [
          { text: '✅ Да, запустить', callback_data: 'check:confirm' },
          { text: '❌ Отмена', callback_data: 'check:cancel' },
        ],
      ],
    });
  }

  async doCheck(chatId, msgId) {
    await this.editMessage(chatId, msgId, '🔄 Проверка цен запущена...', [
      [{ text: '⛔ Отменить проверку', callback_data: 'check:stop' }],
    ]);

    try {
      const scheduler = require('./scheduler');
      const result = await scheduler.triggerManualCheck(this.pool);

      if (result.skipped) {
        await this.editMessage(chatId, msgId, '⚠️ Проверка уже выполняется. Подожди немного.');
      } else if (result.cancelled) {
        let text = `⛔ Проверка отменена.\n\n`;
        text += `📋 Проверено: ${result.checked}\n`;
        text += `🔄 Изменилось: ${result.changed}`;
        await this.editMessage(chatId, msgId, text);
      } else {
        let text = `✅ Проверка завершена!\n\n`;
        text += `📋 Проверено: ${result.checked}\n`;
        text += `🔄 Изменилось: ${result.changed}\n`;
        text += `❌ Ошибок: ${result.errors}`;
        await this.editMessage(chatId, msgId, text);
      }
    } catch (err) {
      await this.editMessage(chatId, msgId, `❌ Ошибка проверки: ${err.message}`);
    }
  }

  async cmdSettings(chatId) {
    const { rows } = await this.pool.query("SELECT * FROM settings WHERE id = 'global'");
    const s = rows[0] || {};

    let text = `⚙️ <b>Настройки</b>\n\n`;
    text += `🔔 Уведомления: ${s.notificationsEnabled ? '✅ Вкл' : '❌ Выкл'}\n`;
    text += `📨 Дайджест: ${s.telegramDigestEnabled ? '✅ Вкл' : '❌ Выкл'}\n`;
    text += `💬 Chat ID: ${s.telegramChatId || '—'}\n`;
    text += `\n<i>Настройки можно изменить через расширение или Mini App.</i>`;

    const keyboard = [];
    if (this.webAppUrl) {
      keyboard.push([{ text: '📱 Открыть настройки', web_app: { url: this.webAppUrl + '?page=settings' } }]);
    }

    await this.sendMessage(chatId, text, { keyboard });
  }

  async cmdHelp(chatId) {
    let text = `❓ <b>Справка</b>\n\n`;
    text += `Этот бот помогает отслеживать цены на товары.\n\n`;
    text += `<b>Как это работает:</b>\n`;
    text += `1. Добавляй трекеры через браузерное расширение\n`;
    text += `2. Бот автоматически проверяет цены каждые 3 часа\n`;
    text += `3. При изменении цены — получаешь уведомление\n\n`;
    text += `<b>Команды:</b>\n`;
    text += `/groups — все группы товаров\n`;
    text += `/best — лучшая цена в каждой группе\n`;
    text += `/all — список всех трекеров\n`;
    text += `/stats — статистика\n`;
    text += `/check — ручная проверка цен\n`;
    text += `/settings — настройки\n`;

    const keyboard = [];
    if (this.webAppUrl) {
      keyboard.push([{ text: '📱 Открыть Mini App', web_app: { url: this.webAppUrl } }]);
    }

    await this.sendMessage(chatId, text, { keyboard });
  }
}

// ─── Helpers ──────────────────────────────────────────────────────

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function extractDomain(url) {
  if (!url) return '';
  try { return new URL(url).hostname; } catch (_) { return ''; }
}

function getShopLabel(domain) {
  if (!domain) return '';
  if (domain.indexOf('makeup') !== -1) return 'Makeup';
  if (domain.indexOf('eva.ua') !== -1) return 'EVA';
  if (domain.indexOf('notino') !== -1) return 'Notino';
  return domain;
}

function cleanName(name) {
  if (!name) return '';
  return name
    .replace(/\s*[-–—:]\s*(купить|купити).*$/i, '')
    .replace(/\s*[-–—]\s*(купить|купити)\s+на\s+.*$/i, '')
    .replace(/\s*Большой ассортимент.*$/i, '')
    .replace(/\s*Великий асортимент.*$/i, '')
    .replace(/\s*\|\s*[\w.]+\s*$/, '')
    .trim();
}

/**
 * Extract volume (ml) from product name.
 * Handles patterns: "50ml", "100 мл", "— 50", "edp/100ml", ", 30 мл (ТЕСТЕР)"
 * Also detects "ТЕСТЕР" / "тестер" / "tester" flag.
 * @param {string} name
 * @returns {{ volume: number|null, isTester: boolean, volumeLabel: string }}
 */
function extractVolume(name) {
  if (!name) return { volume: null, isTester: false, volumeLabel: '' };

  const isTester = /тестер|tester/i.test(name);

  // Pattern 1: "50ml" or "100 ml" or "50 мл"
  let m = name.match(/(\d+)\s*(?:ml|мл)\b/i);
  if (m) {
    const vol = parseInt(m[1]);
    return { volume: vol, isTester, volumeLabel: vol + ' мл' + (isTester ? ' (тестер)' : '') };
  }

  // Pattern 2: "edp/100ml" (sets)
  m = name.match(/\/(\d+)\s*ml/i);
  if (m) {
    const vol = parseInt(m[1]);
    return { volume: vol, isTester, volumeLabel: vol + ' мл' + (isTester ? ' (тестер)' : '') };
  }

  // Pattern 3: trailing "— 50" or "— 100" (EVA pattern, only 2-3 digit numbers)
  m = name.match(/[-–—]\s*(\d{2,3})\s*$/);
  if (m) {
    const vol = parseInt(m[1]);
    // Sanity check: typical perfume volumes are 5-200ml
    if (vol >= 5 && vol <= 200) {
      return { volume: vol, isTester, volumeLabel: vol + ' мл' + (isTester ? ' (тестер)' : '') };
    }
  }

  // Pattern 4: ", 30 мл" or ", 100 мл (ТЕСТЕР)"
  m = name.match(/,\s*(\d+)\s*мл/i);
  if (m) {
    const vol = parseInt(m[1]);
    return { volume: vol, isTester, volumeLabel: vol + ' мл' + (isTester ? ' (тестер)' : '') };
  }

  return { volume: null, isTester, volumeLabel: isTester ? '(тестер)' : '' };
}

/**
 * Group trackers by volume within a product group.
 * Returns array of { volume, volumeLabel, trackers, bestPrice }
 * sorted by volume ascending. Trackers without volume go into "Без объёма" bucket.
 */
function groupByVolume(trackers) {
  const volumeMap = {};

  for (const t of trackers) {
    const { volume, volumeLabel } = extractVolume(t.productName);
    const key = volume !== null ? String(volume) : 'none';
    if (!volumeMap[key]) {
      volumeMap[key] = { volume, volumeLabel: volume ? (volume + ' мл') : '', trackers: [] };
    }
    volumeMap[key].trackers.push(t);
    // Enrich tracker with extracted volume info
    t._volume = volume;
    t._volumeLabel = volumeLabel;
  }

  return Object.values(volumeMap)
    .map(g => {
      const prices = g.trackers.map(t => Number(t.currentPrice)).filter(p => p > 0);
      g.bestPrice = prices.length ? Math.min(...prices) : 0;
      return g;
    })
    .sort((a, b) => {
      if (a.volume === null) return 1;
      if (b.volume === null) return -1;
      return a.volume - b.volume;
    });
}

function formatDate(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

module.exports = TelegramBot;
