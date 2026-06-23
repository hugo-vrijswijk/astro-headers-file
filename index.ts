import type {
  AstroConfig,
  AstroIntegration,
  AstroIntegrationLogger,
  RouteToHeaders,
} from 'astro';
import type { OutgoingHttpHeaders } from 'node:http';
import { writeFile } from 'node:fs/promises';

/**
 * Headers for a single path pattern. Can be:
 * - a single `'Name: Value'` string,
 * - an array of `'Name: Value'` strings, or
 * - an object of header name/value pairs.
 */
export type HeaderValue = string | string[] | Record<string, string>;

export type HeadersFileOptions = {
  /**
   * Filename for the generated headers file. Relative to the output directory.
   *
   * @default '_headers'
   */
  filename: string;

  /**
   * Blocklist of headers to exclude from the generated headers file. Can be either a string (exact match) or a RegExp (pattern match). Matching is case-insensitive.
   *
   * `'content-security-policy'` is included if CSP is not configured in Astro.
   *
   * @default ['content-length', 'content-type', 'last-modified']
   */
  blocklistHeaders: (string | RegExp)[];

  /**
   * Blocklist of paths to exclude from the generated headers file. Can be either a string (exact match) or a RegExp (pattern match).
   *
   * @default []
   */
  blocklistPaths: (string | RegExp)[];

  /**
   * Path-based headers to include in the generated headers file. Keys are path patterns (e.g. `'/*'`, `'/_astro/*'`, `'/'`) and values are the headers for that path.
   *
   * Use this instead of Astro's `server.headers` for path-specific headers
   *
   * @default {}
   */
  headers: Record<string, HeaderValue>;
};

export default function astroHeadersFile(
  options?: Partial<HeadersFileOptions>,
): AstroIntegration {
  let _routeToHeaders: RouteToHeaders | undefined = undefined;
  let _config: AstroConfig | undefined = undefined;

  let _options: HeadersFileOptions | undefined = undefined;

  return {
    name: 'astro-headers-file',
    hooks: {
      'astro:config:done': ({ setAdapter, config }) => {
        _config = config;
        _options = {
          blocklistHeaders: [
            'content-length',
            'content-type',
            'last-modified',
            ...(_config.security.csp ? [] : ['content-security-policy']),
          ],
          blocklistPaths: [],
          filename: '_headers',
          headers: {},
          ...options,
        };

        if (config.security.csp) {
          // Needed for Astro to output generated CSP directives
          setAdapter({
            name: 'astro-headers-file',
            entrypointResolution: 'auto',
            adapterFeatures: {
              buildOutput: 'static',
              staticHeaders: true,
            },
            supportedAstroFeatures: {
              envGetSecret: 'stable',
              hybridOutput: 'stable',
              i18nDomains: 'stable',
              serverOutput: 'stable',
              sharpImageService: 'stable',
              staticOutput: 'stable',
            },
          });
        }
      },

      'astro:build:generated': ({ routeToHeaders }) => {
        _routeToHeaders = routeToHeaders;
      },

      'astro:build:done': async ({ logger, dir: outDir }) => {
        if (!_options) {
          logger.error('Options not set. Skipping writing headers file.');
          return;
        }
        if (!_config) {
          logger.error(
            'Astro config not found. Skipping writing headers file.',
          );
          return;
        }
        if (!_routeToHeaders) {
          logger.error(
            'Route to headers mapping not found. Skipping writing headers file.',
          );
          return;
        }

        const pathedHeaders = [
          ...extractRouteHeaders(_routeToHeaders),
          ...parseOptionHeaders(_options.headers, logger),
          ...parseServerHeaders(_config.server.headers),
        ];

        const text = buildHeadersText(pathedHeaders, _options);

        if (text.trim().length === 0) {
          logger.info('No headers to write. Skipping writing headers file.');
          return;
        } else {
          const headersFileUrl = new URL(_options.filename, outDir);

          await writeFile(headersFileUrl, text, 'utf-8');
          logger.info(`Wrote static headers to ${headersFileUrl}`);
        }
      },
    },
  };
}

export type PathedHeaders = {
  pathname: string;
  headers: {
    key: string;
    value: string;
  }[];
};

/**
 * Split a single `'Name: Value'` string, preserving colons in the value.
 * Returns `undefined` for a line without a colon separator.
 */
