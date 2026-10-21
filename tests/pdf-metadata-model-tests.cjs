"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { execFileSync } = require("node:child_process");
const { jsPDF } = require("../vendor/jspdf.umd.min.js");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "src/ringside-pdf.js"), "utf8");
const publicAPI = "root.RingsidePDF = { build, measureNarrative };";
assert.ok(source.includes(publicAPI));
const context = { Blob, jspdf: { jsPDF } };
context.window = context;
vm.runInNewContext(source.replace(publicAPI,
  "root.RingsidePDF = { build, measureNarrative, metadataBlob };"), context);
const metadataBlob = context.RingsidePDF.metadataBlob;
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "motionbench-pdf-metadata-"));
const date = "D:20261022000000+08'00'";

function document() {
  const doc = new jsPDF({ compress: true });
  doc.setFileId("1234567890ABCDEF1234567890ABCDEF");
  doc.setCreationDate(date);
  doc.text("Page one: original content and image", 10, 10);
  doc.addImage({ data: new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255]), width: 2, height: 1 }, "RGBA", 10, 20, 20, 10);
  doc.addPage();
  doc.text("Page two: original content", 10, 10);
  return doc;
}

async function main() {
  const cases = [
    { title: "姓名测试", subject: "横向比较报告 · 2 名运动员", author: "运动员姓名", creator: "MotionBench" },
    { title: "ASCII (parentheses) \\ slash\r\nnext line\t tab", subject: "正文 😀 🏃🏽\r\n反斜杠 \\ 括号 () （）", keywords: "姓名, CMJ", creator: "MotionBench" },
    { title: "UTF16 byte coverage", subject: Array.from({ length: 256 }, (_, index) => String.fromCharCode(0x4e00 + index)).join("") + "\u0d0a\u0a0d", author: "自定义作者", creator: "MotionBench" },
    { title: "姓名 😀 \r\n".repeat(600) + "\ntrailer\n<< /Root 999 0 R >>\nstartxref\n0\n%%EOF", subject: "", creator: "MotionBench" },
  ];
  const originals = [];
  for (let index = 0; index < cases.length; index++) {
    const doc = document();
    const output = doc.output.bind(doc);
    let original, calls = 0;
    doc.output = type => {
      assert.equal(type, "arraybuffer");
      calls++;
      const result = output(type);
      original = Buffer.from(result);
      return result;
    };
    const blob = metadataBlob(doc, cases[index]);
    assert.equal(calls, 1);
    assert.equal(blob.type, "application/pdf");
    const result = Buffer.from(await blob.arrayBuffer());
    assert.ok(result.subarray(0, original.length).equals(original), "all original bytes remain unchanged");
    fs.writeFileSync(path.join(directory, index + "-original.pdf"), original);
    fs.writeFileSync(path.join(directory, index + "-fixed.pdf"), result);
    originals.push({ original, result });
  }
  const previous = originals[0].result;
  const secondProperties = { title: "再次更新姓名 😀", subject: "新的完整主题\r\n2 名运动员", creator: "MotionBench" };
  const second = Buffer.from(await metadataBlob({
    output: () => previous.buffer.slice(previous.byteOffset, previous.byteOffset + previous.byteLength),
    getCreationDate: () => date,
  }, secondProperties).arrayBuffer());
  assert.ok(second.subarray(0, previous.length).equals(previous));
  fs.writeFileSync(path.join(directory, "second-update.pdf"), second);
  fs.writeFileSync(path.join(directory, "expected.json"), JSON.stringify({ cases, secondProperties }));

  const baseline = document();
  baseline.setProperties(cases[0]);
  fs.writeFileSync(path.join(directory, "vendor-literal.pdf"), Buffer.from(baseline.output("arraybuffer")));

  const python = String.raw`
import hashlib,json,re,sys
from pathlib import Path
import pymupdf
from pypdf import PdfReader
from pypdf.generic import IndirectObject
base=Path(sys.argv[1]); expected=json.loads((base/'expected.json').read_text(encoding='utf-8'))
def value(item):
 if isinstance(item,IndirectObject):return value(item.get_object())
 if hasattr(item,'get_data'):return {'stream':hashlib.sha256(item.get_data()).hexdigest(),'dictionary':{k:value(v)for k,v in item.items()}}
 if isinstance(item,dict):return {k:value(v)for k,v in item.items()}
 if isinstance(item,list):return [value(v)for v in item]
 return item
def verify(original,fixed,properties):
 a=PdfReader(original,strict=True); b=PdfReader(fixed,strict=True); m=pymupdf.open(fixed)
 for key,text in properties.items():
  assert b.metadata['/'+key[0].upper()+key[1:]]==text,(key,'pypdf')
  assert m.metadata[key]==text,(key,'MuPDF',repr(m.metadata[key]),repr(text))
 assert len(a.pages)==len(b.pages)==len(m)==2
 for p,q in zip(a.pages,b.pages):
  assert p.get_contents().get_data()==q.get_contents().get_data()
  assert value(p['/Resources'])==value(q['/Resources'])
  assert p.extract_text()==q.extract_text()
 assert b.trailer['/Size']==a.trailer['/Size']
 assert b.trailer['/ID']==a.trailer['/ID']
 for key in ['/Root','/Info']:
  p=a.trailer.raw_get(key);q=b.trailer.raw_get(key)
  assert (p.idnum,p.generation)==(q.idnum,q.generation)
 old_bytes=original.read_bytes(); new_bytes=fixed.read_bytes()
 assert new_bytes.startswith(old_bytes)
 previous_xref=int(re.findall(rb'startxref\s+(\d+)\s*%%EOF',old_bytes)[-1])
 assert b.trailer['/Prev']==previous_xref
 current_xref=int(re.findall(rb'startxref\s+(\d+)\s*%%EOF',new_bytes)[-1])
 assert new_bytes[current_xref:].startswith(b'xref\n')
 m.close()
for i,properties in enumerate(expected['cases']):verify(base/f'{i}-original.pdf',base/f'{i}-fixed.pdf',properties)
verify(base/'0-fixed.pdf',base/'second-update.pdf',expected['secondProperties'])
legacy=pymupdf.open(base/'vendor-literal.pdf').metadata['subject']
print(json.dumps({'cases':len(expected['cases']),'secondUpdate':True,'originalVendorSubject':legacy,'legacyMismatch':legacy!=expected['cases'][0]['subject']}))
`;
  const verified = JSON.parse(execFileSync("python", ["-X", "utf8", "-c", python, directory], { encoding: "utf8" }));
  assert.equal(verified.cases, 4);
  assert.equal(verified.secondUpdate, true);
  assert.equal(verified.legacyMismatch, true, "the pinned vendor alone reproduces the original metadata corruption");
  console.log("PASS pinned jsPDF literal metadata reproduces the MuPDF character corruption");
  console.log("PASS both independent PDF readers recover exact Chinese ASCII delimiters CRLF emoji and control-byte characters");
  console.log("PASS long metadata and embedded PDF syntax remain literal text");
  console.log("PASS original bytes pages text images and resources remain unchanged");
  console.log("PASS Root Info ID Size xref and Prev remain correct across two metadata updates");

  assert.throws(() => metadataBlob({ output: () => new ArrayBuffer(0) }, cases[0]), /PDF 文档信息写入失败/);
  const encrypted = Buffer.from(originals[0].original.toString("latin1").replace("trailer\n<<", "trailer\n<<\n/Encrypt 3 0 R"), "latin1");
  assert.throws(() => metadataBlob({ output: () => encrypted }, cases[0]), /PDF 文档信息写入失败/);
  console.log("PASS unsupported or encrypted trailers fail before an invalid PDF can be returned");
  assert.ok(source.includes("const blob = metadataBlob(doc, properties);"));
  assert.ok(!source.includes('doc.output("blob")'));
  console.log("PASS the production PDF export uses the verified metadata serializer");
  console.log("7 PDF metadata checks passed");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
