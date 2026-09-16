import { spawn } from "node:child_process";
import path from "node:path";

const packageRoot = path.resolve(__dirname, "../../..");
const tsxCli = require.resolve("tsx/cli");
const viteCli = path.resolve(path.dirname(require.resolve("vite/package.json")), "bin/vite.js");
const children = [
  spawn(process.execPath, [tsxCli, "watch", "src/server/app/main.ts"], { cwd: packageRoot, stdio: "inherit", windowsHide: true }),
  spawn(process.execPath, [viteCli], { cwd: packageRoot, stdio: "inherit", windowsHide: true }),
];
let stopping = false;
const stop = () => { if (stopping) return; stopping = true; for (const child of children) child.kill("SIGTERM"); };
for (const child of children) {
  child.once("error", () => { console.error("开发进程启动失败，请先在新设计目录安装依赖。"); process.exitCode = 1; stop(); });
  child.once("exit", code => { if (!stopping) { process.exitCode = code ?? 1; stop(); } });
}
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
