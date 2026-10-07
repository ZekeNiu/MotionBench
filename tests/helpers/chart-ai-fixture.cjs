"use strict";
// Passed to page.evaluate; depends only on the isolated page's public API.
function chartFixture() {
  const r = App.getState();
  r.data.imtp = [
    { id: "full-a", peakForce: 2800, baselineForce: 100, peakTimeMs: 450, timePoints: [
      { id: "a100", timeMs: 100, force: 800, rfd: 7000 },
      { id: "a200", timeMs: 200, force: 1800, rfd: 8500 },
      { id: "a300", timeMs: 300, force: 2300, rfd: "" },
    ] },
    { id: "full-b", peakForce: 2400, baselineForce: 100, peakTimeMs: "", timePoints: [
      { id: "b100", timeMs: 100, force: 700, rfd: "" },
      { id: "b200", timeMs: 200, force: "", rfd: 7500 },
    ] },
  ];
  r.athlete.sport = "拳击";
  r.athlete.cycle = "一般准备期";
  r.trainingContext = {experienceYears: 3, weeklySessions: 2, equipment: "杠铃、哑铃、跑道", weeklySchedule: "周二和周五专项课，周一和周四可安排体能"};
  App.renderReport();
}
module.exports = { chartFixture };
