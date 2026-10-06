import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

const alias = {
  "@core": resolve(__dirname, "src/core"),
  "@shared": resolve(__dirname, "src/shared"),
};

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
    build: {
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
      rollupOptions: { input: resolve(__dirname, "src/renderer/index.html") },
    },
  },
});
