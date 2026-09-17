import { defineConfig } from "vite";

export default defineConfig({
  esbuild: { jsx: "automatic" },
  optimizeDeps: { entries: ["index.html"] },
  server: {
    host: "127.0.0.1",
    port: 5273,
    strictPort: true,
    watch: { ignored: ["**/.data/**"] },
    fs: { strict: true, allow: [__dirname] },
    proxy: { "/api/new-design": "http://127.0.0.1:5301" },
  },
  preview: { host: "127.0.0.1", port: 5273, strictPort: true },
  build: { outDir: "dist/client", emptyOutDir: true },
});
