/**
 * Badge Manager — manages the badge on the extension icon.
 * Tracks unread count and displays it via chrome.action.setBadgeText.
 *
 * Requirements: 17.1, 17.2, 17.3, 17.4
 */
(function () {

var _constants = (typeof self !== 'undefined' && self.PriceTracker && self.PriceTracker.constants)
  ? self.PriceTracker.constants
  : require('../shared/constants');
var BadgeColor = _constants.BadgeColor;

let unreadCount = 0;

/**
 * Increment the unread changes counter and update the badge.
 */
function incrementUnread() {
  unreadCount++;
  updateBadge();
}

/**
 * Reset the unread counter to zero and clear the badge.
 */
function resetUnread() {
  unreadCount = 0;
  updateBadge();
}

/**
 * Show a red error badge on the extension icon.
 */
function showError() {
  chrome.action.setBadgeText({ text: '!' });
  chrome.action.setBadgeBackgroundColor({ color: BadgeColor.ERROR });
}

/**
 * Update the badge text and color based on current unread count.
 * If unreadCount > 0, shows the count with default (green) color.
 * If unreadCount === 0, clears the badge.
 */
function updateBadge() {
  if (unreadCount > 0) {
    chrome.action.setBadgeText({ text: String(unreadCount) });
    chrome.action.setBadgeBackgroundColor({ color: BadgeColor.DEFAULT });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

/**
 * Get the current unread count (for testing).
 * @returns {number}
 */
function getUnreadCount() {
  return unreadCount;
}

/**
 * Set the unread count directly (for testing/restoration).
 * @param {number} count
 */
function setUnreadCount(count) {
  unreadCount = count;
  updateBadge();
}

const _badgeManager = {
  incrementUnread,
  resetUnread,
  showError,
  updateBadge,
  getUnreadCount,
  setUnreadCount,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = _badgeManager;
}
if (typeof self !== 'undefined' && self.PriceTracker) {
  self.PriceTracker.badgeManager = _badgeManager;
}

})();
