# ArcadeLauncher companion (mobile)

A small React Native / Expo app for browsing the library and the request board
from a phone. It is a *companion* to the desktop launcher, not a replacement.

## What it does

- Sign in against your ArcadeLauncher server (`POST /api/login`), with the token
  held in the platform keystore via `expo-secure-store`.
- Browse the catalogue: search across title / platform / genre / developer,
  filter by platform, open a game for cover art, summary and download size.
- Browse the request board and upvote rows.

## What it deliberately does not do

- **Install / launch / download control.** Those act on a specific PC, and the
  server has no relay to push a command to a running desktop client. Adding
  that is server-side work, not a client change; until it exists, the companion
  stays read-only for the library.
- **Filing new requests.** The create flow is IGDB-search-driven and lives on
  the desktop, where the metadata picker is.
- **Voice / video calls.** The WebRTC stack is desktop-only.

## Layout

```
mobile/
  App.tsx              tab shell + session lifecycle
  src/core/            pure, IO-free logic — the only tested part
    session.ts         host normalization, login parsing, stored-session narrowing
    catalog.ts         catalog parsing, search/filter, size + subtitle formatting
    requests.ts        board parsing, status vocabulary, sort, optimistic votes
  src/api.ts           fetch glue over the cores
  src/storage.ts       keystore-backed session persistence
  src/screens/         sign-in, library, requests
```

`src/core/*.test.ts` runs under the **repository root** vitest config, so
`npm test` at the repo root (and therefore both CI runners) covers the
companion's logic. The React Native UI is outside the root `tsconfig`'s
`include`, so it never enters the desktop build.

## Running it

```
cd mobile
npm install
npm start        # then scan the QR code with Expo Go
```

The server address is whatever you type into the launcher — scheme and trailing
slashes are stripped for you, and a port is kept. HTTPS is always used.
