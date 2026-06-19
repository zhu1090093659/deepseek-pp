import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  isValidNavigationUrl,
  PRIVILEGED_PROTOCOLS,
} = require('../desktop/navigation-guard.cjs') as {
  isValidNavigationUrl: (url: unknown) => boolean;
  PRIVILEGED_PROTOCOLS: Set<string>;
};

describe('isValidNavigationUrl', () => {
  it('accepts http URLs', () => {
    expect(isValidNavigationUrl('http://example.com')).toBe(true);
  });

  it('accepts https URLs', () => {
    expect(isValidNavigationUrl('https://chat.deepseek.com')).toBe(true);
    expect(isValidNavigationUrl('https://sub.domain.example/path?q=1#hash')).toBe(true);
  });

  it('rejects file: protocol', () => {
    expect(isValidNavigationUrl('file:///C:/Windows/System32/evil.exe')).toBe(false);
    expect(isValidNavigationUrl('file:///etc/passwd')).toBe(false);
  });

  it('rejects chrome: protocol', () => {
    expect(isValidNavigationUrl('chrome://settings')).toBe(false);
    expect(isValidNavigationUrl('chrome://version')).toBe(false);
  });

  it('rejects chrome-extension: protocol', () => {
    expect(isValidNavigationUrl('chrome-extension://abc123/page.html')).toBe(false);
  });

  it('rejects electron: protocol', () => {
    expect(isValidNavigationUrl('electron://something')).toBe(false);
  });

  it('rejects dppasset: protocol', () => {
    expect(isValidNavigationUrl('dppasset://asset/sidepanel.html')).toBe(false);
  });

  it('rejects about: protocol', () => {
    expect(isValidNavigationUrl('about:blank')).toBe(false);
  });

  it('rejects data: protocol', () => {
    expect(isValidNavigationUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
  });

  it('rejects javascript: protocol', () => {
    expect(isValidNavigationUrl('javascript:alert(1)')).toBe(false);
  });

  it('rejects empty / non-string inputs', () => {
    expect(isValidNavigationUrl('')).toBe(false);
    expect(isValidNavigationUrl(null)).toBe(false);
    expect(isValidNavigationUrl(undefined)).toBe(false);
    expect(isValidNavigationUrl(42)).toBe(false);
    expect(isValidNavigationUrl({})).toBe(false);
  });

  it('rejects malformed URLs', () => {
    expect(isValidNavigationUrl('not-a-url')).toBe(false);
    expect(isValidNavigationUrl('htt://bad')).toBe(false);
  });

  it('rejects protocol-relative URLs that could bypass scheme checks', () => {
    // Protocol-relative URLs (//evil.com/path) are typically resolved against
    // the current page's origin, which could be used to smuggle a file:// or
    // other privileged scheme via the base URL. We reject them because
    // new URL('//evil.com') without a base throws.
    expect(isValidNavigationUrl('//evil.com/payload')).toBe(false);
  });
});

describe('PRIVILEGED_PROTOCOLS', () => {
  it('contains all required protocols', () => {
    const required = ['file:', 'chrome:', 'chrome-extension:', 'electron:', 'dppasset:', 'about:', 'data:', 'javascript:'];
    for (const proto of required) {
      expect(PRIVILEGED_PROTOCOLS.has(proto)).toBe(true);
    }
  });
});
