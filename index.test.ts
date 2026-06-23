import { describe, expect, test } from 'vitest';
import {
  buildHeadersText,
  parseOptionHeaders,
  parseServerHeaders,
  type PathedHeaders,
} from './index.ts';

const noopLogger = { warn: () => {} };

describe('parseOptionHeaders', () => {
  test('parses an array of "Name: Value" strings under its path', () => {
    const result = parseOptionHeaders(
      {
        '/*': ['X-Frame-Options: DENY', 'X-Content-Type-Options: nosniff'],
      },
      noopLogger,
    );

    expect(result).toEqual([
      {
        pathname: '/*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
        ],
      },
    ]);
  });

  test('parses a single "Name: Value" string', () => {
    const result = parseOptionHeaders(
      { '/': 'Cache-Control: public, max-age=0' },
      noopLogger,
    );

    expect(result).toEqual([
      {
        pathname: '/',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=0' }],
      },
    ]);
  });

  test('parses an object of name/value pairs', () => {
    const result = parseOptionHeaders(
      {
        '/_astro/*': { 'Cache-Control': 'public, max-age=31536000, immutable' },
      },
      noopLogger,
    );

    expect(result).toEqual([
      {
        pathname: '/_astro/*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
    ]);
  });

  test('warns on and skips a line without a colon separator', () => {
    const warnings: string[] = [];
    const result = parseOptionHeaders(
      { '/*': ['X-Frame-Options DENY', 'X-Content-Type-Options: nosniff'] },
      { warn: (msg) => warnings.push(msg) },
    );

    expect(result).toEqual([
      {
        pathname: '/*',
        headers: [{ key: 'X-Content-Type-Options', value: 'nosniff' }],
      },
    ]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('X-Frame-Options DENY');
  });

  test('keeps colons in the value intact', () => {
    const result = parseOptionHeaders(
      { '/*': ['Report-To: {"url": "https://example.com:8080/r"}'] },
      noopLogger,
    );

    expect(result[0].headers[0]).toEqual({
      key: 'Report-To',
      value: '{"url": "https://example.com:8080/r"}',
    });
  });

  test('returns empty array for empty options', () => {
    expect(parseOptionHeaders({}, noopLogger)).toEqual([]);
  });
});

describe('parseServerHeaders', () => {
  test('places every entry under /*', () => {
    const result = parseServerHeaders({ 'X-Custom-Header': 'My value' });

    expect(result).toEqual([
      {
        pathname: '/*',
        headers: [{ key: 'X-Custom-Header', value: 'My value' }],
      },
    ]);
  });

  test('expands array values into one header line each', () => {
    const result = parseServerHeaders({ 'Set-Cookie': ['a=1', 'b=2'] });

    expect(result[0].headers).toEqual([
      { key: 'Set-Cookie', value: 'a=1' },
      { key: 'Set-Cookie', value: 'b=2' },
    ]);
  });

  test('stringifies numeric values', () => {
    const result = parseServerHeaders({ 'X-Max-Age': 3600 });

    expect(result[0].headers).toEqual([{ key: 'X-Max-Age', value: '3600' }]);
  });

  test('returns empty array when undefined', () => {
    expect(parseServerHeaders(undefined)).toEqual([]);
  });
});

describe('buildHeadersText', () => {
  const options = { blocklistHeaders: [], blocklistPaths: [] };

  test('renders the _headers format', () => {
    const pathed: PathedHeaders[] = [
      {
        pathname: '/*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
        ],
      },
    ];

    expect(buildHeadersText(pathed, options)).toBe(
      '/*\n  X-Frame-Options: DENY\n  X-Content-Type-Options: nosniff',
    );
  });

  test('merges headers sharing the same path', () => {
    const pathed: PathedHeaders[] = [
      {
        pathname: '/',
        headers: [
          { key: 'content-security-policy', value: "default-src 'self'" },
        ],
      },
      {
        pathname: '/',
        headers: [{ key: 'Cache-Control', value: 'max-age=0' }],
      },
    ];

    expect(buildHeadersText(pathed, options)).toBe(
      "/\n  content-security-policy: default-src 'self'\n  Cache-Control: max-age=0",
    );
  });

  test('separates distinct paths with a blank line', () => {
    const pathed: PathedHeaders[] = [
      { pathname: '/*', headers: [{ key: 'X-A', value: '1' }] },
      { pathname: '/_astro/*', headers: [{ key: 'X-B', value: '2' }] },
    ];

    expect(buildHeadersText(pathed, options)).toBe(
      '/*\n  X-A: 1\n\n/_astro/*\n  X-B: 2',
    );
  });

  test('filters blocklisted headers case-insensitively (string)', () => {
    const pathed: PathedHeaders[] = [
      {
        pathname: '/*',
        headers: [
          { key: 'Content-Length', value: '42' },
          { key: 'X-Keep', value: 'yes' },
        ],
      },
    ];

    expect(
      buildHeadersText(pathed, {
        blocklistHeaders: ['content-length'],
        blocklistPaths: [],
      }),
    ).toBe('/*\n  X-Keep: yes');
  });

  test('filters blocklisted headers by RegExp', () => {
    const pathed: PathedHeaders[] = [
      {
        pathname: '/*',
        headers: [
          { key: 'X-Debug-Trace', value: '1' },
          { key: 'X-Keep', value: 'yes' },
        ],
      },
    ];

    expect(
      buildHeadersText(pathed, {
        blocklistHeaders: [/^x-debug/i],
        blocklistPaths: [],
      }),
    ).toBe('/*\n  X-Keep: yes');
  });

  test('filters blocklisted paths (string and RegExp)', () => {
    const pathed: PathedHeaders[] = [
      { pathname: '/secret', headers: [{ key: 'X-A', value: '1' }] },
      { pathname: '/admin/x', headers: [{ key: 'X-B', value: '2' }] },
      { pathname: '/*', headers: [{ key: 'X-C', value: '3' }] },
    ];

    expect(
      buildHeadersText(pathed, {
        blocklistHeaders: [],
        blocklistPaths: ['/secret', /^\/admin/],
      }),
    ).toBe('/*\n  X-C: 3');
  });

  test('omits paths whose headers are all filtered out', () => {
    const pathed: PathedHeaders[] = [
      { pathname: '/*', headers: [{ key: 'Content-Length', value: '42' }] },
      { pathname: '/', headers: [{ key: 'X-Keep', value: 'yes' }] },
    ];

    expect(
      buildHeadersText(pathed, {
        blocklistHeaders: ['content-length'],
        blocklistPaths: [],
      }),
    ).toBe('/\n  X-Keep: yes');
  });

  test('returns empty string when nothing remains', () => {
    expect(buildHeadersText([], options)).toBe('');
  });
});
