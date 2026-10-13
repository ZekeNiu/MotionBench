"use strict";
const assert = require("node:assert/strict");

async function assertPersonalScreening(page, { clickRegion = true } = {}) {
  assert.equal(await page.locator("#bodyChart .comparison-body-facets").count(), 0);
  assert.equal(await page.locator("#bodyChart .comparison-screening-chart svg[viewBox]").count(), 1);
  const actual = await page.evaluate(() => {
    const model = App.getComparison(), athlete = model.athletes[0];
    const regionList = period => Array.isArray(period?.regions) ? period.regions : Object.values(period?.regions || {});
    const regions = date => regionList(model.summary.periods.find(period => period.date === date));
    const svg = document.querySelector("#bodyChart .comparison-screening-chart svg");
    const axes = [...svg.querySelectorAll(".comparison-screening-axis")].map(axis => axis.dataset.region);
    const expected = model.dates.flatMap(date => axes.map(region => {
      const summary = regions(date).find(item => item.key === region), member = summary?.members.find(item => item.athleteId === athlete.id);
      const entry = model.entries.find(item => item.date === date), status = member?.status || "gray";
      return { region, date, status, value: ({ green: 3, amber: 2, red: 1 })[status] ?? null,
        recordId: member?.recordId || entry?.recordId || "", pain: member?.tests.some(test => test.pain === true) || false,
        originalTests: member?.tests || summary?.tests || [] };
    }));
    return { dates: model.dates, athleteId: athlete.id, selected: model.athletes.length, axes, expected,
      colors: { green: RingsideViz.C.green, amber: RingsideViz.C.amber, red: RingsideViz.C.red },
      sidebar: [...document.querySelectorAll("#screenItems .comparison-region-members")].map(detail => ({ region: detail.dataset.region,
        rows: [...detail.querySelectorAll("p[data-date]")].map(row => ({ date: row.dataset.date, recordId: row.dataset.recordId, text: row.textContent })) })),
      center: { x: Number(svg.dataset.centerX), y: Number(svg.dataset.centerY), radius: Number(svg.dataset.maxRadius), maximum: Number(svg.dataset.maxValue) },
      rings: [...svg.querySelectorAll(".comparison-screening-grade-ring")].map(ring => ({ grade: Number(ring.dataset.grade), fill: ring.getAttribute("fill"),
        points: ring.getAttribute("points").trim().split(/\s+/).map(point => point.split(",").map(Number)) })),
      series: [...svg.querySelectorAll(".comparison-screening-series")].map(series => ({ date: series.dataset.date,
        segments: [...series.querySelectorAll(".comparison-screening-segment")].map(segment => ({ from: segment.dataset.screeningFrom, to: segment.dataset.screeningTo })),
        filledPolygon: series.querySelectorAll("polygon").length })),
      rows: [...svg.querySelectorAll(".comparison-screening-row")].map(row => {
        const point = row.querySelector(".comparison-screening-point");
        return { region: row.dataset.region, date: row.dataset.date, status: row.dataset.status, recordId: row.dataset.recordId,
          value: row.dataset.value === "" ? null : Number(row.dataset.value), detail: JSON.parse(row.dataset.bodyDetail),
          point: point && { x: Number(point.getAttribute("cx")), y: Number(point.getAttribute("cy")), fill: point.getAttribute("fill") } };
      }) };
  });
  assert.equal(actual.selected, 1);
  assert.equal(actual.center.maximum, 3);
  assert.equal(actual.axes.length, new Set(actual.axes).size);
  assert.ok(actual.axes.length >= 18 && actual.center.radius > 0);
  assert.equal(actual.rings.length, 3);
  for (const ring of actual.rings) {
    assert.equal(ring.fill, actual.colors[{ 1: "red", 2: "amber", 3: "green" }[ring.grade]]);
    assert.equal(ring.points.length, actual.axes.length);
    for (const [x, y] of ring.points) assert.ok(Math.abs(Math.hypot(x - actual.center.x, y - actual.center.y) / actual.center.radius * 3 - ring.grade) < 0.001);
  }
  assert.equal(actual.rows.length, actual.expected.length);
  for (const expected of actual.expected) {
    const row = actual.rows.find(row => row.date === expected.date && row.region === expected.region);
    assert.ok(row, "Every date retains every original region and side");
    for (const key of ["date", "status", "recordId", "value"]) assert.equal(row[key], expected[key]);
    assert.deepEqual(row.detail.tests.slice(1), expected.originalTests, "Popup retains the actual original measurements, pain and notes");
    assert.equal(row.detail.tests[0].value, expected.value);
    if (expected.value === null) assert.equal(row.point, null, "Unknown is absent instead of plotted as zero");
    else {
      assert.ok(row.point);
      assert.equal(row.point.fill, actual.colors[expected.status]);
      assert.ok(Math.abs(Math.hypot(row.point.x - actual.center.x, row.point.y - actual.center.y) / actual.center.radius * 3 - expected.value) < 0.001);
    }
  }
  assert.deepEqual(actual.series.map(series => series.date), actual.dates);
  for (const series of actual.series) {
    const values = actual.expected.filter(row => row.date === series.date);
    const pairs = values.flatMap((row, index) => row.value !== null && values[(index + 1) % values.length].value !== null ? [{ from: row.region, to: values[(index + 1) % values.length].region }] : []);
    assert.deepEqual(series.segments, pairs, "Lines never bridge unknown regions");
    assert.equal(series.filledPolygon, 0, "Date paths do not conceal other dates with a filled polygon");
  }
  for (const detail of actual.sidebar) {
    assert.deepEqual(detail.rows.map(row => row.date), actual.dates);
    for (const row of detail.rows) assert.equal(row.recordId, actual.expected.find(item => item.date === row.date && item.region === detail.region).recordId);
  }
  if (clickRegion) {
    const expected = actual.expected.filter(row => row.value !== null).at(-1);
    assert.ok(expected);
    const locator = row => page.locator(`#bodyChart .comparison-screening-row[data-region="${row.region}"][data-date="${row.date}"]`);
    await locator(expected).focus(); await locator(expected).press("Enter");
    assert.equal(await page.locator("#bodyRegionTooltip").isVisible(), true);
    let detail = await page.locator("#bodyRegionTooltip").innerText();
    assert.ok(detail.includes(expected.date));
    assert.match(detail, new RegExp(expected.value + "\\s*级"));
    assert.ok(detail.includes({ red: "预警", amber: "关注", green: "达标" }[expected.status]));
    await page.keyboard.press("Escape");
    const pain = actual.expected.find(row => row.pain && row.value !== null);
    if (pain) {
      await locator(pain).focus(); await locator(pain).press("Enter");
      detail = await page.locator("#bodyRegionTooltip").innerText();
      assert.match(detail, /疼痛/); await page.keyboard.press("Escape");
    }
    assert.equal(await page.locator("#bodyRegionTooltip").isVisible(), false);
  }
  return { dates: actual.dates.length, people: 1, axes: actual.axes.length, points: actual.rows.filter(row => row.point).length,
    unknown: actual.rows.filter(row => !row.point).length, singleRadar: true, originalGradesAndRecordsVerified: true };
}

