(function (root) {
  "use strict";
  const freeze = object => { Object.values(object).forEach(value => { if (value && typeof value === "object") freeze(value); }); return Object.freeze(object); };
  const theme = freeze({
    id: "ink-teal-history-v1", paper: "#f6f9f8", surface: "#ffffff", ink: "#213836", muted: "#60736e", grid: "#dce6e2", border: "#cedcd6", accent: "#066c64",
    jumps: { cmj: "#066c64", sj: "#458f86", dj: "#0e6f81", hop: "#5191a1", cmrj: "#0d5665" },
    rsi: "#4e586c", force: "#066c64", power: "#8d662c", reference: "#5f6e69", elasticityCombined: "#945a8f", tertiary: "#945a8f", er: "#2c7fb1", fourth: "#2c7fb1",
    persons8: ["#067970", "#2c7fb1", "#a1732b", "#945a8f", "#bd615b", "#58854e", "#6964ac", "#8e8945"],
    historicalAnchors7: ["#529b92", "#2f939a", "#0488a3", "#067bab", "#1f6cb0", "#345caf", "#4248a4"], latest: "#014e47"
  });
  const own = (object, key) => Object.hasOwn(object, key);
  const dictionary = () => Object.create(null);
  const linear = value => { const v = value / 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; };
  const rgb = hex => [1, 3, 5].map(index => linear(parseInt(hex.slice(index, index + 2), 16)));
  const hex = values => "#" + values.map(value => Math.round(Math.max(0, Math.min(1, value <= .0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - .055)) * 255).toString(16).padStart(2, "0")).join("");
  const contrast = color => { const [r, g, b] = rgb(color); return 1.05 / (.2126 * r + .7152 * g + .0722 * b + .05); };
  function hue(color) {
    const [r, g, b] = rgb(color), l = Math.cbrt(.4122214708 * r + .5363325363 * g + .0514459929 * b), m = Math.cbrt(.2119034982 * r + .6806995451 * g + .1073969566 * b), s = Math.cbrt(.0883024619 * r + .2817188376 * g + .6299787005 * b);
    return (Math.atan2(.0259040371 * l + .7827717662 * m - .808675766 * s, 1.9779984951 * l - 2.428592205 * m + .4505937099 * s) * 180 / Math.PI + 360) % 360;
  }
  function fromLCH(lightness, chroma, angle) {
    for (let attempt = 0; attempt < 100; attempt++, chroma *= .98) {
      const a = chroma * Math.cos(angle * Math.PI / 180), b = chroma * Math.sin(angle * Math.PI / 180), l = (lightness + .3963377774 * a + .2158037573 * b) ** 3, m = (lightness - .1055613458 * a - .0638541728 * b) ** 3, s = (lightness - .0894841775 * a - 1.291485548 * b) ** 3;
      const values = [4.0767416621 * l - 3.3077115913 * m + .2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - .3413193965 * s, -.0041960863 * l - .7034186147 * m + 1.707614701 * s];
      if (values.every(value => value >= 0 && value <= 1)) return hex(values);
    }
    return hex([lightness ** 3, lightness ** 3, lightness ** 3]);
  }
  // This palette grows without reassigning earlier slots or cycling eight hues.
  const palette = [...theme.persons8], paletteHues = palette.map(hue);
  function categoryColor(index) {
    let attempts = 0;
    while (palette.length <= index) {
      const sorted = paletteHues.slice().sort((a, b) => a - b); let gap = -1, start = 0;
      sorted.forEach((value, i) => { const size = (i + 1 < sorted.length ? sorted[i + 1] : sorted[0] + 360) - value; if (size > gap + 1e-10) { gap = size; start = value; } });
      const angle = (start + gap / 2) % 360, lightness = palette.length < 16 ? .57 : palette.length % 2 === 0 ? .62 : .52, color = fromLCH(lightness, .11, angle);
      paletteHues.push(angle);
      // Dense reports eventually exceed what quantized colors can distinguish.
      // Keep allocation bounded and every identity visible even in that case.
      const visible = contrast(color) >= 3; attempts++;
      if (visible && !palette.includes(color) || attempts >= 32) { palette.push(visible ? color : theme.reference); attempts = 0; }
    }
    return palette[index];
  }
  function colors(ids) {
    const result = dictionary();
    for (const value of ids || []) { const id = String(value); if (!own(result, id)) result[id] = categoryColor(Object.keys(result).length); }
    return result;
  }
  function historicalColor(position) {
    const at = Math.max(0, Math.min(1, position)) * (theme.historicalAnchors7.length - 1), i = Math.floor(at), next = Math.min(i + 1, theme.historicalAnchors7.length - 1), fraction = at - i;
    if (!fraction) return theme.historicalAnchors7[i];
    const a = rgb(theme.historicalAnchors7[i]), b = rgb(theme.historicalAnchors7[next]);
    return hex(a.map((value, channel) => value + (b[channel] - value) * fraction));
  }
  function naturalDay(period) {
    const date = String(period?.date || period?.record?.athlete?.date || period?.athlete?.date || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "";
    const parsed = new Date(date + "T00:00:00Z");
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : "";
  }
  const recordId = period => String(period?.recordId || period?.id || "");
  function title(period, day) {
    if (period.title || period.record?.title || period.source?.title) return String(period.title || period.record?.title || period.source?.title);
    return String(period.label || "").replace(new RegExp("^" + day + "(?:\\s*·\\s*\\d+)?\\s*"), "").replace(/^·\s*/, "").trim();
  }
  function dates(periods) {
    const list = periods || [], days = [...new Set(list.map(naturalDay).filter(Boolean))].sort(), latestDay = days.at(-1) || "", byDate = dictionary(), byRecord = dictionary(), counts = dictionary();
    list.forEach(period => { const day = naturalDay(period); counts[day] = (counts[day] || 0) + 1; });
    days.forEach((day, index) => { const latest = day === latestDay; byDate[day] = { color: latest ? theme.latest : historicalColor(days.length > 2 ? index / (days.length - 2) : 0), strokeWidth: latest ? 2.6 : 1.8, latest }; });
    const ids = list.map(recordId);
    list.forEach(period => {
      const id = recordId(period), day = naturalDay(period); if (!id || !byDate[day]) return;
      let length = Math.min(6, id.length); while (length < id.length && ids.some(other => other !== id && other.slice(-length) === id.slice(-length))) length++;
      let prefixLength = Math.min(6, id.length); while (prefixLength < id.length && ids.some(other => other !== id && other.slice(0, prefixLength) === id.slice(0, prefixLength))) prefixLength++;
      const shortId = prefixLength < length ? id.slice(0, prefixLength) + "…" : id.slice(-length);
      const suffix = counts[day] > 1 ? " · " + [title(period, day), "#" + shortId].filter(Boolean).join(" ") : "";
      byRecord[id] = { ...byDate[day], label: day + suffix };
    });
    return { byDate, byRecord, latestDay };
  }
  // Facts may contain callable fitted models. Keep them intact; clone only the
  // display tree, which is the sole owner of the projected colors and labels.
  const facts = new Set(["record", "records", "stats", "report", "profile", "catalog", "configuration", "appearance", "narrative", "previousNarrative", "changeSummary", "cells", "context", "assessment", "evaluation", "benchmark", "findings", "advantages", "sourceMappings", "evaluationProfiles", "classifications", "source", "athlete", "data", "definitions", "rules", "trainingContext", "measurementContexts"]);
  function project(input) {
    if (!input || typeof input !== "object") return input;
    const horizontal = input.kind === "horizontal" || Array.isArray(input.participants) && !Array.isArray(input.periods), people = input.participants || [], periods = input.periods || [], records = new Map((input.records || []).map(record => [record.recordId, record]));
    let appearance = input.appearance?.themeId === theme.id ? input.appearance : null;
    if (!appearance) {
      const temporal = horizontal ? { byDate: dictionary(), byRecord: dictionary(), latestDay: "" } : dates(periods.map(period => ({ ...period, title: records.get(recordId(period))?.title || period.title })));
      const byAthlete = horizontal ? colors(people.map(person => person.athleteId || person.id)) : dictionary(), byRecord = temporal.byRecord;
      if (horizontal) people.forEach(person => { byRecord[recordId(person)] = { color: byAthlete[person.athleteId || person.id], strokeWidth: 1.8, latest: false, label: person.label }; });
      appearance = { themeId: theme.id, byRecord, byAthlete, byDate: temporal.byDate, latestDay: temporal.latestDay };
    }
    const originals = new Map([...periods, ...people].map(period => [recordId(period), period.label || period.date || recordId(period)])), ids = Object.keys(appearance.byRecord).sort((a, b) => b.length - a.length), references = (input.references || []).map(reference => reference.id), seen = new WeakMap();
    function clone(value, key = "") {
      if (!value || typeof value !== "object" || facts.has(key)) return value;
      if (seen.has(value)) return seen.get(value);
      const copy = Array.isArray(value) ? [] : {}; seen.set(value, copy);
      for (const [name, item] of Object.entries(value)) copy[name] = clone(item, name);
      if (Array.isArray(copy)) return copy;
      const candidate = String(copy.recordId || copy.periodId || copy.id || ""), id = own(appearance.byRecord, candidate) ? candidate : ids.find(item => candidate.startsWith(item + ":")), entry = id && appearance.byRecord[id];
      const display = own(copy, "color") || Array.isArray(copy.points) || Array.isArray(copy.values) || own(copy, "date") && !own(copy, "value");
      if (entry && display) {
        copy.color = entry.color; copy.strokeWidth = entry.strokeWidth; copy.latest = entry.latest;
        if (entry.label) { const previous = originals.get(id); copy.displayLabel = previous && copy.label?.startsWith(previous) ? entry.label + copy.label.slice(previous.length) : copy.label || entry.label; }
      } else if (display && references.some(reference => candidate === reference || candidate.startsWith(reference + ":"))) copy.color = theme.reference;
      return copy;
    }
    const output = clone(input); output.appearance = appearance; return output;
  }
  function apply(container) {
    if (!container?.dataset || !container.style) return;
    container.dataset.reportAppearance = theme.id;
    for (const [name, value] of Object.entries(theme)) if (typeof value === "string" && value.startsWith("#")) container.style.setProperty("--report-appearance-" + name.replace(/[A-Z]/g, letter => "-" + letter.toLowerCase()), value);
  }
  root.RingsideReportAppearance = Object.freeze({ theme, tokens: () => theme, testColor: id => own(theme.jumps, id) ? theme.jumps[id] : theme.accent, colors, dates, project, apply });
})(typeof window !== "undefined" ? window : globalThis);
