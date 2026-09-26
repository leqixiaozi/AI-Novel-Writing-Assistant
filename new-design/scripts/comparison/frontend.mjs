import path from "node:path";
import { createServer } from "vite";

// Each frontend owns its process cwd, including PostCSS/Tailwind discovery.
const legacy = process.argv[2] === "legacy";
const root = process.cwd();
const frontend = await createServer({
  root,
  configFile: path.join(root, "vite.config.ts"),
  base: legacy ? "/" : "/new-design/",
  server: {
    host: "127.0.0.1", port: legacy ? 5275 : 5274, strictPort: true, open: false,
    hmr: { host: "127.0.0.1", clientPort: legacy ? 5275 : 5274, path: legacy ? "__legacy_hmr" : "__new_hmr" },
    watch: { ignored: ["**/.data/**"] },
  },
});
await frontend.listen();
process.send?.("ready");
async function stop() { await frontend.close(); process.exit(); }
process.once("disconnect", () => { void stop(); });
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => { void stop(); });
