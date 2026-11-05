const crypto = require('crypto');

// Dates are grouped and shown in the store's local time, not the server's
// (Vercel runs in UTC).
const STORE_TZ = process.env.STORE_TIMEZONE || 'Asia/Manila';

function generateReceiptNo() {
  const now = new Date();
  const stamp = now.toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
  const rand = Math.floor(100 + Math.random() * 900);
  return `RCPT-${stamp}-${rand}`;
}

function peso(amount) {
  return `₱${Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Whole pesos for headline figures: ₱15,430
function pesoWhole(amount) {
  return `₱${Math.round(Number(amount)).toLocaleString('en-US')}`;
}

// Compact pesos for chart labels: 38.1k
function compact(amount) {
  const n = Number(amount);
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(Math.round(n));
}

function dateOnly(d) {
  return new Date(d).toISOString().slice(0, 10);
}

function formatInTz(d, options) {
  return new Intl.DateTimeFormat('en-US', { timeZone: STORE_TZ, ...options }).format(new Date(d));
}

// "Oct 19, 8:42 PM"
function shortDateTime(d) {
  return formatInTz(d, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// "Oct 19, 2026 8:42 PM"
function longDateTime(d) {
  return `${formatInTz(d, { month: 'short', day: 'numeric', year: 'numeric' })} ${timeOnly(d)}`;
}

// "Oct 19, 2026"
function longDate(d) {
  return formatInTz(d, { month: 'short', day: 'numeric', year: 'numeric' });
}

// "8:42 PM"
function timeOnly(d) {
  return formatInTz(d, { hour: 'numeric', minute: '2-digit' });
}

// Today's date in the store's timezone, as YYYY-MM-DD.
function storeToday(offsetDays = 0) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: STORE_TZ }).format(new Date());
  const d = new Date(`${parts}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

// Page numbers with gaps: [1, 2, 3, '…', 21]
function pageList(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = new Set([1, total, current - 1, current, current + 1]);
  if (current <= 3) [2, 3, 4].forEach((p) => pages.add(p));
  if (current >= total - 2) [total - 3, total - 2, total - 1].forEach((p) => pages.add(p));
  const sorted = [...pages].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
  const out = [];
  sorted.forEach((p, i) => {
    if (i && p - sorted[i - 1] > 1) out.push('…');
    out.push(p);
  });
  return out;
}

function csvCell(value) {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows) {
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

function initials(name) {
  return String(name || '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}

// "Jella Calupit" -> "Jella C."
function shortName(name) {
  const words = String(name || '').trim().split(/\s+/);
  return words.length > 1 ? `${words[0]} ${words[words.length - 1][0]}.` : words[0];
}

const PAYMENT_LABELS = { cash: 'Cash', gcash: 'GCash', card: 'Card' };

// Temporary password an admin reads out or messages to a staff member, so it
// skips look-alike characters (0/O, 1/l/I).
function tempPassword(length = 8) {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < length; i++) out += alphabet[crypto.randomInt(alphabet.length)];
  return out;
}

module.exports = {
  STORE_TZ,
  PAYMENT_LABELS,
  generateReceiptNo,
  peso,
  pesoWhole,
  compact,
  dateOnly,
  shortDateTime,
  longDateTime,
  longDate,
  timeOnly,
  storeToday,
  pageList,
  toCsv,
  initials,
  shortName,
  tempPassword,
};
