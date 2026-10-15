/**
 * CultureRisk AI — tiny DOM helpers. All dynamic text goes through esc().
 */

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

/** Escape untrusted strings before HTML interpolation. */
export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 0–1 → "87%"; null → "—". */
export const pct = (v) => (typeof v === 'number' ? `${Math.round(v * 100)}%` : '—');

/** Bar width (0–100) from a 0–1 value. */
export const barWidth = (v) => (typeof v === 'number' ? Math.max(0, Math.min(100, v * 100)).toFixed(1) : '0');

export const DOMAIN_LABELS = {
  'urn:entity:brand': 'Brand Partnerships',
  'urn:entity:artist': 'Soundtrack & Talent',
  'urn:entity:destination': 'Location & Tourism',
  'urn:entity:tv_show': 'Streaming Adjacency',
  'urn:entity:podcast': 'Podcast Media Buys',
};


export function verdictClass(verdict) {
  if (!verdict) return '';
  if (verdict === 'GREENLIGHT') return 'v-go';
  if (verdict.startsWith('CONDITIONAL')) return 'v-cond';
  if (verdict === 'REWORK') return 'v-rework';
  return 'v-stop';
}
