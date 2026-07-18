import { defineConfig } from "tsup";

/**
 * Two entry trees, each its own dist subpath:
 *   - `.`        core (edge-safe): the identity gateway + domain types + config re-exports
 *   - `./config` the edge-safe policy alone (imported by Next middleware — no SDK, no next)
 *   - `./nextjs` the Next server surface: session seam, proxy, callback, headless flows
 * Everything in deps/peerDeps stays external — only our own code is bundled.
 */
export default defineConfig({
  entry: ["src/index.ts", "src/config.ts", "src/nextjs/index.ts"],
  format: ["esm"],
  dts: true,
  clean: false,
  treeshake: true,
  splitting: true,
  sourcemap: false,
  external: [
    "react",
    "react-dom",
    "react/jsx-runtime",
    "next",
    /^next\//,
    /^@workos-inc\//,
    /^node:/,
  ],
});
