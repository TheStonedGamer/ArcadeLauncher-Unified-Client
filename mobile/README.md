# ArcadeLauncher companion (mobile)

A React Native / Expo companion for managing the ArcadeLauncher store, library,
social features, requests, and desktop installs from a phone.

## What it does

- Sign in against your ArcadeLauncher server (`POST /api/login`), with the token
  held in the platform keystore via `expo-secure-store`.
- Browse the full Store or switch to the signed-in account's personal Library.
  Add/remove games, search/filter either view, and remotely install owned games
  to a connected desktop.
- Browse the request board and upvote rows.
- Approve pushed sign-in requests and scan short-lived QR codes shown by the
  desktop launcher or website. QR approval only works for the same server that
  issued the phone's stored session.

## Android release size

Release builds use R8 minification and resource shrinking. The release workflow
publishes separate `arm64` (physical phones) and `x86_64` (emulators) APKs so
each download contains only one architecture's native libraries.

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
  src/screens/         sign-in, store/library, requests, chat/calls, QR login
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
