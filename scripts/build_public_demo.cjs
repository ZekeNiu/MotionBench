"use strict";
// The public demo starts from blank defaults, never from a saved athlete record.
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"),
  assert = require("node:assert/strict"), { createHash } = require("node:crypto");
const root = path.resolve(__dirname, ".."), out = path.join(root, "output/public-demo/site");
const sha = value => createHash("sha256").update(value).digest("hex");
const instant = "2026-01-15T08:00:00.000Z";
let nextId = 0;
class DemoDate extends Date {
  constructor(...args) { super(...(args.length ? args : [instant])); }
  static now() { return new Date(instant).getTime(); }
}
const context = vm.createContext({ console, Intl, Date: DemoDate,
  crypto: { randomUUID: () => "00000000-0000-4000-8000-" + String(++nextId).padStart(12, "0") } });
context.window = context;
for (const name of ["calc", "fvp", "sprint-fvp", "sprint-elasticity", "sprint-fvp-confidence",
  "sources", "cpet-reference", "iso-reference", "definitions", "tests", "scoring", "model", "evaluation", "interventions"])
  vm.runInContext(fs.readFileSync(path.join(root, `src/ringside-${name}.js`), "utf8"), context);
const M = context.RingsideModel, r = M.defaults();
r.athleteId = "public-demo-athlete-000001"; r.recordId = "public-demo-record";
r.demo = true; r.demoRevision = 2; r.title = "综合测试 · 模拟示例";
Object.assign(r.athlete, { name: "演示运动员（模拟数据）", age: 24, sex: "男", mass: 75,
  height: 182, sport: "综合体能", dominantHand: "右", date: "2026-01-15",
  sportLevel: "模拟训练背景", cycle: "一般准备期", notes: "全部测量值由演示构建脚本生成，非真人测试记录。" });
Object.assign(r.trainingContext, { experienceYears: 4, weeklySessions: 3,
  equipment: "杠铃、药球、跑道", weeklySchedule: "周一力量、周三速度、周五体能（模拟）" });
const tests = ["fms", "iso", "cmj", "sj", "dj", "hop", "cmrj", "imtp", "squat", "bench", "deadlift", "mb", "pushup", "mas", "mss", "ift", "cpet"];
Object.keys(r.enabled).forEach(id => { r.enabled[id] = tests.includes(id); });
r.data.fms.forEach((row, i) => { Object.assign(row, row.bilateral
  ? { left: [3, 2, 2, 2, 3, 2, 2][i], right: [3, 3, 2, 2, 3, 3, 2][i] }
  : { score: [3, 2, 2, 2, 3, 2, 2][i] }); });
r.data.iso.forEach((row, i) => {
  const target = 240 + i * 28; row.target = target; row.notes = "模拟固定姿势测量";
  const left = i === 1 ? .87 : i === 5 ? .93 : 1.03;
  const right = i === 1 ? .92 : i === 5 ? 1.05 : 1.06;
  row.trials = [.97, 1, 1.02].map((factor, j) => ({ id: `public-iso-${i}-${j}`,
    ...(row.paired ? { left: Math.round(target * factor * left), right: Math.round(target * factor * right) }
      : { center: Math.round(target * factor * (i === 1 ? .88 : 1.04)) }), notes: "" }));
});
r.data.cmj = [43, 45, 44].map((height, i) => ({ id: `public-cmj-${i}`, height,
  force: 1900 + i * 50, rsiModified: height / 100 / .65, propulsiveDurationMs: 320,
  propulsiveImpulse: 450 + i * 10, landingPeakForce: 2750 + i * 50, metrics: {}, notes: "" }));
r.data.sj = [37, 39, 38].map((height, i) => ({ id: `public-sj-${i}`, height,
  force: 1700 + i * 50, rsiModified: height / 100 / .75, metrics: {}, notes: "" }));
r.data.dj = [35, 37, 36].map((height, i) => ({ ...M.newJumpAttempt("dj"), id: `public-dj-${i}`,
  height, contactTimeMs: 180 + i * 5, dropHeightCm: 40, flightTimeMs: Math.sqrt(8 * height / 100 / 9.81) * 1000 }));
