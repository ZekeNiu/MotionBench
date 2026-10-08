"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm");
const sandbox = vm.createContext({
  console,
  Intl,
  crypto: require("node:crypto").webcrypto,
});
sandbox.window = sandbox;
for (const name of ["calc", "fvp", "cpet-reference", "definitions", "tests", "model", "interventions"])
  vm.runInContext(
    fs.readFileSync(
      path.join(__dirname, "../../src/ringside-" + name + ".js"),
      "utf8",
    ),
    sandbox,
  );
const M = sandbox.RingsideModel;
function extensionFixture({ max = false, pdf = false } = {}) {
  const r = pdf ? M.sampleRecord() : M.defaults();
  r.athlete.name = max ? "数量上限验收" : "多指标与能力表验收";
  if (!pdf) for (const id of Object.keys(r.enabled)) r.enabled[id] = false;
  const count = max ? 60 : 1,
    metrics = max ? 300 - r.definitions.length : 130;
  for (let i = 0; i < count; i++) {
    const id = "custom_fixture_" + i;
    r.customTests.push({
      id,
      name: max
        ? "长项目名称用于检查换行与分组".repeat(6) + i
        : "多指标连续结果表",
      category: "performance",
    });
    r.enabled[id] = true;
  }
  for (let i = 0; i < metrics; i++) {
    const project = max ? (i < count ? i : 0) : 0,
      id = "fixture_metric_" + i;
    const ability = max
      ? "完整能力名称用于换行检查".repeat(6) + (i < count ? i : 0)
      : "扩展能力" + (i % 60);
    r.definitions.push({
      id,
      testId: "custom_fixture_" + project,
      name: "验收指标 " + i + " · 完整记录结果",
      unit: i % 2 ? "kgf" : "N",
      ability,
      category: "performance",
      direction: "higher",
      target: 100,
      referenceEnabled: false,
      ranges: [],
      source: "验收用配置",
    });
    r.customValues[id] = {
      value: i === 0 ? 0 : 80,
      notes: i === metrics - 1 ? "最后一个指标的备注必须保留" : "",
    };
  }
  if (pdf) {
    r.data.fms[1].right = "";
    r.data.fms[2].pain = true;
    r.data.iso[2].right = "";
    r.data.iso[3].unit = "kgf";
  }
  const out = M.normalizeRecord(r);
  M.validateRecord(out);
  return JSON.parse(JSON.stringify(out));
}
module.exports = { extensionFixture };
