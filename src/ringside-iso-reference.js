(function (root) {
  "use strict";
  const clone = value => JSON.parse(JSON.stringify(value));
  const number = value => value === "" || value == null || typeof value === "boolean" ? null : Number.isFinite(Number(value)) ? Number(value) : null;
  const positive = value => number(value) > 0 ? number(value) : null;
  const GRAVITY = 9.80665;
  const SOURCES = {
    catenaccio2017: { title: "Catenaccio et al. 2017 · Table 2 · 健康成人 18–35 岁 · 固定框架 · 均值", url: "https://doi.org/10.1016/j.pmrj.2017.01.005", method: "三次峰力的最好值或均值，按本次统计方式匹配" },
    bradley2023: { title: "Bradley & Pierpoint 2023 · Table 3 · 健康成人 20–59 岁 · 手持测力 · 均值", url: "https://doi.org/10.26603/001c.83938", method: "三次均值；肩外展及内外旋采用肩外展 90°" },
    bohannon1997: { title: "Bohannon 1997 · Tables 7–8 · 健康成人 20–79 岁 · 手持测力 · 均值", url: "https://doi.org/10.1016/S0003-9993(97)90005-8", method: "第一次峰力；体重百分比；膝伸参考受 650 N 仪器上限影响" },
  };
  // Numeric observations, not clinical cutoffs. ND / DOM columns are retained as published.
  const BOHANNON = {
    male: {
      wrist_extension: [[21.7,23.3],[22,21.8],[21.5,22],[16.9,17.9],[16,17.5],[16.9,17.3]],
      elbow_flexion: [[35.5,36.4],[36.1,34.6],[32.5,33.3],[31.6,33.8],[30.8,32.6],[31.4,32.2]],
      elbow_extension: [[31.1,30.8],[29.5,27.6],[25.8,25.3],[21.9,23.3],[20.7,21.1],[22.4,21.5]],
      shoulder_extension: [[48.8,50.1],[48.1,51.8],[49.3,48],[35.9,39.1],[34.4,34.2],[34.2,36.8]],
      hip_flexion: [[26.5,27],[28.9,28.5],[22.4,23.2],[24,23.1],[21.1,21.4],[21.5,22.2]],
      hip_abduction: [[40.2,40.2],[42.7,42],[38.4,37.3],[35.7,36.2],[33.1,32.8],[32.8,33.6]],
      knee_extension: [[74,73.7],[73.7,73.6],[70.6,69.8],[55.1,55.7],[47.7,48.9],[48.4,47.7]],
      ankle_dorsiflexion: [[46.9,49],[49.6,47.3],[43.9,45.3],[36.7,36.9],[34.8,33.8],[32.7,32.1]],
    },
    female: {
      wrist_extension: [[16.3,17.2],[15.4,16.5],[16.4,16.9],[15.8,16.1],[13.9,13.8],[10.8,12.4]],
      elbow_flexion: [[26.5,26.8],[25.1,25.7],[26,25],[25.2,24.9],[22,21.4],[22.7,22.6]],
      elbow_extension: [[20,20.2],[18.4,18.2],[18.5,18.1],[17.5,17.9],[15.5,14.8],[15.5,15.6]],
      shoulder_extension: [[33.2,35.5],[30.7,32.6],[33.2,34.6],[30.5,31.3],[26.4,25.3],[23.9,24.9]],
      hip_flexion: [[22.9,24.3],[18.7,19.2],[20.6,20.6],[18.8,18.9],[16.3,17.1],[16.1,16.2]],
      hip_abduction: [[32.7,33.7],[33.1,35.5],[33.3,36],[33.4,34.7],[26.7,28.2],[25.8,26.7]],
      knee_extension: [[80.5,80.8],[63.8,63.3],[59.7,62.6],[51.2,53.7],[43.3,44.6],[35.8,36.6]],
      ankle_dorsiflexion: [[47.4,51.4],[39.8,38.6],[41.1,41.5],[39.1,41.3],[37.8,38.9],[26.7,29.1]],
    },
  };
  const NECK = {
    male: { best: { flexion:{C:147.3}, extension:{C:223.6}, lateralFlexion:{L:136.5,R:136} }, mean: { flexion:{C:138.1}, extension:{C:207.6}, lateralFlexion:{L:127.4,R:126.4} } },
    female: { best: { flexion:{C:89.2}, extension:{C:138.8}, lateralFlexion:{L:84.3,R:86} }, mean: { flexion:{C:83.6}, extension:{C:129.4}, lateralFlexion:{L:78.9,R:80.1} } },
  };
  const SHOULDER = {
    male: { externalRotation:{DOM:1.04,ND:1.04}, internalRotation:{DOM:1.43,ND:1.4}, abduction:{DOM:2.18,ND:2.18} },
    female: { externalRotation:{DOM:0.92,ND:0.91}, internalRotation:{DOM:1.18,ND:1.16}, abduction:{DOM:1.76,ND:1.78} },
  };
  function reference(sourceId, basis, sideBasis, groups) {
    return { enabled:true, sourceId, source:SOURCES[sourceId].title, url:SOURCES[sourceId].url, method:SOURCES[sourceId].method, statistic:"mean", basis, sideBasis, groups };
  }
  function defaultReference(row) {
    const code = row.directionCode, key = row.region + "_" + code;
    if (row.region === "neck" && Object.hasOwn(NECK.male.best,code)) return reference("catenaccio2017", "N", "anatomical", Object.entries(NECK).flatMap(([sex,modes]) => Object.entries(modes).map(([mode,values]) => ({sex,ageMin:18,ageMax:36,mode,values:clone(values[code])}))));
    if (row.region === "shoulder" && Object.hasOwn(SHOULDER.male,code)) return reference("bradley2023", "N/kg", "dominance", Object.entries(SHOULDER).map(([sex,values]) => ({sex,ageMin:20,ageMax:60,mode:"any",values:clone(values[code])})));
    if (Object.hasOwn(BOHANNON.male,key)) return reference("bohannon1997", "%BW", "dominance", Object.entries(BOHANNON).flatMap(([sex,values]) => values[key].map(([ND,DOM],i) => ({sex,ageMin:20+i*10,ageMax:30+i*10,mode:"any",values:{ND,DOM}}))));
    return null;
  }
  function defaultBalanceReference(pair) {
    if (pair.id !== "shoulder_IR_ER" || pair.numeratorId !== "iso_shoulder_externalRotation" || pair.denominatorId !== "iso_shoulder_internalRotation") return null;
    const means = {male:[[0.76,0.77],[0.78,0.78],[0.76,0.73],[0.74,0.71]],female:[[0.86,0.81],[0.81,0.81],[0.79,0.79],[0.76,0.77]]};
    const out = reference("bradley2023", "ratio", "dominance", Object.entries(means).flatMap(([sex,rows]) => rows.map(([ND,DOM],i) => ({sex,ageMin:20+i*10,ageMax:30+i*10,mode:"any",values:{ND,DOM}}))));
    out.source = "Bradley & Pierpoint 2023 · Table 5 · 肩 ER:IR 90° · 健康成人均值";
    return out;
  }
  const sexKey = value => ({"男":"male","男性":"male",male:"male","女":"female","女性":"female",female:"female"}[value] || null);
  function sideKey(record, row, ref, side) {
    if (!row.paired) return "C";
    if (!["L","R"].includes(side)) return null;
    if (ref.sideBasis === "anatomical") return side;
    // No leg-dominance field is requested; ND is the explicitly chosen shared baseline.
    if (!["shoulder","elbow","wrist"].includes(row.region)) return "ND";
    const hand = {"左手":"L","左":"L",L:"L",left:"L","右手":"R","右":"R",R:"R",right:"R"}[record.athlete?.dominantHand];
    return hand && hand === side ? "DOM" : "ND";
  }
  function effectiveReference(record, row, side, ref) {
    const base = {target:null,kind:"reference",source:ref?.source||"",reason:"",matched:false,basis:ref?.basis||""};
    if (!ref || !ref.enabled) return {...base,kind:"none"};
    if (!Array.isArray(ref.groups)) return {...base,reason:"未设置有效参考人群"};
    const sex = sexKey(record.athlete?.sex), age = number(record.athlete?.age);
    if (!sex) return {...base,reason:"缺少适用的性别信息"};
    if (age === null || age < 0) return {...base,reason:"缺少有效年龄"};
    const group = ref.groups.find(g => g.sex === sex && age >= g.ageMin && age < g.ageMax && (g.mode === "any" || g.mode === record.mode));
    if (!group) return {...base,reason:"年龄或统计方式不在参考人群内"};
    const key = sideKey(record,row,ref,side), value = key && positive(group.values[key]);
    if (!value) return {...base,reason:"该侧未设置参考值"};
    let target = value;
    if (ref.basis === "ratio") return {...base,target,matched:true};
    if (!["N","kgf","N/kg"].includes(row.unit)) return {...base,reason:"参考力与实测单位不匹配"};
    const mass = positive(record.athlete?.mass);
    if (ref.basis !== "N" && !mass) return {...base,reason:"相对参考需要有效体重"};
    if (ref.basis === "N/kg") target *= mass;
    if (ref.basis === "%BW") target *= GRAVITY * mass / 100;
    if (row.unit === "kgf") target /= GRAVITY;
    if (row.unit === "N/kg") {
      if (!mass) return {...base,reason:"相对力单位需要有效体重"};
      target /= mass;
    }
    if (!Number.isFinite(target) || target <= 0) return {...base,reason:"参考换算超出有效数值范围"};
    return {...base,target,matched:true,group:clone(group),sideKey:key};
  }
  function effectiveTarget(record, row, side = "") {
    const target = positive(row.target);
    if (target !== null) return {target,kind:"manual",source:"",reason:"",matched:true,basis:row.unit};
    return effectiveReference(record,row,side,row.reference);
  }
  function comparison(value, resolved) {
    if (number(value) === null || resolved?.kind !== "reference" || !resolved.matched) return null;
    const delta = Number(value)-resolved.target, tolerance = Number.EPSILON*Math.max(1,Math.abs(Number(value)),Math.abs(resolved.target))*8;
    const below = delta < -tolerance;
    if (resolved.basis === "ratio") return {kind:"literature-mean",relation:below?"below":delta>tolerance?"above":"equal",label:"参考",status:"gray"};
    return {kind:"literature-mean",relation:below?"below":"met",label:below?"关注":"达标",status:below?"amber":"green"};
  }
  function validateReference(ref, balance = false) {
    if (ref == null) return true;
    if (!ref || typeof ref !== "object" || Array.isArray(ref) || typeof ref.enabled !== "boolean" || !["N","N/kg","%BW",...(balance?["ratio"]:[])].includes(ref.basis) || !["anatomical","dominance"].includes(ref.sideBasis) || ref.statistic !== "mean" || !Array.isArray(ref.groups) || ref.groups.length > 1000 || typeof ref.source !== "string") throw Error("等长参考配置无效");
    const keys = new Set();
    for (const g of ref.groups) {
      if (!["male","female"].includes(g.sex) || !["any","best","mean"].includes(g.mode) || number(g.ageMin) === null || number(g.ageMax) === null || g.ageMin < 0 || g.ageMax <= g.ageMin || !g.values || typeof g.values !== "object" || Array.isArray(g.values)) throw Error("等长参考人群配置无效");
      const id = [g.sex,g.ageMin,g.ageMax,g.mode].join(":");
      if (keys.has(id)) throw Error("等长参考人群重复");
      keys.add(id);
      for (const [key,value] of Object.entries(g.values)) if (!["L","R","C","DOM","ND"].includes(key) || value !== "" && value !== null && positive(value) === null) throw Error("等长参考值须为正数或留空");
    }
    for (let i=0;i<ref.groups.length;i++) for (let j=i+1;j<ref.groups.length;j++) {
      const a=ref.groups[i],b=ref.groups[j];
      if (a.sex===b.sex && (a.mode===b.mode||a.mode==="any"||b.mode==="any") && Math.max(a.ageMin,b.ageMin)<Math.min(a.ageMax,b.ageMax)) throw Error("等长参考人群范围重叠");
    }
    return true;
  }
  function seedCriteria(criteria) {
    let changed = false;
    for (const row of criteria.iso || []) if (positive(row.target) === null && row.reference === undefined) {
      const ref = defaultReference(row);
      if (ref) {row.reference=ref;changed=true;}
    }
    for (const pair of criteria.balance || []) if (pair.reference === undefined && !pair.source && !pair.ranges?.length && !pair.referenceEnabled && !pair.ratioMigrationIssue) {
      const ref = defaultBalanceReference(pair);
      if (ref) {pair.reference=ref;changed=true;}
    }
    return changed;
  }
  root.RingsideIsoReferences = {SOURCES,GRAVITY,defaultReference,defaultBalanceReference,effectiveTarget,effectiveReference,comparison,validateReference,seedCriteria};
})(typeof window !== "undefined" ? window : globalThis);
