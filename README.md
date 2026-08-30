# IndoorNav

Indoor 3D navigation with Wi-Fi fingerprint positioning.

## What it does

- Loads a 3D building model (OBJ/MTL) with Three.js
- Pathfinding via Recast/Detour navmesh or GPU-scan A*
- Step-by-step navigation instructions with POI waypoints
- Wi-Fi fingerprint-based positioning (Android, via `@codext/capacitor-wifi`)
- Fingerprint collector for building the signal database
- Deploys as a static site (Cloudflare Workers) or runs locally (Node/Hono)
- Android shell via Capacitor

## Tech stack

- **Frontend:** Preact 10 + @preact/signals, Three.js, Vite
- **Backend:** Hono (Node + Cloudflare Workers)
- **Mobile:** Capacitor 8 + @codext/capacitor-wifi
- **Navigation:** Recast/Detour navmesh, GPU-scan A*
- **Storage:** @54145a/storage2 (reactive localStorage proxy)
- **Types:** TypeScript (tsgo native preview)

## Project status

**This project has been discontinued.** The student club dissolved unexpectedly, and a competing team has made strong progress using an open-source indoor mapping framework. I have decided to join their effort instead.

The indoor positioning system (Wi-Fi fingerprinting) may be retained and integrated into the new project. What is being abandoned is the map and navigation portion.

## Getting started

```bash
pnpm install
pnpm dev
```

> **Note:** Map data files (`public/map.obj`, `public/map.mtl`, `public/map.navmesh.bin`) are not included in this repository. You will need to provide your own 3D building model.

## Build

```bash
pnpm build          # → dist/
pnpm build:navmesh  # regenerate navmesh from map.obj
```

## Android

```bash
pnpm cap:sync:android   # build + sync to android/
pnpm cap:open:android   # open Android Studio
```

## License

AGPL-3.0-only
