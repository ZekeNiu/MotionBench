(function (root) {
  "use strict";
  const clone = value => JSON.parse(JSON.stringify(value));
  const sourceId = "friend-2022-rer110";
  const source = "FRIEND 2022 · 美国成人直接 CPET · VO₂peak · RER≥1.10 · 同年龄、性别及测试方式百分位";
  const sourceUrl = "https://doi.org/10.1016/j.mayocp.2021.08.020";
  const dataUrl = "https://github.com/JimPeterman/FRIENDanalysis/blob/81a0866c1786e34eee853123d9b865c0bb932ac3/R/FRIENDpercentile.R";
  const percentiles = Array.from({length:19}, (_,i) => (i+1)*5);
  // Original 2022 / RER >= 1.10 vectors; ascending P5 through P95.
  const values = {
    "treadmill": {
      "m20": [24.8,28.8,32,34.8,37.3,39.2,41,42.8,44.2,45.4,46.9,48.2,49.4,50.9,52.6,54.2,56,57.8,62.1],
      "m30": [20.6,25,27.2,29.4,31.3,32.8,34.3,35.9,37.4,38.6,40.1,41.9,43.5,45.1,46.5,48.7,51.2,54.3,57.9],
      "m40": [19.7,22.9,25.4,26.9,28.4,29.7,31.1,32.1,33.4,34.8,36,37.2,38.5,40,41.8,44,46.1,49.5,53.2],
      "m50": [16.5,19.2,21.4,22.7,23.9,25.3,26.2,27.2,28.2,29.4,30.7,31.8,32.9,34.1,35.5,37.5,40.1,42.7,46.8],
      "m60": [13.8,16.1,17.5,18.6,19.7,20.8,21.8,22.8,23.6,24.4,25.3,26.5,27.6,28.7,29.9,31.6,33.6,36.4,40.2],
      "m70": [11.6,13.6,15,16,16.8,17.6,18.5,19.3,19.9,20.6,21.5,22.3,22.9,23.9,25,26.3,27.6,29.6,35.2],
      "m80": [12.2,13.2,13.9,15.3,15.9,16.1,16.3,16.7,17,17.7,18.3,18.8,19.5,20.4,20.9,21.8,22.3,23.6,25.6],
      "f20": [19.3,22.2,24.5,26.6,28.6,29.9,31.3,32.7,34.2,35.6,36.8,38,39.6,41.2,42.2,44.1,45.4,47.3,50.1],
      "f30": [16.6,19.2,20.7,22.1,23.1,24.3,25.4,26.4,27.3,28.3,29.4,30.7,31.9,33.3,34.5,36.2,38.4,41.1,45.5],
      "f40": [15.3,17.4,19,20,21.3,22.2,23.2,24.2,24.9,25.9,26.6,27.7,28.6,29.8,30.9,32.8,34.7,37.5,40.7],
      "f50": [14.5,16.6,17.6,18.7,19.5,20.3,21,21.7,22.3,23.1,23.7,24.7,25.5,26.4,27.3,28.4,30,31.8,35.3],
      "f60": [12,13.5,14.7,15.5,16.4,17,17.7,18.3,18.8,19.4,20.1,20.8,21.6,22.2,23.1,24.1,25.5,27.3,29.7],
      "f70": [11.3,12.3,13.7,14.1,14.8,15.3,15.7,16.1,16.7,17.1,17.7,18.2,18.8,19.2,20,20.6,21.4,22.8,24.2],
      "f80": [10.7,11.4,11.9,12.4,12.8,13.4,13.8,14.3,14.6,15.1,15.3,15.5,15.8,16.6,17.2,18,18.5,19.9,20.7],
    },
    "cycle": {
      "m20": [24.6,28.9,31.9,33.7,35.7,37,38.3,40.5,42,43.6,44.9,47.2,49.2,51.4,53.8,55.8,58.3,61,64.4],
      "m30": [16.2,19.4,21.4,23.4,24.5,26.4,27.2,28.1,29.1,30.1,30.8,31.5,33.9,35.3,36.7,38.1,41.8,45.6,53.3],
      "m40": [18.3,20,21.3,22.1,22.8,23.9,24.9,25.5,26.3,27.5,28.1,28.9,29.8,31.3,32.6,34.6,36.3,40.5,45.2],
      "m50": [14.9,18,19.6,20.9,21.7,22.4,22.7,23.3,24,24.7,25.6,26.4,27.3,28.4,30,31.4,33.1,35.8,42.1],
      "m60": [12.8,15.4,16.7,18,18.7,19.2,20.1,20.8,21.3,21.8,22.6,23.2,23.8,24.4,25.2,26.6,28.2,30.5,36],
      "m70": [10.1,12.8,14.4,15.7,16,16.7,17.1,17.6,18.2,18.5,19.4,19.9,20.5,21.3,21.9,23.2,24.5,27.1,30.7],
      "m80": [7.9,8.4,9,9.4,10.8,11.2,12.2,12.6,13.3,13.9,14.8,15.5,16.5,17.2,17.3,17.5,17.9,18.8,18.9],
      "f20": [17.3,19.4,20.9,22.7,24.1,25.9,27.3,28.9,30.3,31.4,33.1,34,35.3,37.2,38.9,40.9,42.6,45,50.2],
      "f30": [13.9,15.2,16.4,17.3,17.9,18.8,19.3,19.9,20.8,21.5,22.2,23.1,23.7,24.6,25.8,26.8,28.6,31.7,36.5],
      "f40": [12.7,13.8,14.9,15.5,16,16.8,17.3,18.1,18.6,19,19.7,20.5,21.3,21.9,22.7,23.5,24.7,26.8,30.5],
      "f50": [12.5,13.5,14.3,14.7,15.2,15.6,16.1,16.5,16.9,17.3,17.7,18.2,18.8,19.3,20,20.7,21.5,22.6,25],
      "f60": [11.3,12.5,13.2,13.7,14.2,14.6,14.9,15.3,15.5,15.9,16.1,16.5,16.9,17.6,18.1,18.6,19.1,20.3,21.9],
      "f70": [10.1,11.2,12,12.5,12.8,13.2,13.6,13.7,14.4,14.6,14.9,15.3,15.7,16,16.5,16.8,17.4,18,19.1],
      "f80": [6.8,7.8,8.6,8.7,9,9.3,9.4,9.9,10.4,10.9,11.2,11.6,12.1,12.7,13,13.1,13.4,14.1,15.6],
    },
  };
  const number = value => value === "" || value == null || typeof value === "boolean" ? null : Number.isFinite(Number(value)) ? Number(value) : null;
  function percentileRanges(points) {
    const ranges = [{min:null,max:points[0],includeMin:true,includeMax:false,label:"低于 P5",status:"gray"}];
    points.forEach((value,i) => ranges.push({min:value,max:points[i+1]??null,includeMin:true,includeMax:false,label:i===points.length-1?"P95 及以上":"P"+percentiles[i]+"–P"+percentiles[i+1],status:"gray"}));
    return ranges;
  }
  function cpetReferenceGroups() {
    return Object.entries(values).flatMap(([mode, rows]) => Object.entries(rows).map(([key, points]) => ({
      id:sourceId+"-"+mode+"-"+key, sex:key[0]==="m"?"male":"female", ageMin:Number(key.slice(1)), ageMax:Number(key.slice(1))+10,
      mode, minPeakRER:1.1, source, sourceId, sourceUrl, ranges:percentileRanges(points)
    })));
  }
  function overlaps(a,b) {
    return Math.max(a.ageMin??0,b.ageMin??0)<Math.min(a.ageMax??Infinity,b.ageMax??Infinity) &&
      (a.sex==="any"||b.sex==="any"||a.sex===b.sex) && (a.mode==="any"||b.mode==="any"||a.mode===b.mode);
  }
  function validateReferenceGroups(groups) {
    if (groups === undefined) return true;
    if (!Array.isArray(groups) || groups.length>300) throw Error("分层标准须为不超过 300 行的列表");
    const ids=new Set();
    groups.forEach((g,i) => {
      const fail=message=>{throw Error("分层标准第 "+(i+1)+" 行："+message);};
      if (!g || typeof g!=="object" || Array.isArray(g) || typeof g.id!=="string" || !/^[A-Za-z0-9_-]+$/.test(g.id) || ids.has(g.id)) fail("编号缺失或重复");
      ids.add(g.id);
      if (!["male","female","any"].includes(g.sex) || !["treadmill","cycle","any"].includes(g.mode)) fail("性别或测试方式无效");
      for (const key of ["ageMin","ageMax"]) if(g[key]!==null && (typeof g[key]!=="number"||!Number.isFinite(g[key])||g[key]<0))fail("年龄须为非负数或留空");
      if(g.ageMax!==null && g.ageMax<=(g.ageMin??0))fail("年龄上限须大于下限");
      if(g.target!==undefined&&g.target!==null&&(typeof g.target!=="number"||!Number.isFinite(g.target)||g.target<=0))fail("目标须为正数或留空");
      if(g.minPeakRER!==undefined&&(typeof g.minPeakRER!=="number"||!Number.isFinite(g.minPeakRER)||g.minPeakRER<=0))fail("最低峰值 RER 须为正数或留空");
      if(typeof g.source!=="string" || ["sourceId","sourceUrl"].some(k=>g[k]!==undefined&&typeof g[k]!=="string"))fail("来源格式无效");
      if(!Array.isArray(g.ranges)||g.ranges.length>100)fail("分级区间格式无效");
      g.ranges.forEach((r,j)=>{
        if(!r||typeof r!=="object"||typeof r.label!=="string"||!r.label.trim()||!["red","amber","green","gray"].includes(r.status))fail("第 "+(j+1)+" 个区间的名称或颜色无效");
        for(const k of ["min","max"])if(r[k]!==null&&(typeof r[k]!=="number"||!Number.isFinite(r[k])))fail("区间端点须为数值或留空");
        if(r.min===null&&r.max===null||r.min!==null&&r.max!==null&&(r.min>r.max||r.min===r.max&&(r.includeMin===false||r.includeMax===false)))fail("区间上下限无效");
        if(["includeMin","includeMax"].some(k=>r[k]!==undefined&&typeof r[k]!=="boolean"))fail("端点包含选项无效");
        g.ranges.slice(0,j).forEach(prior=>{
          const low=Math.max(r.min??-Infinity,prior.min??-Infinity), high=Math.min(r.max??Infinity,prior.max??Infinity);
          const contains=(x,value)=>(x.min===null||value>x.min||value===x.min&&x.includeMin!==false)&&(x.max===null||value<x.max||value===x.max&&x.includeMax!==false);
          if(low<high||low===high&&contains(r,low)&&contains(prior,low))fail("分级区间重叠");
        });
      });
      if(groups.slice(0,i).some(other=>overlaps(other,g)))fail("适用年龄、性别与测试方式和其他行重叠");
    });
    return true;
  }
  function matchReferenceGroup(record,groups) {
    const rawSex=String(record.athlete?.sex||"").toLowerCase();
    const sex=["男","男性","male","m"].includes(rawSex)?"male":["女","女性","female","f"].includes(rawSex)?"female":null;
    const age=number(record.athlete?.age),mode=record.data?.cpet?.modality||null;
    const group=(groups||[]).find(g=>(g.sex==="any"||sex!==null&&g.sex===sex)&&(g.mode==="any"||mode!==null&&g.mode===mode)&&
      (g.ageMin===null||age!==null&&age>=g.ageMin)&&(g.ageMax===null||age!==null&&age<g.ageMax));
    if(!group)return {group:null,eligible:false,reason:"未匹配年龄、性别或测试方式的参考标准"};
    const rer=number(record.data?.cpet?.rer);
    if(group.minPeakRER!==undefined&&(rer===null||rer<group.minPeakRER))return {group,eligible:false,reason:"所选参考表要求峰值 RER ≥ "+group.minPeakRER};
    return {group,eligible:true,reason:""};
  }
  root.RingsideReferences={sourceId,source,sourceUrl,dataUrl,percentiles:clone(percentiles),cpetReferenceGroups,validateReferenceGroups,matchReferenceGroup};
})(typeof window !== "undefined" ? window : globalThis);

