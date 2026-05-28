import type {
  AstroConfig,
  AstroIntegration,
  AstroIntegrationLogger,
  RouteToHeaders,
} from 'astro';
import { writeFile } from 'node:fs/promises';

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

        const configuredHeaders = extractConfiguredHeaders(_config, logger);
        const routeHeaders = extractRouteHeaders(_routeToHeaders);

        const combined = Object.entries(
          Object.groupBy(
            [...routeHeaders, ...configuredHeaders],
            ({ pathname }) => pathname,
          ),
        )
          // Filter out blocklistPaths
          .filter(
            ([pathname]) =>
              !_options!.blocklistPaths.some((pattern) =>
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
                      !_options?.blocklistHeaders.some((pattern) =>
                        typeof pattern === 'string'
                          ? pattern.toLowerCase() === key.toLowerCase()
                          : pattern.test(key),
                      ),
                  ),
              ] as const,
          )
          .filter(([pathname, headers]) => pathname && headers?.length);

        // Create text content for output file
        const text = combined
          .map(
            ([pathname, headers]) =>
              `${pathname}\n${headers!.map(({ key, value }) => `  ${key}: ${value}`).join('\n')}`,
          )
          .join('\n\n');

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

type PathedHeaders = {
  pathname: string;
  headers: {
    key: string;
    value: string;
  }[];
};

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

function extractConfiguredHeaders(
  _config: AstroConfig,
  logger: AstroIntegrationLogger,
): PathedHeaders[] {
  return _config.server.headers
    ? Object.entries(_config.server.headers).flatMap(([pattern, headers]) => {
        // { 'X-Frame-Options': 'DENY' }
        if (typeof headers === 'string') {
          return {
            pathname: '/*',
            headers: [{ key: pattern, value: headers }],
          };
          // { '/*': ['X-Frame-Options: DENY', 'X-Content-Type-Options: nosniff']}
        } else if (
          Array.isArray(headers) &&
          headers.every((h) => typeof h === 'string')
        ) {
          return {
            pathname: pattern,
            headers: headers.map((h) => ({
              key: h.split(':')[0].trim(),
              value: h.split(':')[1].trim(),
            })),
          };
        }

        // { '/*': { 'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff' } }
        else if (typeof headers === 'object' && headers !== null) {
          return {
            pathname: pattern,
            headers: Object.entries(headers!).map(([key, value]) => ({
              key: key.toLowerCase(),
              value,
            })),
          };
        } else {
          logger.warn(
            `Unsupported header format for pattern "${pattern}". Skipping these headers. Expected a string, an array of strings, or an object.`,
          );
          return { pathname: pattern, headers: [] };
        }
      })
    : [];
}
