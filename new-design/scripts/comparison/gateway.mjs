import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const legacyRoot = path.resolve(packageRoot, "../client");
const frontends = [];
const gateway = http.createServer();
const ipv6Gateway = http.createServer();
const sockets = new Set();
for (const event of ["connection", "request", "upgrade"]) {
  ipv6Gateway.on(event, (...args) => gateway.emit(event, ...args));
}

function upstream(rawUrl) {
  const pathname = new URL(rawUrl, "http://localhost").pathname;
  const under = prefix => pathname === prefix || pathname.startsWith(`${prefix}/`);
  if (under("/api/new-design")) return 5301;
  if (under("/api")) return 3000;
  return 5275;
}

gateway.on("connection", socket => {
  sockets.add(socket);
  socket.on("close", () => sockets.delete(socket));
});
gateway.on("request", (request, response) => {
  const proxy = http.request({ hostname: "127.0.0.1", port: upstream(request.url), path: request.url, method: request.method, headers: request.headers }, result => {
    response.writeHead(result.statusCode, result.headers);
    result.pipe(response);
    result.on("error", () => response.destroy());
  });
  proxy.on("error", () => {
    if (response.headersSent) return response.destroy();
    response.writeHead(502, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ success: false, error: "对应版本的服务尚未就绪，请检查服务启动状态。" }));
  });
  request.on("aborted", () => proxy.destroy());
  response.on("close", () => { if (!response.writableEnded) proxy.destroy(); });
  request.pipe(proxy);
});
gateway.on("upgrade", (request, socket, head) => {
  const proxy = http.request({ hostname: "127.0.0.1", port: upstream(request.url), path: request.url, headers: request.headers });
  proxy.on("upgrade", (response, upstreamSocket, upstreamHead) => {
    socket.write(`HTTP/1.1 ${response.statusCode} ${response.statusMessage}\r\n`);
    for (let i = 0; i < response.rawHeaders.length; i += 2) socket.write(`${response.rawHeaders[i]}: ${response.rawHeaders[i + 1]}\r\n`);
    socket.write("\r\n");
    if (upstreamHead.length) socket.write(upstreamHead);
    if (head.length) upstreamSocket.write(head);
    socket.pipe(upstreamSocket).pipe(socket);
    socket.on("error", () => upstreamSocket.destroy());
    upstreamSocket.on("error", () => socket.destroy());
    socket.on("close", () => upstreamSocket.destroy());
    upstreamSocket.on("close", () => socket.destroy());
  });
  proxy.on("response", response => { response.resume(); socket.destroy(); });
  proxy.on("error", () => socket.destroy());
  socket.on("error", () => proxy.destroy());
  proxy.end();
});

async function stop() {
  for (const socket of sockets) socket.destroy();
  gateway.close();
  ipv6Gateway.close();
  for (const frontend of frontends) frontend.kill();
}
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => { void stop().finally(() => process.exit()); });

try {
  for (const [root, kind] of [
    [legacyRoot, "legacy"],
  ]) {
    const frontend = spawn(process.execPath, [path.join(packageRoot, "scripts/comparison/frontend.mjs"), kind], {
      cwd: root, windowsHide: true, stdio: ["ignore", "inherit", "inherit", "ipc"],
    });
    frontends.push(frontend);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${kind} frontend startup timed out`)), 60000);
      frontend.once("message", message => { if (message === "ready") { clearTimeout(timer); resolve(); } });
      frontend.once("error", error => { clearTimeout(timer); reject(error); });
      frontend.once("exit", () => { clearTimeout(timer); reject(new Error(`${kind} frontend exited`)); });
    });
    frontend.once("exit", () => { void stop(); process.exitCode = 1; });
  }
  await new Promise((resolve, reject) => {
    gateway.once("error", reject);
    gateway.listen(5273, "127.0.0.1", resolve);
  });
  await new Promise((resolve, reject) => {
    ipv6Gateway.once("error", reject);
    ipv6Gateway.listen({ port: 5273, host: "::1", ipv6Only: true }, resolve);
  });
  console.log("Integrated menu entry ready: http://localhost:5273 (existing shell, legacy and new-design menus)");
} catch (error) {
  console.error("Comparison entry failed:", error.message);
  await stop();
  process.exitCode = 1;
}
