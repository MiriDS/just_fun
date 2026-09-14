// Renders each billboard page to the image its panel shows while you roam.
//
// Only the billboard being read gets a live iframe. The other three show one
// of these instead: four 3D-transformed iframes under a transparent canvas,
// restyled every frame, was the most expensive thing on the page and the
// likeliest cause of the scene freezing on fast Windows machines.
//
// Run it after editing anything in public/pages/:  npm run snapshots
// Needs a Chrome or Chromium; set CHROME to its path if it is not found.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { BILLBOARDS } from "../src/components/billboards.js";

// The iframe's size in Billboard.jsx (SCREEN_WIDTH_PX, SCREEN_HEIGHT_PX). At
// 1x: whenever the panel is close enough for more detail to show, the live
// page is covering it.
const WIDTH = 1440;
const HEIGHT = 620;

const CHROME = [
  process.env.CHROME,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
].find((path) => path && existsSync(path));

if (!CHROME) {
  console.error("No Chrome found. Set CHROME to the browser's executable.");
  process.exit(1);
}

for (const { url, snapshot } of BILLBOARDS) {
  if (!url || !snapshot) continue;

  const page = pathToFileURL(resolve("public" + url)).href;
  const output = resolve("public" + snapshot);
  mkdirSync(dirname(output), { recursive: true });

  const result = spawnSync(
    CHROME,
    [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--force-device-scale-factor=1",
      `--window-size=${WIDTH},${HEIGHT}`,
      `--screenshot=${output}`,
      page,
    ],
    { encoding: "utf8" }
  );

  if (result.status !== 0 || !existsSync(output)) {
    console.error(`failed: ${url}\n${result.stderr}`);
    process.exit(1);
  }
  console.log(`${url} -> ${snapshot}`);
}
