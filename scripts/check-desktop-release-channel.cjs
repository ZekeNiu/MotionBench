"use strict";
// Read the published channel with the locked provider; never install or download.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict"), crypto = require("node:crypto");
const { GitHubProvider } = require("electron-updater/out/providers/GitHubProvider");
const { configureUpdater, validateUpdateInfo, releaseNotes, compareVersions } = require("../desktop/update-service.cjs");
const semver = require(require.resolve("semver", { paths: [require.resolve("electron-updater")] }));
const yaml = require("js-yaml"), root = path.resolve(__dirname, ".."), arg = key => {
  const index = process.argv.indexOf(key); return index < 0 ? undefined : process.argv[index + 1];
};
const version = yaml.load(fs.readFileSync(path.join(root, "electron-builder.yml"), "utf8")).extraMetadata.version;
const hash = data => crypto.createHash("sha256").update(data).digest("hex");
const result = { passed: false, checkedAt: new Date().toISOString(), method: "Locked GitHubProvider over public HTTPS; no installer download or execution", updater: require("electron-updater/package.json").version, expectedVersion: version, sourceHtmlSha256: hash(fs.readFileSync(path.join(root, "MotionBench.html"))), scriptSha256: hash(fs.readFileSync(__filename)), requests: [] };
(async () => {
  try {
    const updater = configureUpdater({ currentVersion: new semver.SemVer(version), fullChangelog: false });
    const provider = new GitHubProvider({ provider: "github", owner: "ZekeNiu", repo: "MotionBench", channel: "desktop" }, updater, { platform: "win32", executor: {
      request: async options => {
        const url = new URL(options.path, `https://${options.hostname}`);
        assert.equal(url.protocol, "https:"); assert.equal(url.hostname, "github.com");
        const response = await fetch(url, { headers: options.headers, signal: AbortSignal.timeout(20000) });
        assert.equal(response.status, 200, `Published channel request failed: ${url.pathname}`);
        const text = await response.text();
        result.requests.push({ url: url.href, status: response.status, sha256: hash(text), bytes: Buffer.byteLength(text) });
        return text;
      }
    } });
    const info = await provider.getLatestVersion(), accepted = validateUpdateInfo(info);
    assert.equal(accepted.version, version);
    assert.equal(compareVersions(accepted.version, version), 0);
    assert.ok(result.requests.some(request => request.url.endsWith(`/v${version}/desktop.yml`)));
    assert.ok(!result.requests.some(request => /\/(?:latest|beta)\.yml$/.test(request.url)));
    const notes = releaseNotes(info.releaseNotes); assert.ok(notes.length > 0); assert.ok(!/<\/?(?:p|li|div|script|style)\b/i.test(notes));
    const installer = arg("--installer");
    if (installer) {
      const data = fs.readFileSync(path.resolve(root, installer));
      assert.equal(data.length, accepted.size);
      assert.equal(crypto.createHash("sha512").update(data).digest("base64"), accepted.sha512);
      result.installer = { name: path.basename(installer), sha256: hash(data), size: data.length };
    }
    result.channel = "desktop"; result.selected = accepted; result.notesText = notes; result.passed = true;
  } catch (error) { result.error = error.stack || error.message; process.exitCode = 1; }
  const output = path.resolve(root, arg("--output") || "output/tests/v2191-desktop/published-channel.json");
  assert.ok(output.startsWith(path.join(root, "output") + path.sep));
  fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify({ passed: result.passed, version: result.selected?.version, requests: result.requests.map(request => request.url), error: result.error }));
})();
