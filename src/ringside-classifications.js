(function (root) {
  "use strict";
  const clone = value => JSON.parse(JSON.stringify(value));
  const id = value => typeof value === "string" && /^[A-Za-z0-9_.:-]{1,249}$/.test(value) && !["__proto__", "constructor", "prototype"].includes(value);
  const plain = value => !!value && typeof value === "object" && !Array.isArray(value);
  const newId = prefix => prefix + "_" + root.crypto.randomUUID();
  function normalize(input = {}) {
    if (!plain(input) || input.version !== undefined && input.version !== 1) throw Error("专项分类版本无效");
    const out = { version: 1, sports: [], subdivisions: [], ageBands: [] };
    for (const kind of ["sports", "subdivisions", "ageBands"]) {
      const rows = input[kind] || [];
      if (!Array.isArray(rows) || rows.length > 10000) throw Error("专项分类列表无效");
      const seen = new Set();
      out[kind] = rows.map(row => {
        if (!plain(row) || !id(row.id) || seen.has(row.id) || typeof row.name !== "string" || !row.name.trim() || row.name.length > 200 || row.disabled !== undefined && typeof row.disabled !== "boolean") throw Error("专项分类名称或编号无效");
        seen.add(row.id);
        const value = { id: row.id, name: row.name, ...(row.disabled !== undefined ? { disabled: row.disabled } : {}) };
        if (kind === "sports") {
          if (row.subdivisionLabel !== undefined && (typeof row.subdivisionLabel !== "string" || row.subdivisionLabel.length > 100)) throw Error("细分类称谓无效");
          value.subdivisionLabel = row.subdivisionLabel ?? "细分";
        }
        if (kind === "subdivisions") {
          if (!id(row.sportId)) throw Error("细分类缺少所属专项");
          value.sportId = row.sportId;
        }
        if (kind === "ageBands") {
          if (!Number.isSafeInteger(row.min) || !Number.isSafeInteger(row.max) || row.min < 0 || row.max > 150 || row.min > row.max) throw Error("年龄段须填写有效的整数周岁范围");
          value.min = row.min; value.max = row.max;
        }
        return value;
      });
    }
    if (out.subdivisions.some(row => !out.sports.some(sport => sport.id === row.sportId))) throw Error("细分类所属专项不存在");
    return out;
  }
  function resolve(profile = {}, input = {}) {
    const registry = normalize(input), sport = registry.sports.find(value => value.id === profile.sportId);
    const subdivision = registry.subdivisions.find(value => value.id === profile.subdivisionId && value.sportId === sport?.id);
    return { sportId: sport?.id || "", sportName: sport?.name || profile.sport || "", subdivisionId: subdivision?.id || "", subdivisionName: subdivision?.name || "", subdivisionLabel: sport?.subdivisionLabel || "细分" };
  }
  function validateProfile(profile, input = {}) {
    const registry = normalize(input);
    if (profile.sportId && !registry.sports.some(row => row.id === profile.sportId)) throw Error("运动员所属专项不存在");
    if (profile.subdivisionId && !registry.subdivisions.some(row => row.id === profile.subdivisionId && row.sportId === profile.sportId)) throw Error("运动员细分类与专项不一致");
    return true;
  }
  function migrate(input) {
    const library = clone(input), registry = normalize(library.classifications);
    for (const athlete of library.athletes || []) {
      const profile = athlete.profile;
      if (!profile) continue;
      if (!profile.sportId && typeof profile.sport === "string" && profile.sport.trim()) {
        let sport = registry.sports.find(value => value.name === profile.sport);
        if (!sport) { sport = { id: newId("sport"), name: profile.sport, subdivisionLabel: "细分" }; registry.sports.push(sport); }
        profile.sportId = sport.id;
      }
      validateProfile(profile, registry);
    }
    library.classifications = registry;
    return library;
  }
  function merge(local, incoming) {
    const classifications = normalize(local), source = normalize(incoming), maps = { sportMap: {}, subdivisionMap: {}, ageBandMap: {} };
    for (const sport of source.sports) if (!classifications.sports.some(value => value.id === sport.id)) classifications.sports.push(clone(sport));
    for (const item of source.subdivisions) {
      const old = classifications.subdivisions.find(value => value.id === item.id), value = clone(item);
      if (old?.sportId === value.sportId) continue;
      if (old) { value.id = newId("subdivision"); maps.subdivisionMap[item.id] = value.id; }
      classifications.subdivisions.push(value);
    }
    for (const item of source.ageBands) {
      const old = classifications.ageBands.find(value => value.id === item.id);
      if (!old) classifications.ageBands.push(clone(item));
      else if (old.min !== item.min || old.max !== item.max) { const value = { ...clone(item), id: newId("ageband") }; maps.ageBandMap[item.id] = value.id; classifications.ageBands.push(value); }
    }
    return { classifications: normalize(classifications), maps };
  }
  function remapProfile(profile, maps = {}) {
    const out = clone(profile);
    for (const [field, name] of [["sportId", "sportMap"], ["subdivisionId", "subdivisionMap"]]) if (out[field]) out[field] = maps[name]?.[out[field]] || out[field];
    return out;
  }
  root.RingsideClassifications = { normalize, resolve, validateProfile, migrate, merge, remapProfile, newId };
})(typeof window !== "undefined" ? window : globalThis);
