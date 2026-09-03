import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: {
      entry: "src/frigate-delivery-card.js",
      formats: ["es"],
      fileName: () => "frigate-delivery-card.js",
    },
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
    minify: false,
  },
  test: {
    environment: "happy-dom",
    include: ["src/**/*.test.ts"],
  },
});
