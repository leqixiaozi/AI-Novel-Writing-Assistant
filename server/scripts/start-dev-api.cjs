const { spawn } = require("node:child_process");

const tsNodeDevBin = require.resolve("ts-node-dev/lib/bin");
const child = spawn(process.execPath, [tsNodeDevBin, "--respawn", "--transpile-only", "src/app.ts"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    AI_NOVEL_NEW_DESIGN_DEV_RUNTIME: "1",
  },
  stdio: "inherit",
  windowsHide: true,
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.once("error", (error) => {
  console.error("[server] failed to start development API.", error);
  process.exitCode = 1;
});

child.once("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exitCode = code ?? 1;
});
