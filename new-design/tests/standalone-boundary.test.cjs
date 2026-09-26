const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");

function owned(target) {
  const relative = path.relative(root, target);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? files(target) : /\.(?:ts|tsx|cjs|mjs)$/.test(entry.name) ? [target] : [];
  });
}

test("production source imports remain package-owned or explicit third-party dependencies", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const packages = new Set(Object.keys({ ...manifest.dependencies, ...manifest.devDependencies, ...manifest.peerDependencies }));
  for (const file of [...files(path.join(root, "src")), ...files(path.join(root, "scripts")), path.join(root, "vite.config.ts")]) {
    const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    function check(specifier) {
      assert.equal(typeof specifier, "string");
      if (specifier.startsWith("node:")) return;
      if (specifier.startsWith(".")) {
        assert.ok(owned(path.resolve(path.dirname(file), specifier)), `${path.relative(root, file)} imports outside new-design: ${specifier}`);
      } else {
        const name = specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0];
        assert.ok(packages.has(name), `${path.relative(root, file)} uses unapproved package/alias: ${specifier}`);
      }
    }
    function visit(node) {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) check(node.moduleSpecifier.text);
      if (ts.isCallExpression(node)) {
        const loader = node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require") || (ts.isPropertyAccessExpression(node.expression) && node.expression.getText(source) === "require.resolve");
        if (loader) {
          const argument = node.arguments[0];
          assert.ok(argument && ts.isStringLiteral(argument), `${path.relative(root, file)} has a computed module loader; review and replace with explicit imports`);
          check(argument.text);
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
});

test("build configs, independent entry and UI theme are owned by new-design", () => {
  for (const filename of ["tsconfig.client.json", "tsconfig.server.json"]) {
    const config = JSON.parse(fs.readFileSync(path.join(root, filename), "utf8"));
    assert.equal(config.extends, "./tsconfig.base.json");
    assert.ok(owned(path.resolve(root, config.extends)));
    assert.equal(config.compilerOptions.paths, undefined, "must not inherit old business aliases");
  }
  const base = JSON.parse(fs.readFileSync(path.join(root, "tsconfig.base.json"), "utf8"));
  assert.equal(base.extends, undefined);
  assert.equal(base.compilerOptions.paths, undefined);
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  assert.match(html, /src\/client\/standalone\/main\.tsx/);
  const app = fs.readFileSync(path.join(root, "src/server/app/index.ts"), "utf8");
  assert.match(app, /createIndependentAiGateway\(\)/);
  assert.doesNotMatch(app, /newDesignAiGateway|server\/src|AppLayout/);
  const css = fs.readFileSync(path.join(root, "src/client/standalone/theme.css"), "utf8");
  for (const token of ["background", "foreground", "card", "muted", "muted-foreground", "border", "input", "primary", "primary-foreground", "ring", "success", "destructive", "radius"]) assert.ok(css.includes(`--${token}:`), `missing owned theme token ${token}`);
  assert.match(css, /:root\.dark\[data-theme="paper"\]/);
  assert.match(css, /:root\.dark\[data-theme="night"\]/);
});

test("new-design business code cannot bypass its registered prompt gateway", () => {
  const server = path.join(root, "src/server");
  for (const file of files(server).filter(file => file.endsWith(".ts"))) {
    const relative = path.relative(server, file).replaceAll(path.sep, "/");
    if (relative === "ai/runtime/managedExecution.ts" || relative === "ai/runtime/transport.ts") continue;
    const source = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(source, /\binvokeStructuredModel\s*\(|\bgetLLM\s*\(/, `${relative} bypasses the managed prompt executor`);
    if (relative.startsWith("ai/prompts/")) continue;
    assert.doesNotMatch(source, /\b(?:systemPrompt|userPrompt)\s*[:=]/, `${relative} defines a business prompt outside the registered asset directory`);
  }
});
