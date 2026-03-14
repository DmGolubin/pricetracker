/**
 * Telegram message sender for server-side notifications.
 */

/**
 * Send an HTML message to Telegram.
 * @param {string} botToken
 * @param {string} chatId
 * @param {string} html — HTML-formatted message text
 * @returns {Promise<boolean>} — true if sent successfully
 */
async function sendMessage(botToken, chatId, html) {
  if (!botToken || !chatId) {
    console.warn('[Telegram] Cannot send — botToken or chatId missing.');
    return false;
  }

  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const msgPreview = html.substring(0, 100).replace(/\n/g, ' ');
  console.log('[Telegram] Sending message (' + html.length + ' chars): "' + msgPreview + '..."');

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: html,
        parse_mode: 'HTML',
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error('[Telegram] ❌ Send failed (HTTP ' + res.status + '): ' + body);
      return false;
    }

    console.log('[Telegram] ✅ Message sent successfully.');
    return true;
  } catch (err) {
    console.error('[Telegram] ❌ Send error: ' + err.message);
    return false;
  }
}

/**
 * Send multiple digest messages to Telegram (for long digests split into chunks).
 * Sends to both the group chat (telegramChatId) and personal DM (telegramPersonalChatId) if configured.
 * @param {string} botToken
 * @param {string} chatId — group/channel chat ID
 * @param {string[]} messages — array of HTML message chunks
 * @param {string} [personalChatId] — personal DM chat ID (from bot /start)
 * @returns {Promise<number>} — number of successfully sent messages
 */
async function sendDigest(botToken, chatId, messages, personalChatId) {
  let sent = 0;

  // Determine target chat IDs — prefer personal DM, also send to group if different
  var targets = [];
  if (personalChatId) targets.push(personalChatId);
  if (chatId && chatId !== personalChatId) targets.push(chatId);
  if (targets.length === 0) {
    console.warn('[Telegram] No chat IDs configured — digest not sent.');
    return 0;
  }

  for (const target of targets) {
    for (const msg of messages) {
      const ok = await sendMessage(botToken, target, msg);
      if (ok) sent++;
      // Small delay between messages to avoid Telegram rate limits
      if (messages.length > 1) {
        await new Promise(r => setTimeout(r, 300));
      }
    }
  }
  return sent;
}

module.exports = { sendMessage, sendDigest };
