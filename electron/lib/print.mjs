// Print pipeline helpers. Pure functions so they are fully unit-testable
// without a GUI; the Electron main process wires them to real windows.

export const PRINT_PAGE_SIZES = ['A4', 'A5', 'Letter', 'Legal', 'Receipt80'];

// 80 mm thermal receipt width with a tall page so long lists paginate.
export const RECEIPT_PAGE = { width: 80000, height: 200000 };

const BLOCKED_ACTIVE = /<\s*\/?\s*script\b|<iframe\b|<object\b|<embed\b|javascript:|src\s*=\s*['"]https?:/i;

export function normalizePageSize(name) {
  const value = String(name || '').trim();
  if (value === 'Receipt' || value === 'Receipt80' || value === '80mm') return 'Receipt80';
  return PRINT_PAGE_SIZES.includes(value) ? value : 'A4';
}

export function pageSizeForPrint(name) {
  const size = normalizePageSize(name);
  return size === 'Receipt80' ? { ...RECEIPT_PAGE } : size;
}

export function pageSizeForPdf(name) {
  return pageSizeForPrint(name);
}

export function validatePrintHtml(html, { maxBytes = 30 * 1024 * 1024 } = {}) {
  if (typeof html !== 'string' || !html.trim()) return { ok: false, error: 'Print document is empty.' };
  if (html.length > maxBytes) return { ok: false, error: 'Print document is too large.' };
  if (BLOCKED_ACTIVE.test(html)) return { ok: false, error: 'Print document contains a blocked active or remote resource.' };
  return { ok: true };
}

// Isolated wrapper used for the hidden print/pdf window. No scripts, no remote
// content; images only from data:/blob: (clinic logo is a data: URL).
export function buildIsolatedHtml(bodyHtml) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:;"><style>html,body{background:#fff;color:#111}body{margin:0}</style></head><body>${bodyHtml}</body></html>`;
}

const INVALID_FILENAME = /[\\/:*?"<>|]/g;

export function safePdfFilename(title) {
  const base = String(title || 'document')
    .replace(INVALID_FILENAME, ' ')
    .replace(/[\p{C}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'document';
  return `${base}.pdf`;
}
