# Jev Plays Chess

A browser game lab where you play Chess and Connect Four against Jev 1.13 Free, while Jev independently plays a Chrome-Dino-style runner. Games stay on the device in SQLite persisted through IndexedDB.


![](./assets/demo.png)
## Stack

- React + TypeScript + Vite
- `chess.js` for legal moves, check, checkmate, and PGN
- `sql.js` for browser-side SQLite
- Web Crypto AES-GCM for encrypting the saved OpenCode API key
- Cloudflare Worker + Wrangler for the same-origin OpenCode proxy and static deployment
- classifier.dev as an optional keyless move provider

## Requirements

- Node.js 20+
- npm
- A Cloudflare account for deployment
- An OpenCode API key with access to `jev-1.13-free` when using OpenCode; classifier.dev does not require a key

## Local development

Install dependencies:

```bash
npm install
```

Start the Vite app:

```bash
npm run dev
```

Open the local URL printed by Vite. The Vite development server proxies `/api/jev` to OpenCode so the browser does not hit the upstream CORS restriction directly.

On first visit, choose **OpenCode** or **classifier.dev** in **Under the hood**. OpenCode asks for an API key, which is encrypted before being written into the local SQLite database. The provider can be changed later. The database and encryption key are browser-local; clearing site data removes them.

## Cloudflare deployment

Authenticate Wrangler once:

```bash
npx wrangler login
npx wrangler whoami
```

Build and deploy the Worker plus the Vite assets:

```bash
npm run deploy
```

The Worker handles `/api/jev` and forwards the request to:

```text
https://opencode.ai/zen/v1/systemone
```

All other requests are served from the built `dist/` assets. `wrangler.jsonc` contains the Worker name, entry point, compatibility date, and static asset binding.

To run the built Worker locally instead of Vite:

```bash
npm run cf:dev
```

This builds the app first, then starts Wrangler's local Worker runtime.

### GitHub Actions deployment

`.github/workflows/deploy.yml` deploys the `main` branch to Cloudflare after each push. It can also be started manually from the Actions tab.

Add these repository secrets before enabling the workflow:

- `CLOUDFLARE_API_TOKEN`: a Cloudflare API token with permission to edit Workers
- `CLOUDFLARE_ACCOUNT_ID`: the Cloudflare account ID that owns the Worker

The workflow installs dependencies with `npm ci`, runs the production build, and deploys with Wrangler.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start Vite development mode with the Jev proxy |
| `npm run build` | Type-check and create the production bundle |
| `npm run preview` | Preview the Vite production bundle locally |
| `npm run cf:dev` | Build and run the Cloudflare Worker locally |
| `npm run deploy` | Build and deploy to Cloudflare |

## How a move works

1. Chess and Connect Four validate moves locally before applying them.
2. The Dino runner sends Jev the approaching cactus and asks for `jump` or `wait`.
3. OpenCode requests go through `/api/jev` and the Worker forwards them to OpenCode Zen using the browser-provided API key.
4. classifier.dev receives legal actions in its classifier labels and returns one selected action.
5. The current game and provider decision data are saved locally.

Jev is a structured decision model, not a traditional chess engine. The app gives it only legal moves to choose from, so the browser remains responsible for chess rules.

## Data and security

Games never leave the browser unless their position is sent to Jev for the current move. The SQLite database is serialized into IndexedDB because browsers do not expose a general-purpose SQLite file API directly.

When OpenCode is selected, its API key is encrypted with a non-extractable AES-GCM Web Crypto key. This protects against plaintext storage, but it is not a complete security boundary: code running in the same origin, a malicious browser extension, or compromised device could still use the decrypted key when making a move. Do not use a valuable production credential in an untrusted deployment.

The Cloudflare Worker does not store the key. It forwards the `Authorization` header for the individual OpenCode request and does not log request bodies. classifier.dev is called directly from the browser and does not require an API key.

## Project layout

```text
src/
  App.tsx             Shared shell, tabs, and player settings
  games/chess/        Chess UI and rules
  games/connect-four/ Connect Four UI and rules
  games/dino/         Autonomous Chrome-Dino-style runner and rules
  styles.css          Visual design and responsive layout
  lib/jev.ts          Direct Jev request and response parsing
  lib/storage.ts      SQLite persistence and Web Crypto key storage
  main.tsx            React entry point
worker/
  index.ts            Same-origin Cloudflare proxy for `/api/jev`
wrangler.jsonc        Cloudflare Worker and asset configuration
vite.config.ts        Vite dev server and local Jev proxy
```

## Troubleshooting

### CORS error in local development

Use `npm run dev`, not a static file server. Vite owns the `/api/jev` development proxy.

### Wrangler authentication failed

Run `npx wrangler login` again, then confirm with `npx wrangler whoami` before running `npm run deploy`.

### Jev returns `401`

Open **Under the hood** in the app and replace the saved OpenCode API key, or switch to classifier.dev.

### A saved game disappeared

Games are browser-local. Clearing site data, using a different browser profile, or changing the hostname creates a separate database.
