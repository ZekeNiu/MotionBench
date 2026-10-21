(function (root) {
  "use strict";
  const clone = value => JSON.parse(JSON.stringify(value));
  const plain = value => !!value && typeof value === "object" && !Array.isArray(value) && Object.prototype.toString.call(value) === "[object Object]";
  const safeId = value => typeof value === "string" && /^[A-Za-z0-9_.:-]{1,249}$/.test(value) && !["__proto__", "prototype", "constructor"].includes(value);
  const chunkSize = 256 * 1024;
  function json(value, depth = 0) {
    if (depth > 70 || typeof value === "number" && !Number.isFinite(value) || ["function", "symbol", "bigint"].includes(typeof value)) throw Error("横向报告包含无效数据");
    if (!value || typeof value !== "object") return;
    if (!Array.isArray(value) && !plain(value)) throw Error("横向报告包含无效对象");
    for (const [key, item] of Object.entries(value)) { if (["__proto__", "prototype", "constructor"].includes(key)) throw Error("横向报告包含不安全字段"); json(item, depth + 1); }
  }
  function narrative(input = {}) {
    if (!plain(input)) throw Error("横向报告正文无效");
    for (const name of ["text", "html", "basis", "origin", "updated"]) if (input[name] !== undefined && typeof input[name] !== "string") throw Error("横向报告正文无效");
    if (input.revision !== undefined && (!Number.isSafeInteger(input.revision) || input.revision < 0)) throw Error("横向报告正文版本无效");
    const out = { text: "", html: "", basis: "", origin: "manual", updated: "", revision: 0, ...clone(input) };
    out.html = root.RingsideModel.sanitizeHTML(out.html || root.RingsideModel.textToHTML(out.text)); out.text = root.RingsideModel.htmlToText(out.html);
    return out;
  }
  function normalize(input, { metadata = false } = {}) {
    json(input);
    if (!plain(input) || input.version !== undefined && input.version !== 1 || !safeId(input.id) || !plain(input.configuration) || !plain(input.views || {})) throw Error("横向报告结构或编号无效");
    for (const key of ["title", "basis", "created", "updated"]) if (input[key] !== undefined && typeof input[key] !== "string") throw Error("横向报告元数据无效");
    if (input.revision !== undefined && (!Number.isSafeInteger(input.revision) || input.revision < 0)) throw Error("横向报告版本无效");
    if (!metadata && !plain(input.snapshot)) throw Error("横向报告缺少冻结数据");
    const out = { version: 1, id: input.id, title: input.title || "横向比较报告", configuration: clone(input.configuration), views: clone(input.views || {}), narrative: narrative(input.narrative), basis: input.basis || input.snapshot?.fingerprint || "", created: input.created || "", updated: input.updated || "", revision: input.revision || 0 };
    if (input.previousNarrative) out.previousNarrative = narrative(input.previousNarrative);
    if (input.sourceMappings) out.sourceMappings = clone(input.sourceMappings);
    if (metadata) {
      const info = input.snapshotInfo;
      if (!plain(info) || !Number.isSafeInteger(info.count) || info.count < 1 || info.count > 65536 || !Number.isSafeInteger(info.length) || info.length < 2 || !/^[a-f0-9]{64}$/.test(info.sha256 || "")) throw Error("横向报告快照索引无效");
      if (info.encoding !== undefined && (info.encoding !== "object-pool-v1" || !Number.isSafeInteger(info.logicalLength) || info.logicalLength < 2 || !/^[a-f0-9]{64}$/.test(info.logicalSha256 || ""))) throw Error("不支持的横向报告快照编码");
      out.snapshotInfo = clone(info);
    } else out.snapshot = clone(input.snapshot);
    return out;
  }
  const digest = async text => Array.from(new Uint8Array(await root.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))), value => value.toString(16).padStart(2, "0")).join("");
  const chunkId = (reportId, index) => reportId + ":" + String(index).padStart(6, "0");
  function validateChunk(value) {
    json(value);
    if (!plain(value) || !safeId(value.reportId) || !Number.isSafeInteger(value.index) || value.index < 0 || value.id !== chunkId(value.reportId, value.index) || typeof value.text !== "string" || value.text.length > chunkSize) throw Error("横向报告快照片段无效");
    return true;
  }
  function poolSnapshot(snapshot) {
    const nodes = [], known = new Map();
    const encode = value => {
      if (!value || typeof value !== "object") return value;
      const node = Array.isArray(value) ? ["array", value.map(encode)] : ["object", Object.entries(value).map(([key, item]) => [key, encode(item)])];
      const key = JSON.stringify(node);
      let index = known.get(key);
      if (index === undefined) { index = nodes.length; nodes.push(node); known.set(key, index); }
      return { ref: index };
    };
    const entry = encode(snapshot);
    return { entry, nodes };
  }
  function unpoolSnapshot(input, logicalLength) {
    if (!plain(input) || !Array.isArray(input.nodes) || !input.nodes.length || !plain(input.entry) || input.entry.ref !== input.nodes.length - 1) throw Error("横向报告快照复用索引无效");
    const values = [], lengths = [], depths = [];
    const reference = (item, index) => {
      if (!item || typeof item !== "object") {
        if (!["string", "number", "boolean"].includes(typeof item) && item !== null || typeof item === "number" && !Number.isFinite(item)) throw Error("横向报告快照复用数据无效");
        return { value: item, length: JSON.stringify(item).length, depth: 0 };
      }
      if (!plain(item) || Object.keys(item).length !== 1 || !Number.isSafeInteger(item.ref) || item.ref < 0 || item.ref >= index) throw Error("横向报告快照包含循环或无效引用");
      return { value: values[item.ref], length: lengths[item.ref], depth: depths[item.ref] };
    };
    for (let index = 0; index < input.nodes.length; index++) {
      const node = input.nodes[index];
      if (!Array.isArray(node) || node.length !== 2 || !["array", "object"].includes(node[0]) || !Array.isArray(node[1])) throw Error("横向报告快照复用结构无效");
      let length = 2 + Math.max(0, node[1].length - 1), depth = 1;
      const value = node[0] === "array" ? [] : {}, keys = new Set();
      for (const item of node[1]) {
        if (node[0] === "array") { const decoded = reference(item, index); value.push(decoded.value); length += decoded.length; depth = Math.max(depth, decoded.depth + 1); }
        else {
          if (!Array.isArray(item) || item.length !== 2 || typeof item[0] !== "string" || keys.has(item[0]) || ["__proto__", "prototype", "constructor"].includes(item[0])) throw Error("横向报告快照复用字段无效");
          const decoded = reference(item[1], index); keys.add(item[0]); value[item[0]] = decoded.value; length += JSON.stringify(item[0]).length + 1 + decoded.length; depth = Math.max(depth, decoded.depth + 1);
        }
        if (!Number.isSafeInteger(length) || length > logicalLength || depth > 70) throw Error("横向报告快照展开范围无效");
      }
      values.push(value); lengths.push(length); depths.push(depth);
    }
    if (lengths.at(-1) !== logicalLength || !plain(values.at(-1))) throw Error("横向报告快照展开长度无效");
    return values.at(-1);
  }
  async function pack(input) {
    const document = normalize(input), original = JSON.stringify(document.snapshot), pooled = JSON.stringify(poolSnapshot(document.snapshot)), chunks = [];
    const compact = pooled.length + 160 < original.length, encoded = compact ? pooled : original;
    for (let offset = 0; offset < encoded.length; offset += chunkSize) { const index = chunks.length; chunks.push({ id: chunkId(document.id, index), reportId: document.id, index, text: encoded.slice(offset, offset + chunkSize) }); }
    const { snapshot, ...metadata } = document;
    metadata.snapshotInfo = { count: chunks.length, length: encoded.length, sha256: await digest(encoded) };
    if (compact) Object.assign(metadata.snapshotInfo, { encoding: "object-pool-v1", logicalLength: original.length, logicalSha256: await digest(original) });
    return { metadata, chunks };
  }
  async function unpack(input, chunks) {
    const metadata = normalize(input, { metadata: true }), rows = [...chunks].sort((a, b) => a.index - b.index);
    if (rows.length !== metadata.snapshotInfo.count || rows.some((row, index) => { validateChunk(row); return row.reportId !== metadata.id || row.index !== index; })) throw Error("横向报告快照不完整");
    const encoded = rows.map(row => row.text).join("");
    if (encoded.length !== metadata.snapshotInfo.length || await digest(encoded) !== metadata.snapshotInfo.sha256) throw Error("横向报告快照校验失败");
    const { snapshotInfo, ...document } = metadata;
    let snapshot = JSON.parse(encoded);
    if (snapshotInfo.encoding) {
      snapshot = unpoolSnapshot(snapshot, snapshotInfo.logicalLength);
      const original = JSON.stringify(snapshot);
      if (original.length !== snapshotInfo.logicalLength || await digest(original) !== snapshotInfo.logicalSha256) throw Error("横向报告快照展开校验失败");
    }
    return normalize({ ...document, snapshot });
  }
  function summary(input) {
    const document = normalize(input, { metadata: true });
    return { id: document.id, title: document.title, revision: document.revision, created: document.created, updated: document.updated, perspective: document.configuration.perspective || "focus", participantCount: document.configuration.participants?.length || 0, referenceCount: document.configuration.references?.length || 0 };
  }
  function remapMetadata(input, maps = {}) {
    const document = normalize(input, { metadata: true });
    const mapped = (name, id) => maps[name] instanceof Map ? maps[name].get(id) || id : maps[name]?.[id] || id;
    const fields = { recordId: "recordMap", athleteId: "athleteMap", focusAthleteId: "athleteMap", sportId: "sportMap", subdivisionId: "subdivisionMap", ageBandId: "ageBandMap", groupId: "groupMap", teamId: "groupMap", evaluationProfileId: "profileMap", profileId: "profileMap" };
    const walk = value => Array.isArray(value) ? value.map(walk) : plain(value) ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, fields[key] && typeof item === "string" ? mapped(fields[key], item) : walk(item)])) : value;
    document.configuration = walk(document.configuration);
    if (document.configuration.profileSnapshot?.id) document.configuration.profileSnapshot.id = mapped("profileMap", document.configuration.profileSnapshot.id);
    // Frozen values and their original provenance stay byte-identical. Mappings
    // connect that provenance to local copies when an explicit refresh is made.
    const serial = Object.fromEntries(Object.entries(maps).map(([name, map]) => [name, map instanceof Map ? Object.fromEntries(map) : clone(map)]).filter(([, map]) => Object.keys(map).length));
    if (Object.keys(serial).length) document.sourceMappings = { ...document.sourceMappings, ...serial };
    return document;
  }
  function remapDocument(input, maps = {}) {
    const document = normalize(input), metadata = remapMetadata({ ...document, snapshotInfo: { count: 1, length: 2, sha256: "0".repeat(64) } }, maps);
    delete metadata.snapshotInfo;
    return normalize({ ...metadata, snapshot: document.snapshot });
  }
  root.RingsideHorizontalStore = { normalize, narrative, pack, unpack, validateChunk, chunkId, summary, remapMetadata, remapDocument };
})(typeof window !== "undefined" ? window : globalThis);
