---
"@plusplusoneplusplus/coc-memory": minor
"@plusplusoneplusplus/deep-wiki": minor
"@plusplusoneplusplus/forge": minor
---

Upgrade better-sqlite3 from ^11.9.1 to ^12.11.1 so the shared native binding has a prebuilt binary for the Electron ABI the desktop shell runs on. better-sqlite3 11.x publishes Electron prebuilts only up to electron-v133 (Electron 35); 12.x reaches electron-v146 (Electron 42), which is the newest Electron still inside its supported-major window. Consumers installing these packages now resolve better-sqlite3 12, which requires Node 20 or newer.
