"use strict";
const assert = require("node:assert/strict");

async function assertTeamScreening(page, { clickRegion = true } = {}) {
  assert.equal(await page.locator("#bodyChart .comparison-body-facets").count(), 0);
  assert.equal(await page.locator("#bodyChart .comparison-screening-chart svg[viewBox]").count(), 1);
  const actual = await page.evaluate(() => {
    const model = App.getComparison(), views = App.getComparisonDocument().views;
    const date = model.dates.includes(views.screeningDate) ? views.screeningDate : model.dates.at(-1);
    const period = model.summary.periods.find(period => period.date === date), regions = Object.values(period.regions || {});
    const axes = [...new Set(model.summary.periods.flatMap(period => Object.keys(period.regions || {})))];
    const svg = document.querySelector("#bodyChart .comparison-screening-chart svg"), colors = RingsideViz.C;
    const expected = model.athletes.flatMap(athlete => axes.map(region => {
      const summary = regions.find(summary => summary.key === region), member = summary?.members.find(member => member.athleteId === athlete.id);
      const entry = model.entries.find(entry => entry.athleteId === athlete.id && entry.date === date), status = member?.status || "gray";
      return { athleteId: athlete.id, name: athlete.name, region, date, status,
        value: ({ green: 3, amber: 2, red: 1 })[status] ?? null,
        recordId: member?.recordId || entry?.recordId || "", pain: member?.tests.some(test => test.pain === true) || false,
        measured: summary?.n || 0, assessed: (summary?.redCount || 0) + (summary?.amberCount || 0) + (summary?.greenCount || 0) };
    }));
    return {
      date, colors: { green: colors.green, amber: colors.amber, red: colors.red }, selected: model.athletes.length,
      sidebarExpected: regions.filter(region=>region.n>0).map(region=>({region:region.key,date,counts:[region.redCount||0,region.amberCount||0,region.n],members:region.members.map(member=>({athleteId:member.athleteId,recordId:member.recordId}))})),
      sidebar: [...document.querySelectorAll("#screenItems .comparison-region-members")].map(detail=>({region:detail.dataset.region,date:detail.dataset.date,counts:detail.querySelector("summary span").textContent.match(/\d+/g).map(Number),members:[...detail.querySelectorAll("p[data-athlete-id]")].map(member=>({athleteId:member.dataset.athleteId,recordId:member.dataset.recordId}))})),
      axes, renderedAxes: [...svg.querySelectorAll(".comparison-screening-axis")].map(axis => axis.dataset.region), expected,
      center: { x: Number(svg.dataset.centerX), y: Number(svg.dataset.centerY), radius: Number(svg.dataset.maxRadius), maximum: Number(svg.dataset.maxValue) },
      rings: [...svg.querySelectorAll(".comparison-screening-grade-ring")].map(ring => ({ grade: Number(ring.dataset.grade), fill: ring.getAttribute("fill"), points: ring.getAttribute("points").trim().split(/\s+/).map(point => point.split(",").map(Number)) })),
      series: [...svg.querySelectorAll(".comparison-screening-series")].map(series => ({ athleteId: series.dataset.athleteId, date: series.dataset.date,
        segments: [...series.querySelectorAll(".comparison-screening-segment")].map(segment => ({ from: segment.dataset.screeningFrom, to: segment.dataset.screeningTo })),
        filledPolygon: series.querySelectorAll("polygon").length })),
      rows: [...svg.querySelectorAll(".comparison-screening-row")].map(row => {
        const point = row.querySelector(".comparison-screening-point");
        return { athleteId: row.dataset.athleteId, region: row.dataset.region, date: row.dataset.date,
          status: row.dataset.status, recordId: row.dataset.recordId, value: row.dataset.value === "" ? null : Number(row.dataset.value),
          measured: Number(row.dataset.measuredN), assessed: Number(row.dataset.assessedN), unknown: Number(row.dataset.unknownCount),
          point: point && { x: Number(point.getAttribute("cx")), y: Number(point.getAttribute("cy")), fill: point.getAttribute("fill") } };
      })
    };
  });
  assert.deepEqual(actual.renderedAxes, actual.axes);
  assert.equal(actual.sidebar.length,actual.sidebarExpected.length);
  for(const expected of actual.sidebarExpected)assert.deepEqual(actual.sidebar.find(detail=>detail.region===expected.region),expected,"The adjacent detail list follows the displayed screening date and its original records");
  assert.equal(actual.center.maximum, 3);
  assert.ok(actual.center.radius > 0);
  assert.equal(actual.rings.length, 3);
  for (const ring of actual.rings) {
    assert.equal(ring.fill, actual.colors[{ 1: "red", 2: "amber", 3: "green" }[ring.grade]]);
    assert.equal(ring.points.length, actual.axes.length);
    for (const [x, y] of ring.points) assert.ok(Math.abs(Math.hypot(x - actual.center.x, y - actual.center.y) / actual.center.radius * 3 - ring.grade) < 0.001);
  }
  assert.equal(actual.rows.length, actual.expected.length);
  for (const expected of actual.expected) {
    const row = actual.rows.find(row => row.athleteId === expected.athleteId && row.region === expected.region);
    assert.ok(row, "Every selected athlete keeps every original region and side");
    for (const key of ["date", "status", "recordId", "value", "measured", "assessed"]) assert.equal(row[key], expected[key]);
    assert.equal(row.unknown, actual.selected - expected.assessed);
    if (expected.value === null) assert.equal(row.point, null, "Unknown is absent rather than plotted as zero");
    else {
      assert.ok(row.point);
      assert.equal(row.point.fill, actual.colors[expected.status]);
      assert.ok(Math.abs(Math.hypot(row.point.x - actual.center.x, row.point.y - actual.center.y) / actual.center.radius * 3 - expected.value) < 0.001);
    }
  }
  assert.equal(actual.series.length, actual.selected);
  for (const series of actual.series) {
    assert.equal(series.date, actual.date);
    const values = actual.expected.filter(row => row.athleteId === series.athleteId);
    const pairs = values.flatMap((row, index) => row.value !== null && values[(index + 1) % values.length].value !== null ? [{ from: row.region, to: values[(index + 1) % values.length].region }] : []);
    assert.deepEqual(series.segments, pairs, "Lines connect only adjacent known regions and never bridge unknown regions");
    assert.equal(series.filledPolygon, values.every(row => row.value !== null) ? 1 : 0);
  }
  assert.ok((await page.locator(".comparison-screening-active-date").innerText()).includes(actual.date));
  if (clickRegion) {
    const expected = actual.expected.filter(row => row.value !== null).at(-1);
    assert.ok(expected);
    const selector = row => `#bodyChart .comparison-screening-row[data-athlete-id="${row.athleteId}"][data-region="${row.region}"][data-date="${row.date}"]`;
    await page.locator(selector(expected)).click();
    assert.equal(await page.locator("#bodyRegionTooltip").isVisible(), true);
    let detail = await page.locator("#bodyRegionTooltip").innerText();
    assert.ok(detail.includes(expected.date) && detail.includes(expected.name));
    assert.match(detail, new RegExp(expected.value + "\\s*级"));
    assert.ok(detail.includes({ red: "预警", amber: "关注", green: "达标" }[expected.status]));
    await page.keyboard.press("Escape");
    const pain = actual.expected.find(row => row.pain && row.value !== null);
    if (pain) {
      await page.locator(selector(pain)).focus();await page.locator(selector(pain)).press("Enter");
      detail = await page.locator("#bodyRegionTooltip").innerText();assert.ok(detail.includes(pain.name));assert.match(detail, /疼痛/);await page.keyboard.press("Escape");
    }
    assert.equal(await page.locator("#bodyRegionTooltip").isVisible(), false);
  }
  return { date: actual.date, people: actual.selected, axes: actual.axes.length, points: actual.rows.filter(row => row.point).length,
    unknown: actual.rows.filter(row => !row.point).length, singleRadar: true, originalGradesAndRecordsVerified: true };
}

async function comparisonInvariantFingerprint(page) {
  return page.evaluate(async () => {
    const model = App.getComparison(), records = await App.getRepository().values("records");
    const digest = async value => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value))))].map(byte => byte.toString(16).padStart(2, "0")).join("");
    return { records: await digest(records.sort((a, b) => a.recordId.localeCompare(b.recordId))),
      metrics: await digest({ statistics: model.statistics, metrics: model.metrics.map(metric => ({ key: metric.key, cohortIds: metric.cohortIds, periods: metric.periods, changes: metric.changes, trend: metric.trend })) }) };
  });
}

module.exports = { assertTeamScreening, comparisonInvariantFingerprint };
