"use strict";
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), assert = require("node:assert/strict");
const ctx = vm.createContext({console, Intl, crypto: require("node:crypto").webcrypto}); ctx.window = ctx;
for (const name of ["calc", "definitions", "tests", "model", "evaluation"])
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/ringside-" + name + ".js"), "utf8"), ctx);
// Exercise the real synchronous merge without opening IndexedDB or adding a
// production API solely for the tests.
vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/ringside-store.js"), "utf8")
  .replace("  function validateTestPlans(", "  root.testCatalogMerge = mergeCatalog;\n  function validateTestPlans("), ctx);
const M = ctx.RingsideModel, merge = ctx.testCatalogMerge, copy = x => JSON.parse(JSON.stringify(x));
let passed = 0;
function test(name, run) { run(); passed++; console.log("PASS " + name); }
function oldCatalog() {
  const catalog = M.normalizeCatalog(), definition = catalog.definitions.find(d => d.id === "ift_treadmill");
  catalog.tests.find(t => t.id === "ift").name = "30–15 IFT";
  definition.name = "30–15 IFT·跑台改良版终末速度";
  definition.protocol = "跑台改良版：2.222222 m/s 起，每级 +0.138889 m/s，30 秒跑 / 15 秒被动恢复；记录最终完整级与未完成级持续时间。不得套用至折返版。";
  catalog.definitions.find(d => d.id === "ift_shuttle").name = "30–15 折返 VIFT";
  return catalog;
}
test("old shipped VIFT descriptions merge with neutral defaults without a false version conflict", () => {
  for (const reverse of [false, true]) {
    const local = reverse ? oldCatalog() : M.normalizeCatalog(), incoming = reverse ? M.normalizeCatalog() : oldCatalog();
    const before = copy(incoming), localDefinition = copy(local.definitions.find(d => d.id === "ift_treadmill"));
    merge(local, incoming); assert.equal(local.conflicts.length, 0);
    assert.deepEqual(copy(incoming), before);
    assert.deepEqual(copy(local.definitions.find(d => d.id === "ift_treadmill")), localDefinition);
  }
});
test("VIFT comparison preserves custom method, unit, value and threshold differences", () => {
  const mutations = [
    c => c.definitions.find(d => d.id === "ift_treadmill").protocol += " 自定义条件",
    c => c.protocol.ift = "实际测试条件不同",
    c => c.definitions.find(d => d.id === "ift_treadmill").unit = "km/h",
    c => c.definitions.find(d => d.id === "ift_treadmill").target += .01,
    c => c.definitions.find(d => d.id === "ift_treadmill").ranges[0].max += .01,
    c => c.definitions.find(d => d.id === "ift_treadmill").ranges[0].includeMax = false,
    c => c.definitions.find(d => d.id === "ift_treadmill").referenceEnabled = true,
    c => c.definitions.find(d => d.id === "ift_treadmill").name = "自定义终末速度",
    c => c.tests.find(t => t.id === "ift").name = "自定义测试名称",
  ];
  for (const mutate of mutations) {
    const local = M.normalizeCatalog(), incoming = oldCatalog(); mutate(incoming); merge(local, incoming);
    const conflict = local.conflicts.find(c => c.testId === "ift"); assert.ok(conflict); assert.equal(conflict.variants.length, 2);
  }
});
test("ability name conflicts and ordered additions remain intact beside the VIFT alias", () => {
  const local = M.normalizeCatalog(), incoming = oldCatalog();
  incoming.abilityGroups.find(g => g.key === "下肢爆发力").name = "导入起跳能力";
  incoming.abilityGroups.push({key:"ability_added",name:"导入新分类"});
  merge(local, incoming); merge(local, incoming);
  assert.equal(local.conflicts.length, 0);
  assert.equal(local.abilityGroups.find(g => g.key === "下肢爆发力").name, "下肢爆发力");
  assert.equal(local.abilityGroupConflicts.filter(c => c.key === "下肢爆发力").length, 1);
  assert.deepEqual(copy(local.abilityGroups.at(-1)), {key:"ability_added",name:"导入新分类"});
});
test("empty historical screen categories match their defaults while custom choices remain conflicts", () => {
  for (const missing of [false, true]) for (const reverse of [false, true]) {
    const current = M.normalizeCatalog(), old = oldCatalog();
    for (const id of ["fms", "iso"]) { const test = old.tests.find(t => t.id === id); if (missing) delete test.primaryAbility; else test.primaryAbility = ""; }
    const local = reverse ? old : current, incoming = reverse ? current : old;
    merge(local, incoming); assert.equal(local.conflicts.length, 0);
  }
  for (const id of ["fms", "iso"]) {
    const local = M.normalizeCatalog(), incoming = oldCatalog(); incoming.tests.find(t => t.id === id).primaryAbility = "用户自定分类";
    merge(local, incoming); assert.deepEqual(copy(local.conflicts.map(c => c.testId)), [id]);
  }
});
console.log(passed + " store catalog model checks passed");
