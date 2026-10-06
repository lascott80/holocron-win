import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// HOLOCRON_OUT=out-foo builds into another folder, so parallel builds don't collide.
const out = resolve(__dirname, process.env.HOLOCRON_OUT || "out");

const alias = {
  "@core": resolve(__dirname, "src/core"),
  "@shared": resolve(__dirname, "src/shared"),
};

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
    build: {
      outDir: resolve(out, "main"),
      rollupOptions: {
        input: {
          index: resolve(__dirname, "src/main/index.ts"),
          indexWorker: resolve(__dirname, "src/main/indexWorker.ts"),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
    build: {
      outDir: resolve(out, "preload"),
      rollupOptions: {
        output: { format: "cjs", entryFileNames: "[name].cjs" },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, "src/renderer"),
    resolve: { alias: { ...alias, "@editor": resolve(__dirname, "src/editor") } },
    plugins: [svelte()],
    build: {
      target: "chrome140",
      outDir: resolve(out, "renderer"),
      // Two pages: the main window and the quick capture window (src/main/capture.ts).
      rollupOptions: {
        input: {
          index: resolve(__dirname, "src/renderer/index.html"),
          capture: resolve(__dirname, "src/renderer/capture.html"),
        },
      },
    },
  },
});
