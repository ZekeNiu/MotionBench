"use strict";
const assert=require("node:assert/strict"),{context,fixture}=require("./helpers/calculation-fixture.cjs"),c=context(),M=c.RingsideModel,X=c.RingsideExcel,A=c.RingsideAcquisition;
(async()=>{
  const r=fixture(c),raw=JSON.stringify(r.data);
  for(const id of ["calc_run","calc_turn"]){const fields=A.project(r,id).sections.flatMap(section=>section.fields);assert.ok(fields.every(field=>!field.key.includes("calc_total")&&!field.key.includes("calc_deficit")));}
  const output=await X.createTemplate({records:[r],prefill:true}),book=new c.ExcelJS.Workbook();await book.xlsx.load(output.bytes);
  assert.equal(book.getWorksheet("计算结果"),undefined);
  let text="";book.getWorksheet("_MotionBench").eachRow(row=>text+=row.getCell(2).value);const manifest=JSON.parse(text);
  assert.ok(manifest.sheets.flatMap(sheet=>sheet.blocks.flatMap(block=>block.columns)).every(col=>!col.key.includes("calc_total")&&!col.key.includes("calc_deficit")));
  const parsed=await X.readTemplate(output.bytes);assert.deepEqual(JSON.parse(JSON.stringify(parsed.errors)),[]);assert.equal(M.stats(parsed.entries[0].record).values.calc_total,3);assert.equal(M.stats(parsed.entries[0].record).values.calc_deficit,1);
  assert.equal(c.Calc.num(parsed.entries[0].record.data.calc_run.find(row=>row.metrics.calc_segment_a===.1).metrics.calc_segment_b),null);
  const legacySheet=book.addWorksheet("计算结果");legacySheet.getCell("D3").value=.001;const forged=await X.readTemplate(await book.xlsx.writeBuffer());assert.equal(M.stats(forged.entries[0].record).values.calc_total,3);
  const sourceSheet=manifest.sheets.find(sheet=>sheet.testId==="calc_run"),inputBlock=sourceSheet.blocks.find(block=>block.kind==="attempt"),column=inputBlock.columns.findIndex(col=>col.key==="metrics.calc_segment_b")+1;
  book.getWorksheet(sourceSheet.name).getCell(inputBlock.start+1,column).value=2;
  const changed=await X.readTemplate(await book.xlsx.writeBuffer());assert.deepEqual(JSON.parse(JSON.stringify(changed.errors)),[]);assert.equal(M.stats(changed.entries[0].record).values.calc_total,4);assert.equal(M.stats(changed.entries[0].record).values.calc_deficit,0);
  for(const schema of [1,2]){const legacy=await X.readTemplate((await X.createTemplate({records:[r],prefill:true,schema})).bytes);assert.deepEqual(JSON.parse(JSON.stringify(legacy.errors)),[]);assert.equal(M.stats(legacy.entries[0].record).values.calc_deficit,1);}
  assert.equal(JSON.stringify(r.data),raw);
  const blank=await X.readTemplate((await X.createTemplate({records:[r],prefill:false})).bytes);assert.deepEqual(JSON.parse(JSON.stringify(blank.errors)),[]);
  console.log("PASS calculation input-only Excel schema3 round trip, no added output sheet, ignored legacy output snapshot and partial segments");
})().catch(error=>{console.error(error);process.exitCode=1;});
