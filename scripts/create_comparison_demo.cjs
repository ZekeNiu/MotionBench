"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto"), vm = require("node:vm");
const { createDemoLibrary, bindDemoReports, loadComparisonContext } = require("../tests/helpers/comparison-fixtures.cjs");
const args = process.argv.slice(2), output = path.resolve(args.find(value => !value.startsWith("--")) || path.join(__dirname, "../output/comparison-demo/团队与纵向模拟资料库.json"));
(async () => {
  const context = loadComparisonContext(), library = await bindDemoReports(createDemoLibrary(context, { bindReports: false }), context), content = JSON.stringify(library);
  const sha256 = value => crypto.createHash("sha256").update(value).digest("hex"), digest = sha256(content);
  let deterministic = null;
  if (args.includes("--verify")) {
    const verificationContext = loadComparisonContext(), repeated = JSON.stringify(await bindDemoReports(createDemoLibrary(verificationContext, { bindReports: false }), verificationContext)); deterministic = content === repeated;
    if (!deterministic) {
      let position = 0; while (position < Math.min(content.length, repeated.length) && content[position] === repeated[position]) position++;
      throw Error("合成生成不确定，差异位置 " + position + ": " + content.slice(position - 80, position + 120) + " / " + repeated.slice(position - 80, position + 120));
    }
  }
  fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, content, "utf8");
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/ringside-store.js"), "utf8"), context, { filename: "ringside-store.js" });
  const jsonlPath = output.replace(/\.json$/i, "") + ".jsonl", lines = [];
  for await (const row of context.RingsideStore.libraryRows(library)) lines.push(JSON.stringify(row));
  const jsonl = lines.join("\n") + "\n"; fs.writeFileSync(jsonlPath, jsonl, "utf8");
  const evidence = { output, jsonlPath, synthetic: true, deterministic, athletes: library.athletes.length,
    records: library.athletes.reduce((n, athlete) => n + athlete.records.length, 0), reports: library.comparisonReports.length,
    jsonBytes: Buffer.byteLength(content), jsonlBytes: Buffer.byteLength(jsonl), sha256: digest, jsonlSha256: sha256(jsonl), maxRowBytes: Math.max(...lines.map(line => Buffer.byteLength(line))),
    sourceSha: sha256(fs.readFileSync(path.join(__dirname, "../src/ringside-comparison.js"))),
    presetBindings: library.comparisonReports.map(report => ({ id: report.id, inputFingerprint: report.inputFingerprint, narrativeBasis: report.narrative.basis, current: report.inputFingerprint === report.narrative.basis })) };
  fs.writeFileSync(path.join(path.dirname(output), "generation-evidence.json"), JSON.stringify(evidence, null, 2)); console.log(JSON.stringify(evidence));
})().catch(error => { console.error(error); process.exitCode = 1; });