const hop = M.newHopSet(); hop.id = "public-hop-set"; hop.inputMode = "jumps";
hop.jumps = Array.from({ length: 10 }, (_, i) => ({ id: `public-hop-${i}`, height: 28 + i % 4,
  contactTimeMs: 155 + i % 3 * 4, flightTimeMs: Math.sqrt(8 * (28 + i % 4) / 100 / 9.81) * 1000, notes: "" }));
r.data.hop = { ...r.data.hop, trials: [hop] };
r.data.cmrj = [{ ...M.newJumpAttempt("cmrj"), id: "public-cmrj", firstHeight: 44,
  firstTimeToTakeoffMs: 650, height: 33, contactTimeMs: 165, flightTimeMs: Math.sqrt(8 * .33 / 9.81) * 1000 }];
r.data.imtp = [3200, 3350, 3300].map((peakForce, i) => ({ id: `public-imtp-${i}`, peakForce,
  baselineForce: 120, peakTimeMs: 460, impulse250: 580 + i * 10, matchedImpulse: 725 + i * 10,
  matchedDurationMs: 320, timePoints: [100, 200, 300].map((timeMs, j) => ({
    id: `public-imtp-${i}-${j}`, timeMs, force: [1050, 1880, 2610][j] + i * 20 })) }));
r.dsi = { ...r.dsi, source: "imtp", force: 3350, confirmed: true };
r.impulseConfig.confirmed = true;
for (const [id, loads, speeds] of [["squat", [35, 55, 75, 95], [1.16, .96, .77, .58]],
  ["bench", [15, 30, 45, 60], [1.19, .98, .77, .56]], ["deadlift", [45, 70, 95, 120], [1.05, .84, .63, .42]]]) {
  r.data[id] = loads.map((load, i) => ({ id: `public-${id}-${i}`, load, velocity: speeds[i], notes: "" }));
  r.lvp[id].mvt = id === "bench" ? .2 : .3;
}
r.data.mb = ["D", "ND"].flatMap((side, j) => [0, 1, 2].map(i => ({ id: `public-mb-${side}-${i}`,
  side, distance: 13.2 + i * .25 - j * .7, notes: "" })));
r.data.pushup = { reps: "", notes: "模拟规范动作", trials: [54, 56, 55].map((reps, i) => ({ id: `public-pushup-${i}`, reps })) };
r.data.mas = { speed: 4.5, unit: "m/s", method: "模拟连续递增测试" };
r.data.mss = { speed: 8.8, unit: "m/s", method: "模拟飞行计时" };
r.data.ift = { speed: 5.8, unit: "m/s", protocol: "shuttle", partial: "" };
r.data.cpet = { ...r.data.cpet, modality: "treadmill", protocol: "模拟跑台递增测试",
  oxygenLabel: "VO2peak", vo2: 56, peakHr: 190, rer: 1.12, thresholds: {
    first: { ...r.data.cpet.thresholds.first, vo2: 36, hr: 145, speed: 3.5 },
    second: { ...r.data.cpet.thresholds.second, vo2: 47, hr: 172, speed: 4.4 } } };
r.views.capabilitySelections = { strength: "eur", reactive: "dj_rsi", speed: "srr" };
for (const definition of r.definitions) if (definition.scoring !== false) definition.referenceEnabled = true;
const record = M.normalizeRecord(r); M.validateRecord(record);
record.narrative = { text: "本报告为模拟示例。可查看能力结构、具体数据与原始试次，也可编辑和导出。",
  html: "<p>本报告为模拟示例。可查看能力结构、具体数据与原始试次，也可编辑和导出。</p>",
  origin: "manual", revision: 1, updated: instant, basis: M.fingerprint(record) };
