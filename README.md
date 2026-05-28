# astro-headers-file

Astro integration that uses your existing configuration to write a static headers file for platforms like Cloudflare Pages, Netlify and Vercel, and others.

Picks up your existing headers configuration, as well as your CSP directives, and generates a static headers file in the output directory. The generated file is compatible with the format expected by platforms like Cloudflare Pages, Netlify and Vercel.

## Installation

```bash
npm install astro-headers-file -D

# pnpm
pnpm add astro-headers-file -D

# yarn
yarn add astro-headers-file -D
```

## Usage

Add the integration to your `astro.config.ts`:

```ts
import { defineConfig } from 'astro/config';
import headersFile from 'astro-headers-file';

export default defineConfig({
  integrations: [headersFile()],
  security: {
    // Add content-security-policy directives with hashes
    csp: true,
  },
  server: {
    headers: {
      // Specify per path
      '/*': [
        'X-Frame-Options: DENY',
        'X-Content-Type-Options: nosniff',
        'Cross-Origin-Opener-Policy: same-origin',
        'Cross-Origin-Resource-Policy: same-origin',
        'Referrer-Policy: same-origin',
        'Cache-Control: public, max-age=60, must-revalidate',
      ],
      '/_astro/*': ['Cache-Control: public, max-age=31536000, immutable'],
      '/': ['Cache-Control: public, max-age=0, must-revalidate'],

      // Or for all paths (uses `/*`)
      'X-Custom-Header': 'My custom value',
    },
  },
});
```

After running `astro build`, a headers file will be generated in the output directory with the configured headers and CSP directives:

```
/
  content-security-policy: script-src 'self' '<sha256-hashes>'; style-src 'self' '<sha256-hashes>';
  Cache-Control: public, max-age=0, must-revalidate

/*
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Resource-Policy: same-origin
  Referrer-Policy: same-origin
  Cache-Control: public, max-age=60, must-revalidate
  X-Custom-Header: My custom value

/_astro/*
  Cache-Control: public, max-age=31536000, immutable
```


## Options

The integration accepts the following options:

| Option             | Type                 | Default                                               | Description                                                                                                                                                      |
| ------------------ | -------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `filename`         | string               | `_headers`                                            | Filename for the generated headers file. Relative to the output directory.                                                                                       |
| `blocklistHeaders` | (string \| RegExp)[] | `['content-length', 'content-type', 'last-modified']` | Blocklist of headers to exclude from the generated headers file. Can be either a string (exact match) or a RegExp (pattern match). Matching is case-insensitive. |
| `blocklistPaths`   | (string \| RegExp)[] | `[]`                                                  | Blocklist of paths to exclude from the generated headers file. Can be either a string (exact match) or a RegExp (pattern match).                                 |

## Does this work with...?

- Cloudflare/Vercel/Netlify? Yes! And any other platform that supports a static headers file in the same format
- Astro [`security.csp`](https://docs.astro.build/en/reference/configuration-reference/#securitycsp)? Yes! The integration adds all configured CSP directives to the generated headers file.
- Custom headers in `astro.config.mjs`? Yes! Any custom headers you configure in `astro.config.mjs` will also be included in the generated headers file.
- `@astrojs/node` adapter? No, the adapter will handle headers at runtime by itself.
- `@astrojs/cloudflare` adapter? Untested.

## Why not use...?

Alternatives exist, and are great. But this package has some advantages over...:

- [astro-static-headers](https://github.com/abemedia/astro-static-headers): only works with specific adapters, not with static output. This integration has no need to add a separate adapter for your platform.
- [astro-cloudflare-pages-headers](https://github.com/martinsilha/astro-cloudflare-pages-headers): works mostly the same, but CSP directives do not use the Astro CSP configuration. With this integration you can use the standard Astro CSP configuration and have the directives automatically included in the generated headers file, with support for hashes and nonces.
