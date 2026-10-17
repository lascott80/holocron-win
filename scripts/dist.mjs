// Packages the built app into the Windows installer (`npm run dist`).
//
//   node scripts/dist.mjs [extra electron-builder args]
//
// Forces the x86 BCJ filter for the installer's 7z payloads. 7-Zip 23+ picks
// its ARM64 filter for arm64 .exe/.dll files by default (always so when
// building on an ARM PC), but the installer unpacks with NSIS's nsis7z plugin
// from 2019, which can't decode it and silently skips those files: Holocron
// would install without Holocron.exe. BCJ is decodable everywhere and only
// costs a little compression on arm64 code.

import { spawnSync } from "node:child_process";

const result = spawnSync("npx", ["electron-builder", "--win", "--publish", "never", ...process.argv.slice(2)], {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, ELECTRON_BUILDER_7Z_FILTER: "BCJ" },
});
process.exit(result.status ?? 1);
