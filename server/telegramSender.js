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
 * @param {string} botToken
 * @param {string} chatId
 * @param {string[]} messages — array of HTML message chunks
 * @returns {Promise<number>} — number of successfully sent messages
 */
async function sendDigest(botToken, chatId, messages) {
  let sent = 0;
  for (const msg of messages) {
    const ok = await sendMessage(botToken, chatId, msg);
    if (ok) sent++;
    // Small delay between messages to avoid Telegram rate limits
    if (messages.length > 1) {
      await new Promise(r => setTimeout(r, 300));
    }
  }
  return sent;
}

module.exports = { sendMessage, sendDigest };
