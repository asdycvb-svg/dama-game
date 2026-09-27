# AGENTS.md

## Project overview

This repository is a browser-based multiplayer chess game with a Node.js + Express + Socket.IO server and a Vite frontend.

- Frontend entry: `src/main.js`
- Styles: `src/style.css` and `modern-ui-patch.css`
- Server entry: `server.js`
- Static build output: `dist/`
- Public assets: `public/`

## Common commands

Run these from the repository root:

- `npm install` — install frontend/server dependencies
- `npm run dev` — start the Vite dev server
- `npm run build` — create a production build in `dist/`
- `npm run preview` — preview the built app locally

## Architecture and conventions

- The app uses ES modules (`"type": "module"` in `package.json`).
- Server logic lives in `server.js`; it serves the built app and manages multiplayer room state through Socket.IO.
- Client logic lives in `src/` and connects to the online server via the `socket.io-client` instance in `src/main.js`.
- Room and player state are stored in memory on the server; no database-backed persistence is assumed unless explicitly added.
- Game assets and audio files are served from `public/` and referenced with root-relative paths like `/move.wav`.

## Important implementation notes

- Socket events must stay in sync between `server.js` and `src/main.js`.
- Room codes are generated server-side and are treated as strings.
- If you change board rules, sound triggers, or turn logic, verify both online and local game flows still match.
- If you add new public/static assets, keep the file path aligned with how the browser references them.

## Safe editing guidance

- Prefer small, targeted changes in the existing style rather than introducing new frameworks or abstraction layers.
- Keep multiplayer behavior consistent with the current socket-event contracts.
- When editing the UI, preserve the existing DOM IDs and game state scripts used by the client logic.
- When editing the server, keep room cleanup and disconnect handling robust; `closeRoomForSocket` and similar cleanup paths are important for multiplayer stability.

## Files to inspect first

- `server.js` — multiplayer room lifecycle and Socket.IO logic
- `src/main.js` — client game state, online room flow, and audio setup
- `src/supabase.js` — external data integration if present
- `package.json` — scripts and dependency setup

## Working style for agents

- Prefer matching existing naming patterns and comments in Arabic/English mixed code when making changes.
- Preserve browser compatibility and mobile-safe behavior, especially around audio and touch interactions.
- Validate frontend changes with `npm run build` when the change could affect bundling or runtime assumptions.
- If a change affects the multiplayer protocol, verify the server and client handlers remain compatible.
