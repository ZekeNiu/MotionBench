"use strict";
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),code=fs.readFileSync(path.join(root,'src/ringside-app.js'),'utf8');
const begin=code.indexOf('  function addRow('),end=code.indexOf('  function addIso(',begin);
assert.ok(begin>=0&&end>begin);
const c=vm.createContext({console,Intl,crypto:require('node:crypto').webcrypto});c.window=c;
for(const name of ['calc','fvp','sprint-fvp','cpet-reference','definitions','tests','scoring','model'])vm.runInContext(fs.readFileSync(path.join(root,'src/ringside-'+name+'.js'),'utf8'),c);
c.M=c.RingsideModel;c.T=c.RingsideTests;c.state=c.M.defaults();c.uid=()=>c.crypto.randomUUID();
c.persist=()=>{};c.renderEntry=()=>{};c.renderReport=()=>{};c.rowFocus=value=>{c.focusPath=value;};
vm.runInContext(code.slice(begin,end),c);
for(const id of ['dj','cmrj','cmj','sj']){
 const original=JSON.stringify(c.state.data[id]);
 const n=c.state.data[id].length,first=c.T.fieldsForTest(id).find(field=>!field.computed).key;
 c.addRow(id);c.addRow(id);
 assert.equal(c.state.data[id].length,n+2);
 assert.equal(c.focusPath,`data.${id}.${n+1}.${first}`);
 assert.equal(JSON.stringify(c.state.data[id].slice(0,n)),original);
 assert.equal(new Set(c.state.data[id].map(row=>row.id)).size,n+2);
 for(const row of c.state.data[id].slice(n))assert.equal(row[first],'');
 console.log('PASS '+id+' adds repeated attempts and focuses its first actual measurement without changing earlier trials');
}
console.log('4 jump add-row checks passed');
