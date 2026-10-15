/**
 * CultureRisk AI — HTTP helpers shared by every Netlify function.
 */

'use strict';

const BASE_HEADERS = Object.freeze({
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
});

/** Build a Netlify (v1 handler) JSON response. */
function json(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: { ...BASE_HEADERS, ...extraHeaders },
    body: JSON.stringify(body),
  };
}

function methodNotAllowed(allowed) {
  return json(
    405,
    { error: 'method_not_allowed', message: `Only ${allowed} is supported.` },
    { Allow: allowed },
  );
}

function badRequest(message) {
  return json(400, { error: 'invalid_request', message });
}

/**
 * Parse a JSON request body with a hard size cap.
 * @returns {{ok: true, value: any} | {ok: false, response: object}}
 */
function parseJsonBody(event, maxBytes) {
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body || '', 'base64').toString('utf8')
    : event.body || '';
  if (Buffer.byteLength(raw, 'utf8') > maxBytes) {
    return { ok: false, response: json(413, { error: 'payload_too_large', message: `Body exceeds ${maxBytes} bytes.` }) };
  }
  try {
    return { ok: true, value: raw ? JSON.parse(raw) : {} };
  } catch {
    return { ok: false, response: badRequest('Body must be valid JSON.') };
  }
}

/** Strip control characters, collapse whitespace, and bound length. Returns '' if unusable. */
function cleanText(raw, maxLength) {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

module.exports = { json, methodNotAllowed, badRequest, parseJsonBody, cleanText };
