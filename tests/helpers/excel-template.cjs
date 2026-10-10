"use strict";
function manifest(book) {
  let encoded="";book.getWorksheet("_MotionBench").eachRow(row=>{encoded+=row.getCell(2).value;});return JSON.parse(encoded);
}
function columns(sheet) {
  const info=manifest(sheet.workbook);
  if(info.schema===1)return Object.fromEntries(sheet.getRow(2).values.map((key,column)=>[key,column]).filter(([key])=>key));
  const fields=info.sheets.find(item=>item.name===sheet.name).columns,byHeader=new Map(fields.map(item=>[item.header,item.key])),result={};
  sheet.getRow(1).eachCell((cell,column)=>{const key=byHeader.get(cell.value);if(key)result[key]=column;});return result;
}
function column(sheet,key) {const value=columns(sheet)[key];if(!value)throw Error("Missing field "+key+" in "+sheet.name);return value;}
const firstRow=sheet=>manifest(sheet.workbook).schema===1?3:2;
function validationValues(cell){const book=cell.worksheet.workbook,name=cell.dataValidation.formulae[0];if(name.startsWith('"'))return name.slice(1,-1).split(',');const range=book.definedNames.model.find(item=>item.name===name).ranges[0],match=/^'([^']+)'!\$A\$(\d+):\$A\$(\d+)$/.exec(range),sheet=book.getWorksheet(match[1]);return Array.from({length:Number(match[3])-Number(match[2])+1},(_,i)=>sheet.getCell(Number(match[2])+i,1).value);}
function directionId(sheet,row) {const info=manifest(sheet.workbook),c=columns(sheet);return info.schema===1?sheet.getCell(row,c.directionId).value:info.directionRefs.find(ref=>ref.label===sheet.getCell(row,c.directionRef).value)?.directionId;}
module.exports={manifest,columns,column,firstRow,directionId,validationValues};
