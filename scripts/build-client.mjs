import { mkdir } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";

const root = process.cwd();
const outdir = path.join(root, "public", "assets");

await mkdir(outdir, { recursive: true });

await build({
  entryPoints: [path.join(root, "src", "client", "main.js")],
  outfile: path.join(outdir, "app.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["es2020"],
  charset: "utf8",
  legalComments: "none",
  logLevel: "info"
});
