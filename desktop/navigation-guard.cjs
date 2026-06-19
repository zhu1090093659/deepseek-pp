'use strict';

/**
 * Navigation security guard — pure, unit-tested by tests/desktop-navigation-guard.test.ts.
 *
 * PRIVILEGED_PROTOCOLS are schemes that must never be loaded by controlled tabs
 * or reachable from the chat window. The isBrowserNavigation whitelist ensures
 * only http/https navigations proceed through the will-navigate handler.
 */

const PRIVILEGED_PROTOCOLS = new Set([
  'file:',
  'chrome:',
  'chrome-extension:',
  'electron:',
  'dppasset:',
  'about:',
  'data:',
  'javascript:',
]);

/**
 * Returns true if `url` is a safe http/https URL suitable for a browser tab.
 * Rejects privileged protocols and malformed URLs.
 */
function isValidNavigationUrl(url) {
  if (typeof url !== 'string' || url.length === 0) return false;
  try {
    const parsed = new URL(url);
    if (PRIVILEGED_PROTOCOLS.has(parsed.protocol)) return false;
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

Object.defineProperty(exports, '__esModule', { value: true });
exports.PRIVILEGED_PROTOCOLS = PRIVILEGED_PROTOCOLS;
exports.isValidNavigationUrl = isValidNavigationUrl;