function assertNoTeamStatistics(value) {
  const forbidden = new Set(["cohortIds", "cohortAthleteIndices", "pairedN", "p", "pRaw", "pAdjusted", "dz", "ci95", "ci", "ciLow", "ciHigh", "t", "df", "comparisonCount", "correction"]);
  function visit(item, location) {
    if (!item || typeof item !== "object") return;
    for (const [key, child] of Object.entries(item)) {
      assert.ok(!forbidden.has(key), "Personal results cannot contain team inference field " + location + "." + key);
      visit(child, location + "." + key);
    }
  }
  visit(value, "results");
}

async function comparisonInvariantFingerprint(page) {
  return page.evaluate(async () => {
    const model = App.getComparison(), records = await App.getRepository().values("records");
    const digest = async value => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value))))].map(byte => byte.toString(16).padStart(2, "0")).join("");
    return { records: await digest(records.sort((a, b) => a.recordId.localeCompare(b.recordId))),
      metrics: await digest({ statistics: model.statistics, metrics: model.metrics.map(metric => ({ key: metric.key, periods: metric.periods, changes: metric.changes, trend: metric.trend })) }) };
  });
}

async function assertOriginalFMSRadar(page, { requireZero = false } = {}) {
  const actual = await page.evaluate(() => {
    const model = App.getComparison(), selectedKeys = new Set([...document.querySelectorAll('.comparison-project[data-comparison-project="fms"] input[data-comparison-metric]:checked')].map(input => input.dataset.comparisonMetric));
    const project = model.projects.find(project => project.id === "fms");
    const metrics = project.metrics.filter(metric => selectedKeys.has(metric.key) && /^fms_\d$/.test(metric.id));
    const charts = [...document.querySelectorAll('.comparison-project[data-comparison-project="fms"] svg')].filter(svg => svg.getAttribute("aria-label") === "FMS 原动作评分");
    const svg = charts[0], viewBox = svg.viewBox.baseVal;
    return { charts: charts.length, dates: model.dates, width: viewBox.width,
      ticks: [...svg.querySelectorAll(".comparison-radar-tick")].map(tick => ({ value: Number(tick.dataset.value), label: tick.textContent.trim() })),
      expected: model.dates.flatMap(date => metrics.map(metric => ({ id: metric.id, date, label: metric.label, value: metric.observations.find(item => item.date === date)?.value ?? null }))),
      series: [...svg.querySelectorAll("g.comparison-series[data-date]")].map(series => ({ date: series.dataset.date,
        points: [...series.querySelectorAll("g[data-tooltip]")].map(point => { const mark = point.querySelector("circle"); return { tooltip: point.dataset.tooltip, x: Number(mark.getAttribute("cx")), y: Number(mark.getAttribute("cy")) }; }) })) };
  });
  assert.equal(actual.charts, 1, "Original FMS raw-score radar remains one chart");
  assert.deepEqual(actual.ticks, [0, 1, 2, 3].map(value => ({ value, label: String(value) })), "FMS shows exact and unique 0/1/2/3 ticks");
  assert.deepEqual(actual.series.map(series => series.date), actual.dates);
  const center = { x: actual.width / 2, y: 190 }, radius = Math.min(125, actual.width * .23);
  for (const series of actual.series) {
    const expected = actual.expected.filter(row => row.date === series.date);
    assert.equal(series.points.length, expected.filter(row => row.value !== null).length);
    for (const row of expected) {
      if (row.value === null) continue;
      const point = series.points.find(point => point.tooltip === `${row.label} · ${row.date}：${row.value} 分`);
      assert.ok(point, "FMS date series retains the original raw value " + row.id + " " + row.date);
      assert.ok(Math.abs(Math.hypot(point.x - center.x, point.y - center.y) - radius * row.value / 3) < .02);
      if (row.value === 0) assert.deepEqual({ x: point.x, y: point.y }, center, "FMS zero is retained at the center, independently of screening grades");
    }
  }
  const zeros = actual.expected.filter(row => row.value === 0).length;
  if (requireZero) assert.ok(zeros > 0, "This selected original FMS data contains an actual zero");
  return { exactTicks: [0, 1, 2, 3], originalZeros: zeros, dates: actual.dates.length };
}

