/**
 * Unit tests for TrackerCard component (dashboard/components/trackerCard.js)
 *
 * Requirements: 4.2, 4.3, 4.4, 13.5, 15.4, 18.3, 18.5
 */

const TrackerCard = require('../../dashboard/components/trackerCard');

// ─── Helpers ──────────────────────────────────────────────────────────

function makeTracker(overrides = {}) {
  return {
    id: 'tracker-1',
    pageUrl: 'https://shop.example.com/product/123',
    cssSelector: '.price',
    productName: 'Test Product',
    imageUrl: 'https://shop.example.com/img.jpg',
    initialPrice: 100,
    currentPrice: 90,
    minPrice: 85,
    maxPrice: 110,
    checkIntervalHours: 12,
    notificationsEnabled: true,
    status: 'active',
    createdAt: '2024-01-01T00:00:00Z',
    trackingType: 'price',
    isAutoDetected: false,
    checkMode: 'auto',
    unread: false,
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────

describe('TrackerCard', () => {
  // ─── Basic card structure (Req 4.2) ─────────────────────────────

  describe('card structure and required information', () => {
    test('card contains product image', () => {
      const card = TrackerCard.create(makeTracker());
      const img = card.querySelector('img');
      expect(img).not.toBeNull();
      expect(img.src).toContain('shop.example.com/img.jpg');
    });

    test('card contains domain extracted from pageUrl', () => {
      const card = TrackerCard.create(makeTracker({ pageUrl: 'https://store.example.org/item' }));
      expect(card.textContent).toContain('store.example.org');
    });

    test('card contains product name', () => {
      const card = TrackerCard.create(makeTracker({ productName: 'My Widget' }));
      expect(card.textContent).toContain('My Widget');
    });

    test('card contains current price', () => {
      const card = TrackerCard.create(makeTracker({ currentPrice: 42 }));
      const priceEl = card.querySelector('.tracker-card-price');
      expect(priceEl).not.toBeNull();
      expect(priceEl.textContent).toContain('42');
    });

    test('card contains min-max price range', () => {
      const card = TrackerCard.create(makeTracker({ minPrice: 50, maxPrice: 200, currentPrice: 100 }));
      // When min !== max, renders range bar with labels
      const rangeBar = card.querySelector('.tracker-card-range-bar');
      expect(rangeBar).not.toBeNull();
      const labels = card.querySelectorAll('.tracker-card-range-label');
      expect(labels.length).toBe(2);
      expect(labels[0].textContent).toContain('50');
      expect(labels[1].textContent).toContain('200');
    });

    test('card shows text range when min equals max', () => {
      const card = TrackerCard.create(makeTracker({ minPrice: 100, maxPrice: 100, currentPrice: 100 }));
      const rangeEl = card.querySelector('.tracker-card-range');
      expect(rangeEl).not.toBeNull();
      expect(rangeEl.textContent).toContain('100');
    });
  });

  // ─── Price direction indicator (Req 4.3, 4.4) ──────────────────

  describe('price direction indicator', () => {
    test('shows green indicator when price decreased', () => {
      const card = TrackerCard.create(makeTracker({ currentPrice: 80, initialPrice: 100 }));
      const dirEl = card.querySelector('.tracker-card-direction');
      expect(dirEl).not.toBeNull();
      expect(dirEl.classList.contains('price-down')).toBe(true);
      expect(dirEl.querySelector('svg')).not.toBeNull();
    });

    test('shows red indicator when price increased', () => {
      const card = TrackerCard.create(makeTracker({ currentPrice: 120, initialPrice: 100 }));
      const dirEl = card.querySelector('.tracker-card-direction');
      expect(dirEl).not.toBeNull();
      expect(dirEl.classList.contains('price-up')).toBe(true);
      expect(dirEl.querySelector('svg')).not.toBeNull();
    });

    test('shows neutral indicator when price unchanged', () => {
      const card = TrackerCard.create(makeTracker({ currentPrice: 100, initialPrice: 100 }));
      const dirEl = card.querySelector('.tracker-card-direction');
      expect(dirEl).not.toBeNull();
      expect(dirEl.classList.contains('price-neutral')).toBe(true);
      expect(dirEl.querySelector('svg')).not.toBeNull();
    });

    test('direction indicator has accessible label', () => {
      const card = TrackerCard.create(makeTracker({ currentPrice: 80, initialPrice: 100 }));
      const dirEl = card.querySelector('.tracker-card-direction');
      expect(dirEl.getAttribute('aria-label')).toBe('Price decreased');
    });

    test('card has price direction CSS class for gradient bar', () => {
      const downCard = TrackerCard.create(makeTracker({ currentPrice: 80, initialPrice: 100 }));
      expect(downCard.classList.contains('tracker-card-price-down')).toBe(true);

      const upCard = TrackerCard.create(makeTracker({ currentPrice: 120, initialPrice: 100 }));
      expect(upCard.classList.contains('tracker-card-price-up')).toBe(true);

      const neutralCard = TrackerCard.create(makeTracker({ currentPrice: 100, initialPrice: 100 }));
      expect(neutralCard.classList.contains('tracker-card-price-neutral')).toBe(true);
    });
  });

  // ─── Status indicator (Req 18.3, 18.5) ─────────────────────────

  describe('status indicator', () => {
    test.each([
      ['active', 'status-active'],
      ['updated', 'status-updated'],
      ['error', 'status-error'],
      ['paused', 'status-paused'],
    ])('shows correct indicator for status "%s"', (status, expectedClass) => {
      const card = TrackerCard.create(makeTracker({ status }));
      const dot = card.querySelector('.status-indicator');
      expect(dot).not.toBeNull();
      expect(dot.classList.contains(expectedClass)).toBe(true);
    });

    test('status indicator has accessible label', () => {
      const card = TrackerCard.create(makeTracker({ status: 'error' }));
      const dot = card.querySelector('.status-indicator');
      expect(dot.getAttribute('aria-label')).toBe('Status: Error');
    });

    test('paused card has paused CSS class', () => {
      const card = TrackerCard.create(makeTracker({ status: 'paused' }));
      expect(card.classList.contains('tracker-card-paused')).toBe(true);
    });

    test('updated card has updated CSS class', () => {
      const card = TrackerCard.create(makeTracker({ status: 'updated' }));
      expect(card.classList.contains('tracker-card-updated')).toBe(true);
    });

    test('error card has error CSS class', () => {
      const card = TrackerCard.create(makeTracker({ status: 'error' }));
      expect(card.classList.contains('tracker-card-error')).toBe(true);
    });
  });

  // ─── Auto-detected badge (Req 13.5) ────────────────────────────

  describe('auto-detected badge', () => {
    test('shows "A" badge when isAutoDetected is true', () => {
      const card = TrackerCard.create(makeTracker({ isAutoDetected: true }));
      const badge = card.querySelector('.badge-auto');
      expect(badge).not.toBeNull();
      expect(badge.querySelector('svg')).not.toBeNull();
    });

    test('does not show badge when isAutoDetected is false', () => {
      const card = TrackerCard.create(makeTracker({ isAutoDetected: false }));
      const badge = card.querySelector('.badge-auto');
      expect(badge).toBeNull();
    });

    test('badge has accessible label', () => {
      const card = TrackerCard.create(makeTracker({ isAutoDetected: true }));
      const badge = card.querySelector('.badge-auto');
      expect(badge.getAttribute('aria-label')).toBe('Auto-detected tracker');
    });
  });

  // ─── Content tracker (Req 15.4) ────────────────────────────────

  describe('content tracker', () => {
    test('displays text content instead of price for content trackers', () => {
      const card = TrackerCard.create(makeTracker({
        trackingType: 'content',
        currentContent: 'In Stock',
      }));
      const contentEl = card.querySelector('.tracker-card-content');
      expect(contentEl).not.toBeNull();
      expect(contentEl.textContent).toBe('In Stock');
    });

    test('does not show price row for content trackers', () => {
      const card = TrackerCard.create(makeTracker({
        trackingType: 'content',
        currentContent: 'Available',
      }));
      const priceRow = card.querySelector('.tracker-card-price-row');
      expect(priceRow).toBeNull();
    });

    test('does not show price range for content trackers', () => {
      const card = TrackerCard.create(makeTracker({
        trackingType: 'content',
        currentContent: 'Available',
      }));
      const range = card.querySelector('.tracker-card-range');
      const rangeBar = card.querySelector('.tracker-card-range-bar');
      expect(range).toBeNull();
      expect(rangeBar).toBeNull();
    });

    test('handles empty content gracefully', () => {
      const card = TrackerCard.create(makeTracker({
        trackingType: 'content',
        currentContent: '',
      }));
      const contentEl = card.querySelector('.tracker-card-content');
      expect(contentEl).not.toBeNull();
      expect(contentEl.textContent).toBe('');
    });
  });

  // ─── Accessibility ─────────────────────────────────────────────

  describe('accessibility', () => {
    test('card has role="listitem"', () => {
      const card = TrackerCard.create(makeTracker());
      expect(card.getAttribute('role')).toBe('listitem');
    });

    test('card has tabindex="0"', () => {
      const card = TrackerCard.create(makeTracker());
      expect(card.getAttribute('tabindex')).toBe('0');
    });

    test('card responds to Enter key', () => {
      const card = TrackerCard.create(makeTracker());
      const clickSpy = jest.fn();
      card.addEventListener('click', clickSpy);

      const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
      card.dispatchEvent(event);

      expect(clickSpy).toHaveBeenCalledTimes(1);
    });

    test('card responds to Space key', () => {
      const card = TrackerCard.create(makeTracker());
      const clickSpy = jest.fn();
      card.addEventListener('click', clickSpy);

      const event = new KeyboardEvent('keydown', { key: ' ', bubbles: true });
      card.dispatchEvent(event);

      expect(clickSpy).toHaveBeenCalledTimes(1);
    });
  });

  // ─── Edge cases ────────────────────────────────────────────────

  describe('edge cases', () => {
    test('handles missing imageUrl with placeholder', () => {
      const card = TrackerCard.create(makeTracker({ imageUrl: '' }));
      const img = card.querySelector('img');
      expect(img).toBeNull();
      const placeholder = card.querySelector('.tracker-card-img-placeholder');
      expect(placeholder).not.toBeNull();
      expect(placeholder.querySelector('svg')).not.toBeNull();
    });

    test('handles null imageUrl with placeholder', () => {
      const card = TrackerCard.create(makeTracker({ imageUrl: null }));
      const img = card.querySelector('img');
      expect(img).toBeNull();
      const placeholder = card.querySelector('.tracker-card-img-placeholder');
      expect(placeholder).not.toBeNull();
    });

    test('truncates very long product names via CSS class', () => {
      const longName = 'A'.repeat(300);
      const card = TrackerCard.create(makeTracker({ productName: longName }));
      const nameEl = card.querySelector('.tracker-card-name');
      // Uses CSS multi-line truncation (-webkit-line-clamp) instead of text-truncate
      expect(nameEl).not.toBeNull();
      expect(nameEl.textContent).toBe(longName);
      expect(nameEl.getAttribute('title')).toBe(longName);
    });

    test('escapes HTML in product name', () => {
      const card = TrackerCard.create(makeTracker({ productName: '<script>alert("xss")</script>' }));
      const nameEl = card.querySelector('.tracker-card-name');
      expect(nameEl.innerHTML).not.toContain('<script>');
      expect(nameEl.textContent).toContain('<script>');
    });

    test('handles invalid pageUrl gracefully', () => {
      const card = TrackerCard.create(makeTracker({ pageUrl: 'not-a-url' }));
      expect(card.textContent).toContain('not-a-url');
    });

    test('stores tracker id in dataset', () => {
      const card = TrackerCard.create(makeTracker({ id: 'my-tracker-42' }));
      expect(card.dataset.trackerId).toBe('my-tracker-42');
    });
  });

  // ─── Sparkline ──────────────────────────────────────────────

  describe('sparkline', () => {
    test('price tracker card has sparkline placeholder', () => {
      const card = TrackerCard.create(makeTracker({ id: 'spark-1' }));
      const sparkline = card.querySelector('.tracker-card-sparkline');
      expect(sparkline).not.toBeNull();
      expect(sparkline.getAttribute('data-tracker-id')).toBe('spark-1');
    });

    test('content tracker card does not have sparkline placeholder', () => {
      const card = TrackerCard.create(makeTracker({ trackingType: 'content' }));
      const sparkline = card.querySelector('.tracker-card-sparkline');
      expect(sparkline).toBeNull();
    });

    test('renderSparkline creates SVG polyline', () => {
      const container = document.createElement('div');
      TrackerCard.renderSparkline(container, [100, 90, 95, 80, 85]);
      const svg = container.querySelector('svg');
      expect(svg).not.toBeNull();
      const polyline = svg.querySelector('polyline');
      expect(polyline).not.toBeNull();
    });

    test('renderSparkline uses green for price decrease', () => {
      const container = document.createElement('div');
      TrackerCard.renderSparkline(container, [100, 90]);
      const polyline = container.querySelector('polyline');
      expect(polyline.getAttribute('stroke')).toContain('green');
    });

    test('renderSparkline uses red for price increase', () => {
      const container = document.createElement('div');
      TrackerCard.renderSparkline(container, [90, 100]);
      const polyline = container.querySelector('polyline');
      expect(polyline.getAttribute('stroke')).toContain('red');
    });

    test('renderSparkline does nothing with less than 2 prices', () => {
      const container = document.createElement('div');
      TrackerCard.renderSparkline(container, [100]);
      expect(container.innerHTML).toBe('');
    });

    test('renderSparkline does nothing with null container', () => {
      expect(() => TrackerCard.renderSparkline(null, [100, 90])).not.toThrow();
    });
  });

  // ─── Helper functions ──────────────────────────────────────────

  describe('helper functions', () => {
    test('extractDomain extracts hostname', () => {
      expect(TrackerCard.extractDomain('https://www.example.com/path')).toBe('www.example.com');
      expect(TrackerCard.extractDomain('http://shop.test.org:8080/item')).toBe('shop.test.org');
    });

    test('extractDomain returns input for invalid URL', () => {
      expect(TrackerCard.extractDomain('invalid')).toBe('invalid');
      expect(TrackerCard.extractDomain('')).toBe('');
    });

    test('formatPrice formats numbers', () => {
      expect(TrackerCard.formatPrice(42)).toBeTruthy();
      expect(TrackerCard.formatPrice(null)).toBe('—');
      expect(TrackerCard.formatPrice(undefined)).toBe('—');
    });

    test('escapeHtml escapes special characters', () => {
      expect(TrackerCard.escapeHtml('<b>bold</b>')).toBe('&lt;b&gt;bold&lt;/b&gt;');
      expect(TrackerCard.escapeHtml('a & b')).toBe('a &amp; b');
      expect(TrackerCard.escapeHtml(null)).toBe('');
      expect(TrackerCard.escapeHtml(undefined)).toBe('');
    });

    test('getPriceDirection returns correct direction', () => {
      expect(TrackerCard.getPriceDirection(80, 100)).toBe('down');
      expect(TrackerCard.getPriceDirection(120, 100)).toBe('up');
      expect(TrackerCard.getPriceDirection(100, 100)).toBe('neutral');
      expect(TrackerCard.getPriceDirection(null, 100)).toBe('neutral');
      expect(TrackerCard.getPriceDirection(100, null)).toBe('neutral');
    });
  });
});
