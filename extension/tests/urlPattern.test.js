import assert from 'node:assert/strict';
import test from 'node:test';

import { matchesUrlPattern, parseUrlPattern } from '../src/shared/urlPattern.js';

test('infers glob URL patterns', () => {
    assert.equal(matchesUrlPattern('https://*.example.com/*', 'https://app.example.com/dashboard'), true);
    assert.equal(matchesUrlPattern('https://*.example.com/*', 'https://example.org/dashboard'), false);
    assert.equal(matchesUrlPattern('https://example.com/item/?', 'https://example.com/item/1'), true);
    assert.equal(matchesUrlPattern('https://example.com/item/?', 'https://example.com/item/12'), false);
});

test('infers slash-delimited regular expression patterns', () => {
    assert.equal(matchesUrlPattern('/^https:\\/\\/example\\.com\\//', 'https://example.com/page'), true);
    assert.equal(matchesUrlPattern('/^https:\\/\\/example\\.com\\//', 'https://example.org/page'), false);
    assert.equal(matchesUrlPattern('/EXAMPLE\\.com/i', 'https://example.com/page'), true);
});

test('accepts anchored regexes and bare domain globs', () => {
    assert.equal(matchesUrlPattern('^https:\\/\\/[^/]*google\\.[^/]+\\/.*$', 'https://www.google.com/search?q=test'), true);
    assert.equal(matchesUrlPattern('^https:\\/\\/[^/]*google\\.[^/]+\\/.*$', 'https://www.example.com/search'), false);
    assert.equal(matchesUrlPattern('*.com', 'https://www.google.com/search'), true);
    assert.equal(matchesUrlPattern('*.com', 'https://www.google.com.evil.test/'), false);
});

test('rejects empty patterns and invalid regular expression flags', () => {
    assert.throws(() => matchesUrlPattern('', ''), /cannot be empty/);
    assert.throws(() => matchesUrlPattern('/example/z', 'example'), /Invalid regular expression flags/);
});

test('parses regex and glob patterns', () => {
    assert.deepEqual(parseUrlPattern('/example/'), { type: 'regex', source: 'example', flags: '' });
    assert.deepEqual(parseUrlPattern('*example*'), { type: 'glob', source: '^.*example.*$', flags: '' });
});
