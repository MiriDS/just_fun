// Writes .gz and .br beside every compressible file in dist/.
//
// The server hands static files to sirv, which serves a pre-compressed file
// when one sits next to the original but never compresses on the fly. Without
// this step the main bundle goes over the wire at 1.3MB instead of 395kB.
//
// Build-time work, so the cost is paid once per deploy rather than per visitor.

import { createReadStream, createWriteStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join, extname } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGzip, createBrotliCompress, constants } from "node:zlib";

const DIST = "dist";

// Text formats only. The models are already compressed containers, and
// squeezing them again costs build time to save almost nothing.
const COMPRESSIBLE = new Set([
  ".js", ".css", ".html", ".json", ".svg", ".map", ".txt", ".xml",
]);

// Below this the headers cost more than the saving.
const MINIMUM_BYTES = 1024;

async function* walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else yield path;
  }
}

let files = 0;
let before = 0;
let afterGzip = 0;
let afterBrotli = 0;

for await (const file of walk(DIST)) {
  if (!COMPRESSIBLE.has(extname(file))) continue;

  const { size } = await stat(file);
  if (size < MINIMUM_BYTES) continue;

  await pipeline(createReadStream(file), createGzip({ level: 9 }), createWriteStream(`${file}.gz`));
  await pipeline(
    createReadStream(file),
    createBrotliCompress({
      params: {
        [constants.BROTLI_PARAM_QUALITY]: 11,
        [constants.BROTLI_PARAM_SIZE_HINT]: size,
      },
    }),
    createWriteStream(`${file}.br`)
  );

  files++;
  before += size;
  afterGzip += (await stat(`${file}.gz`)).size;
  afterBrotli += (await stat(`${file}.br`)).size;
}

const mb = (bytes) => (bytes / 1024 / 1024).toFixed(2) + "MB";
console.log(
  `precompressed ${files} files: ${mb(before)} -> ${mb(afterGzip)} gzip, ${mb(afterBrotli)} brotli`
);