function splitHeaderLine(
  line: string,
): { key: string; value: string } | undefined {
  const separator = line.indexOf(':');
  if (separator === -1) {
    return undefined;
  }
  return {
    key: line.slice(0, separator).trim(),
    value: line.slice(separator + 1).trim(),
  };
}

/**
 * Parse `'Name: Value'` lines, warning on and skipping any line that lacks a
 * colon separator rather than emitting a malformed header.
 */
function parseHeaderLines(
  lines: string[],
  pathname: string,
  logger: Pick<AstroIntegrationLogger, 'warn'>,
): { key: string; value: string }[] {
  return lines.flatMap((line) => {
    const header = splitHeaderLine(line);
    if (!header) {
      logger.warn(
        `Ignoring malformed header "${line}" for pattern "${pathname}". Expected a "Name: Value" string.`,
      );
      return [];
    }
    return [header];
  });
}

function extractRouteHeaders(_routeToHeaders: RouteToHeaders): PathedHeaders[] {
  return Array.from(_routeToHeaders.entries()).map(
    ([pathname, { headers }]) => ({
      pathname,
      headers: Array.from(headers.entries()).map(([key, value]) => ({
        key,
        value,
      })),
    }),
  );
}

/**
 * Parse the path-keyed `headers` integration option into per-path headers. Keys
 * are path patterns; values are a single `'Name: Value'` string, an array of
 * such strings, or an object of name/value pairs.
 */
export function parseOptionHeaders(
  headers: Record<string, HeaderValue>,
  logger: Pick<AstroIntegrationLogger, 'warn'>,
): PathedHeaders[] {
  return Object.entries(headers).map(([pathname, value]) => {
    // '/': 'Cache-Control: public, max-age=0'
    if (typeof value === 'string') {
      return { pathname, headers: parseHeaderLines([value], pathname, logger) };
    }

    // '/*': ['X-Frame-Options: DENY', 'X-Content-Type-Options: nosniff']
    if (Array.isArray(value)) {
      return { pathname, headers: parseHeaderLines(value, pathname, logger) };
    }

    // '/*': { 'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff' }
    if (typeof value === 'object' && value !== null) {
      return {
        pathname,
        headers: Object.entries(value).map(([key, v]) => ({
          key: key.trim(),
          value: v,
        })),
      };
    }

    logger.warn(
      `Unsupported header format for pattern "${pathname}". Skipping these headers. Expected a string, an array of strings, or an object.`,
    );
    return { pathname, headers: [] };
  });
}

/**
 * Parse Astro's `server.headers` (a flat map of HTTP header names to values
 * applied to every response) into headers under the `/*` path. Array values
 * become one header line each; numeric values are stringified.
 */
export function parseServerHeaders(
  serverHeaders: OutgoingHttpHeaders | undefined,
): PathedHeaders[] {
  if (!serverHeaders) {
    return [];
  }

  const headers = Object.entries(serverHeaders).flatMap(([key, value]) => {
    if (value === undefined) {
      return [];
    }
    const values = Array.isArray(value) ? value : [value];
    return values.map((v) => ({ key, value: String(v) }));
  });

  return headers.length > 0 ? [{ pathname: '/*', headers }] : [];
}

/**
 * Combine per-path headers into the `_headers` file text, grouping by path and
 * applying the configured path and header blocklists.
 */
export function buildHeadersText(
  pathedHeaders: PathedHeaders[],
  options: Pick<HeadersFileOptions, 'blocklistHeaders' | 'blocklistPaths'>,
): string {
  return (
    Object.entries(Object.groupBy(pathedHeaders, ({ pathname }) => pathname))
      // Filter out blocklistPaths
      .filter(
        ([pathname]) =>
          !options.blocklistPaths.some((pattern) =>
            typeof pattern === 'string'
              ? pattern === pathname
              : pattern.test(pathname),
          ),
      )
      // Filter out blocklistHeaders
      .map(
        ([pathname, headers]) =>
          [
            pathname.trim(),
            headers
              ?.flatMap(({ headers }) => headers)
              .filter(
                ({ key }) =>
                  !options.blocklistHeaders.some((pattern) =>
                    typeof pattern === 'string'
                      ? pattern.toLowerCase() === key.toLowerCase()
                      : pattern.test(key),
                  ),
              ),
          ] as const,
      )
      .filter(([pathname, headers]) => pathname && headers?.length)
      .map(
        ([pathname, headers]) =>
          `${pathname}\n${headers!.map(({ key, value }) => `  ${key}: ${value}`).join('\n')}`,
      )
      .join('\n\n')
  );
}
