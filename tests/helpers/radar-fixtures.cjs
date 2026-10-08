"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm");
const c = vm.createContext({
  console,
  Intl,
  crypto: require("node:crypto").webcrypto,
});
c.window = c;
for (const name of ["calc", "cpet-reference", "definitions", "tests", "model", "interventions"])
  vm.runInContext(
    fs.readFileSync(
      path.join(__dirname, "../../src/ringside-" + name + ".js"),
      "utf8",
    ),
    c,
  );
function radarFixture() {
  const M = c.RingsideModel,
    r = M.sampleRecord();
  r.athlete.name = "双系列雷达与扩展试次合成验收";
  r.trainingContext = {
    experienceYears: 2,
    equipment: "杠铃、哑铃、药球",
    weeklySessions: 2,
    weeklySchedule: "周二、周六体能；其他训练按既有安排",
  };
  r.data.iso = ["neck", "shoulder", "hip", "knee", "ankle"].flatMap(
    (region, i) =>
      [0, 1].map((j) => ({
        id: `radar_${region}_${j}`,
        region,
        direction: `验收方向${j + 1}·长名称用于核验排版`,
        directionCode: j ? "extension" : "flexion",
        paired: true,
        left: 60 + i * 8 + j * 15,
        right: 100 + i * 10,
        target: j ? 100 : 70,
        unit: j ? "kgf" : "N",
        painLeft: region === "shoulder" && j === 1,
        painRight: false,
        notes: "合成数据",
      })),
  );
  r.balancePairs = [
    {
      id: "radar_balance",
      label: "配对验收",
      region: "shoulder",
      numeratorId: "radar_shoulder_0",
      denominatorId: "radar_shoulder_1",
      confirmed: true,
      referenceEnabled: false,
      ranges: [],
    },
  ];
  r.data.cmj = Array.from({ length: 6 }, (_, i) => ({
    id: "jump_" + i,
    height: i === 5 ? "" : 30 + i * 4,
    rsiModified: i === 2 ? "" : 0.3 + i * 0.05,
    force: 1000 + i * 100,
    landingPeakForce: 2300 + i * 200,
    metrics: {},
  }));
  r.data.sj = [
    {
      id: "sj_one",
      height: 28,
      rsiModified: 0.25,
      force: 950,
      landingPeakForce: 2100,
    },
  ];
  for (let i = 0; i < 6; i++) {
    const id = "trial_extra_" + i;
    r.definitions.push({
      id,
      testId: "cmj",
      name: "试次扩展指标 " + (i + 1),
      unit: i % 2 ? "N" : "s",
      entryScope: "attempt",
      category: "performance",
      ability: "爆发力",
      direction: "higher",
      target: 100,
      referenceEnabled: false,
      ranges: [],
    });
    r.data.cmj.forEach((row, j) => (row.metrics[id] = i * 10 + j));
  }
  r.data.imtp = [
    {
      id: "force_one",
      peakForce: 2600,
      baselineForce: 0,
      timePoints: [
        { id: "t1", timeMs: 100, force: 600, rfd: 6000 },
        { id: "t2", timeMs: 150, force: "", rfd: 7000 },
        { id: "t3", timeMs: 200, force: 1700, rfd: 8500 },
      ],
    },
    {
      id: "force_two",
      peakForce: 2800,
      baselineForce: "",
      timePoints: [{ id: "t4", timeMs: 125, force: "", rfd: 4321 }],
    },
  ];
  r.data.lactate.push({ id: "partial_hr", speed: 5.2, lactate: "", hr: 195 });
  r.views.lvpUpper.selected = ["bench", "landmineR", "landmineL"];
  r.views.lvpUpper.selectionExplicit = true;
  r.lvp.landmineR.mvt = 0.5;
  r.lvp.landmineL.mvt = 0.5;
  const next = M.normalizeRecord(r);
  M.validateRecord(next);
  return JSON.parse(JSON.stringify(next));
}
module.exports = { radarFixture };
