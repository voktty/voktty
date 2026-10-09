import { copyFile } from "node:fs/promises";
import { build } from "vite";

await build({
  configFile: false,
  build: {
    ssr: "host/cli.ts",
    outDir: "build/host",
    emptyOutDir: true,
    target: "node22",
    minify: false,
    rollupOptions: {
      output: { entryFileNames: "voktty-host.mjs" },
    },
  },
  define: { "import.meta.hot": "undefined" },
});
await copyFile("host/provider-guard.mjs", "build/host/provider-guard.mjs");
