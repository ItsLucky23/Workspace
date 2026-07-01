import { build } from "esbuild";
import { dependencies } from "../package.json";

const externalDeps = [
  ...Object.keys(dependencies || {}),
  // Native Node.js modules
  "fs", "path", "url", "os", "child_process", "crypto"
];

await build({
  entryPoints: ["server/server.ts"], // Adjust if entry is different
  outfile: "dist/server.js",         // Final bundled output
  bundle: true,
  platform: "node",
  target: "node22",                  // Match your runtime (Node 18, 20 etc.)
  format: "esm",                     // Your project uses "type": "module"
  sourcemap: true,
  external: externalDeps,
  logLevel: "info",
}).catch((e) => {
  console.error("Build failed:", e);
  process.exit(1);
});
