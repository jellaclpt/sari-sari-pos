// Inline stroke icons (24×24 grid) for the admin screens.
const PATHS = {
  dashboard: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>',
  tag: '<path d="M3.5 12V4.5a1 1 0 0 1 1-1H12l8.5 8.5-8.5 8.5z"/><circle cx="8" cy="8" r="1.4"/>',
  receipt: '<path d="M5.5 3h13v18l-2.2-1.4-2.2 1.4-2.1-1.4-2.1 1.4-2.2-1.4-2.2 1.4z"/><path d="M9 8h6M9 11.5h6M9 15h3.5"/>',
  clipboard: '<rect x="5" y="4.5" width="14" height="16.5" rx="2"/><path d="M9 3h6v3.5H9z"/><path d="M9 11.5h6M9 15.5h4"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.3a6.5 6.5 0 0 1 3.5 5.7"/>',
  logout: '<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/><path d="M9 16l-4-4 4-4M5 12h10"/>',
  download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 20h14"/>',
  upload: '<path d="M12 16V5M7.5 9.5 12 5l4.5 4.5M5 20h14"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
  filter: '<path d="M4 5h16l-6 7.5V19l-4-2v-4.5z"/>',
  check: '<path d="M5 12.5 9.5 17 19 7.5"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  printer: '<path d="M7 9V3.5h10V9"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 14h10v6.5H7z"/>',
  refund: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>',
  shirt: '<path d="M8 3l4 3 4-3 5 3-2 5-3-1v11H8V10l-3 1-2-5z"/><path d="M12 6v15"/>',
  tee: '<path d="M8.5 3c.9 1.4 2 2 3.5 2s2.6-.6 3.5-2l5 3-2 4-3-1v12h-7V9l-3 1-2-4z"/>',
  sleeveless: '<path d="M9 3c0 2 1.2 3 3 3s3-1 3-3h2c0 3 1 4 2 5v13H5V8c1-1 2-2 2-5z"/>',
  jacket: '<path d="M9 3l3 2.5L15 3l5 3v15h-5.5V12h-5v9H4V6z"/><path d="M12 5.5V12"/>',
  pants: '<path d="M7 3h10l2 18h-5l-2-11-2 11H5z"/><path d="M7 6.5h10"/>',
  shorts: '<path d="M6 5h12l2 12h-6l-2-5-2 5H4z"/><path d="M6 8h12"/>',
  cap: '<path d="M4 15.5a8 8 0 0 1 16 0z"/><path d="M4 15.5h16.5a1.5 1.5 0 0 1-1.5 2H6.5"/><path d="M12 7.5v-1"/>',
  bag: '<path d="M5 8h14l-1 13H6z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
  hanger: '<path d="M10 6.5a2 2 0 1 1 2 2v1.5"/><path d="M12 10 3.5 16a1 1 0 0 0 .6 1.8h15.8a1 1 0 0 0 .6-1.8z"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 21a7.5 7.5 0 0 1 15 0"/>',
  lock: '<rect x="4.5" y="10.5" width="15" height="10.5" rx="2"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/>',
  store: '<path d="M4 9.5 5.5 4h13L20 9.5"/><path d="M4 9.5a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0"/><path d="M5 11.5V20h14v-8.5M10 20v-5h4v5"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m10.8 12.2 8.7-8.7M16 7l2.5 2.5M18.5 4.5 21 7"/>',
  arrowUp: '<path d="M12 19V5M6.5 10.5 12 5l5.5 5.5"/>',
  arrowDown: '<path d="M12 5v14M6.5 13.5 12 19l5.5-5.5"/>',
};

function icon(name, size = 18, extraClass = '') {
  const paths = PATHS[name] || PATHS.tag;
  return `<svg class="icon ${extraClass}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

// Picks a garment icon from the product's name and category, for products
// without a photo.
function productIconName(...texts) {
  const t = texts.filter(Boolean).join(' ').toLowerCase();
  if (/jacket|coat|hoodie|blazer|cardigan|outerwear/.test(t)) return 'jacket';
  if (/sleeveless|tank|camisole/.test(t)) return 'sleeveless';
  if (/jort|short/.test(t)) return 'shorts';
  if (/pant|trouser|jean|slack|skirt|bottom|wide-leg/.test(t)) return 'pants';
  if (/cap|hat|beanie/.test(t)) return 'cap';
  if (/bag|tote|pouch|wallet/.test(t)) return 'bag';
  if (/collar|polo|button|oxford|blouse/.test(t)) return 'shirt';
  if (/tee|t-shirt|shirt|top|crop/.test(t)) return 'tee';
  return 'hanger';
}

module.exports = { icon, productIconName };