async function assertDescriptiveChanges(page, metricIds) {
  const actual = await page.evaluate(metricIds => {
    const model = App.getComparison();
    return metricIds.map(id => ({ id, metrics: model.metrics.filter(metric => metric.id === id).map(metric => ({ key: metric.key, label: metric.label,
      changeInterpretation: metric.changeInterpretation, changes: metric.changes,
      rows: [...document.querySelectorAll("tr[data-metric-key]")].filter(row => row.dataset.metricKey === metric.key).map(row => ({ date: row.dataset.date, text: row.textContent })) })) }));
  }, metricIds);
  const details = [];
  for (const family of actual) {
    assert.ok(family.metrics.length, "No-evaluation metric exists: " + family.id);
    let changed = 0;
    for (const metric of family.metrics) {
      assert.equal(metric.changeInterpretation, "descriptive", family.id + " has no explicit evaluation basis");
      for (const change of metric.changes.filter(change => Number.isFinite(change.delta) && change.delta !== 0)) {
        changed++;
        assert.equal(change.improvement, change.delta > 0 ? "increased" : "decreased", "Arithmetic direction cannot be converted into an unsupported improvement judgment");
        assert.equal(change.changeInterpretation, "descriptive");
        const row = metric.rows.find(row => row.date === change.date);
        assert.ok(row);
        assert.doesNotMatch(row.text, /改善|下降/);
        assert.match(row.text, change.delta > 0 ? /增加/ : /减少/);
      }
    }
    assert.ok(changed > 0, "This metric provides a real nonzero change: " + family.id);
    details.push({ id: family.id, nonzeroChanges: changed, descriptiveOnly: true });
  }
  return details;
}

module.exports = { assertPersonalScreening, assertNoTeamStatistics, comparisonInvariantFingerprint, assertOriginalFMSRadar, assertDescriptiveChanges };
