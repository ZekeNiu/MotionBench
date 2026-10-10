"use strict";
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm"),crypto=require("node:crypto"),{spawnSync}=require("node:child_process");
const repo=path.resolve(__dirname,"../../.."),fixture=path.join(repo,"tests/fixtures/sprint-display-v2173"),ref="7dfee7c4",ctx=vm.createContext({console});ctx.window=ctx;
const hashes={};for(const name of ["calc","sprint-fvp"]){const file="src/ringside-"+name+".js",read=spawnSync("git",["show",ref+":"+file],{cwd:repo});if(read.status!==0)throw Error(read.stderr.toString());hashes[file]=crypto.createHash("sha256").update(read.stdout).digest("hex");vm.runInContext(read.stdout.toString("utf8"),ctx);}
const original=JSON.parse(fs.readFileSync(path.join(fixture,"baseline-sprint-library.json"),"utf8")).athletes[0].records[0],copy=value=>JSON.parse(JSON.stringify(value)),F=ctx.RingsideSprintFVP,cases=[];
for(const variant of ["standard40","nonuniform40","wind","heightOverride"]){
  const record=copy({athlete:{mass:original.athlete.mass,height:original.athlete.height},sprintFvpConfig:original.sprintFvpConfig,sprintFvpAnalysis:original.sprintFvpAnalysis,data:{sprint_fvp:original.data.sprint_fvp}});if(variant==="nonuniform40")record.data.sprint_fvp[0].splits=[3,8,17,29,40].map((distanceM,i)=>({id:"oracle_split_"+i,distanceM,timeS:F.timeAtDistance(distanceM,9.5,1.15)}));
  if(variant==="wind")record.sprintFvpConfig.windMps=1.5;if(variant==="heightOverride")record.sprintFvpConfig.heightCm=188;
  const solved=F.solve(record);if(!solved.valid)throw Error("Baseline fixture must be valid: "+variant);
  const arraySha=value=>crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
  const {samples,...model}=solved.model;
  const expected={fit:solved.fit,model,optimum:solved.optimum,imbalance:solved.imbalance,atmosphere:solved.atmosphere,heightCm:solved.heightCm,mass:solved.mass,targetDistanceM:solved.targetDistanceM,window:solved.window,
    samplesSha256:arraySha(solved.samples),curveSha256:arraySha(solved.curve),optimalCurveSha256:arraySha(solved.optimalCurve??null)};
  cases.push({name:variant,record,expected});
}
const proof={baselineRef:ref,sourceHashes:hashes,syntheticOnly:true,producer:"Actual git baseline Calc and SprintFVP modules executed in a VM",cases};
const target=path.join(fixture,"baseline-point-oracle.json");fs.writeFileSync(target,JSON.stringify(proof,null,2)+"\n");console.log(JSON.stringify({target,bytes:fs.statSync(target).size,cases:cases.map(item=>item.name)}));