const profile = context.RingsideEvaluation.create(record, "模拟示例评价方案");
const envelope = M.recordEnvelope(record, profile);
assert.equal(envelope.record.athlete.name, "演示运动员（模拟数据）");
assert.equal(envelope.record.athlete.injuryHistory, "");
const source = fs.readFileSync(path.join(root, "MotionBench.html"), "utf8");
const embedded = /(<script id="embedded-data" type="application\/json">)[\s\S]*?(<\/script>)/;
assert.ok(embedded.test(source), "Missing embedded-data payload");
assert.equal(source.match(embedded)[0].replace(/<[^>]*>/g, "").trim(), "null", "Demo must start from clean production HTML");
let html = source.replace(embedded, (_, open, close) => open + "\n" + JSON.stringify(envelope).replace(/</g, "\\u003c") + "\n" + close);
// A separate database and preference namespace prevents reusing earlier live-page data.
const namespaces = ["motionbench-v3:", "ringside-library-v2:", "ringside-local-v1:",
  "ringside-ui-v1:", "ringside-entry-session-v1:", "ringside-input-drafts-v1:"];
for (const name of namespaces) { assert.ok(html.includes('"' + name + '"')); html = html.replaceAll('"' + name + '"', '"public-demo-' + name + '"'); }
html = html.replace("<title>MotionBench · 运动表现评估</title>", "<title>MotionBench 在线演示 · 模拟数据</title>");
const style = '<style id="public-demo-style">.public-demo-banner{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 24px;background:#eef3f8;border-bottom:1px solid #dae4ed;color:#496075;font-size:12px;line-height:1.6}.public-demo-banner strong{font-weight:650;color:#365b80}.public-demo-banner a{color:#365b80;text-decoration:none;white-space:nowrap}.public-demo-banner a:hover{text-decoration:underline}@media(max-width:519px){.public-demo-banner{padding:9px 16px;align-items:flex-start;flex-wrap:wrap;gap:4px}.public-demo-banner span{flex-basis:100%}}</style>';
html = html.replace("</head>", style + "\n</head>");
const banner = '<div class="public-demo-banner no-print" aria-label="在线演示说明"><span><strong>在线演示</strong> · 初始数据为模拟数据，修改仅保存在当前浏览器。</span><a href="https://github.com/ZekeNiu/MotionBench/releases/tag/v2.19.1-desktop.1" target="_blank" rel="noopener noreferrer">下载 Windows 版 ↗</a></div>';
html = html.replace('<div id="workspace" class="workspace">', '<div id="workspace" class="workspace">\n' + banner);
assert.ok(html.includes(banner));
assert.doesNotMatch(html, /王京奥|王京奧|(?:sk-|ghp_|github_pat_)[A-Za-z0-9_-]{20,}/, "Private name or credential detected");
assert.doesNotMatch(html, /<script[^>]+src\s*=|<link[^>]+href\s*=\s*["']https?:|https?:\/\/[^\s"']+\.(?:jsonl|xlsx|db|sqlite)/i, "Public page must not load external code or data");
const publicFiles = ["index.html", ".nojekyll", "demo-build.json"];
if (fs.existsSync(out)) assert.ok(fs.readdirSync(out).every(name => publicFiles.includes(name)), "Unexpected file in public deployment directory");
fs.mkdirSync(out, { recursive: true });
const manifest = { format: "motionbench-public-demo-v1", version: JSON.parse(fs.readFileSync(path.join(root, "package.json"))).version,
  productionHtmlSha256: sha(source), indexSha256: sha(html), seedSha256: sha(JSON.stringify(envelope)),
  seed: { origin: "constructed-from-blank-defaults", simulated: true, athletes: 1, records: 1, date: "2026-01-15" },
  storage: { namespace: "public-demo-", isolated: true }, files: publicFiles };
fs.writeFileSync(path.join(out, "index.html"), html);
fs.writeFileSync(path.join(out, ".nojekyll"), "");
fs.writeFileSync(path.join(out, "demo-build.json"), JSON.stringify(manifest, null, 2) + "\n");
assert.deepEqual(fs.readdirSync(out).sort(), manifest.files.slice().sort(), "Unexpected file in public deployment directory");
console.log("Built public demo from synthetic blank-default fixture: " + manifest.indexSha256);
module.exports = { envelope, manifest, out };
