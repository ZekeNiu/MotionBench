"""Bind local FVP candidate acceptance to the exact reproducible offline artifact."""
from pathlib import Path
import hashlib
import json
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()
def load(path):
    return json.loads((ROOT / path).read_text(encoding="utf-8-sig"))
def artifact(path):
    return {"path": path.relative_to(ROOT).as_posix(), "sha256": digest(path)}
def check_item(item):
    path = (ROOT / item["path"]).resolve()
    assert path.is_relative_to(ROOT) and path.is_file()
    assert digest(path) == item["sha256"], item["path"]

def main():
    html = ROOT / "MotionBench.html"
    sha = digest(html)
    assert load("package.json")["version"] == "2.14.0"
    assert digest(ROOT / "Ringside_Boxing_Assessment.html") == sha
    assert re.search(r'<script id="embedded-data" type="application/json">\s*null\s*</script>', html.read_text(encoding="utf-8"))
    subprocess.run([sys.executable, "scripts/build.py"], cwd=ROOT, check=True)
    assert digest(html) == sha, "Build changed the tested artifact"
    evidence = {}
    def read(name, path):
        data = load(path)
        assert data["sourceHash"] == sha, "Stale evidence: " + path
        evidence[name] = artifact(ROOT / path)
        return data
    units = read("models", "output/tests/unit-results.json")
    assert all(s["exitCode"] == 0 and s["checksPassed"] > 0 for s in units["suites"])
    assert {"fvp-model-tests.cjs", "fvp-excel-model-tests.cjs"}.issubset({s["name"] for s in units["suites"]})
    browser_suites = []
    pdf_pages = 0
    for channel in ["chrome", "msedge"]:
        data = read(channel + "FVP", f"output/playwright/fvp/{channel}-results.json")
        assert data["pass"] and data["sourceUnchanged"] and not data["errors"] and not data["network"], data.get("failure")
        assert len(data["checks"]) >= 16
        for item in data["images"] + data["pdfs"]:
            check_item(item)
        assert {l["width"] for l in data["layouts"]} == {1440, 1280, 900, 390}
        assert all(not l["overflow"] for l in data["layouts"])
        for pdf in data["pdfs"]:
            assert pdf["diagnostics"]["status"] == "complete"
            assert all(not pdf["diagnostics"][k] for k in ["missingRows", "duplicateRows", "changedRows", "missingCharts", "duplicateCharts"])
            assert all(not p["overflow"] for p in pdf["pages"])
            pdf_pages += len(pdf["pages"])
        browser_suites.append({"name": channel + " FVP integration", "checks": len(data["checks"]), "pass": True})
        storage = read(channel + "FVPStorage", f"output/playwright/fvp-storage/{channel}-results.json")
        assert storage["pass"] and storage["sourceUnchanged"] and not storage["errors"] and not storage["network"], storage.get("failure")
        assert len(storage["checks"]) >= 9 and storage["saveFailureRecoveries"] == 2
        for item in storage["artifacts"]:
            check_item(item)
        browser_suites.append({"name": channel + " FVP storage and Excel workflow", "checks": len(storage["checks"]), "pass": True})
        stress = read(channel + "FVPStress", f"output/playwright/fvp-stress/{channel}-results.json")
        assert stress["pass"] and stress["sourceUnchanged"] and not stress["errors"] and not stress["network"], stress.get("failure")
        assert len(stress["checks"]) >= 14 and len(stress["images"]) >= 4
        for item in stress["images"]:
            assert item["reviewed"] and item["pass"]
            check_item(item)
        browser_suites.append({"name": channel + " dense points and wide confidence band", "checks": len(stress["checks"]), "pass": True})
    regressions = read("browserRegression", "output/tests/v214-browser-regression.json")
    assert regressions["pass"] and all(s["exitCode"] == 0 for s in regressions["suites"])
    native = read("nativeExcel", "output/excel-native/fvp-native-result.json")
    assert native["pass"] and native["saved"]
    check_item(native["inputArtifact"]); check_item(native["outputArtifact"])
    readback = read("nativeExcelReadback", "output/excel-native/fvp-readback-result.json")
    assert readback["pass"] and readback["xlsxHash"] == native["outputArtifact"]["sha256"]
    visual = read("visualReview", "output/playwright/fvp/visual-review.json")
    assert visual["pass"] and visual["images"] and all(p["reviewed"] and p["pass"] for p in visual["images"])
    for p in visual["images"]:
        check_item(p)
    assert visual["pdfPages"] == pdf_pages
    renders = read("pdfRenderReview", "output/playwright/fvp/pdf-render-review.json")
    assert renders["automatedPass"] and renders["manualReviewPass"] and renders["pdfPages"] == pdf_pages
    summary = {
        "version": "2.14.0", "date": "2026-10-09", "status": "local-candidate", "pass": True,
        "artifact": artifact(html), "reproducibleBuild": True,
        "sourceModules": {p.relative_to(ROOT).as_posix(): digest(p) for p in sorted((ROOT / "src").glob("*")) if p.is_file()},
        "modelChecks": sum(s["checksPassed"] for s in units["suites"]),
        "browserChecks": sum(s["checks"] for s in browser_suites) + sum(s.get("checksPassed", 0) for s in regressions["suites"]),
        "browserSuites": browser_suites + [{"name": s["name"], "checks": s.get("checksPassed", 0), "pass": True} for s in regressions["suites"]],
        "exportedPdfPages": pdf_pages, "nativeExcel": native, "evidence": evidence,
        "rollback": {"tag": "v2.13.1", "commit": "0fd163ff2fd5f57bcbf7c0053c4bf9744bd3001b", "htmlSHA256": "5e6473100e8967e9a9da57eb36298e6d28f6449f2e326aef2a5cdd5fc850123c"},
        "verificationLimits": ["Checks use synthetic athletes in isolated installed Chrome/Edge browsers.", "Mobile input and layouts use browser emulation; physical devices and printers were not tested.", "AI fact parity and existing simulated AI workflow were checked; live provider output was not rerun.", "The previous large Chrome backup stress cancellation was not revalidated in this candidate."]
    }
    (ROOT / "docs/acceptance-2.14.0.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    notes = f"""# MotionBench 2.14.0 本地候选验收

已通过本次模型、交互、存储、Excel 和 PDF 验收。置信度：高；结论依据为对应成品的自动检查、实际 Excel 保存回读和逐页图形检查。

| 核验项目 | 结果 |
| --- | --- |
| 模型与数据接入 | {summary['modelChecks']} 项通过，包含 Morin 示例、90°／30°最优解、Li 弹性、有限情景、判定临界值和置信区间 |
| 浏览器流程 | {summary['browserChecks']} 项通过，包含 FVP、草稿恢复、多人 Excel、密集点、宽置信带及原有功能回归 |
| 布局 | Chrome／Edge 的 1440、1280、900、390 宽度通过；桌面左图右表，窄屏先图后表 |
| PDF | 两浏览器共 6 份、{pdf_pages} 页；全部逐页查看，关键 FVP／响应页面另作原尺寸检查 |
| Microsoft Excel | 16.0 实际填写、另存和产品回读通过 |
| 数据兼容 | 历史项目、旧自定义 ID、原始试次、人工解读、JSONL 备份与刷新恢复通过 |

PDF 未发现数据遗漏、重复、图表裁切或重叠。方法页和末页少量试次存在留白，完整数据保留。

成品 SHA256：`{sha}`。重新构建得到相同字节；兼容入口与 MotionBench.html 相同。详细证据和各文件哈希见 [机器验收记录](acceptance-2.14.0.json)。

本次使用隔离浏览器和模拟运动员数据；触摸与窄屏使用浏览器模拟。AI 验证覆盖事实输入与模拟生成流程，未复测实时模型输出；既有超大 Chrome 备份压力问题未纳入本次重验。

交付为本地候选。远程回退点 `v2.13.1` 对应提交 `{summary['rollback']['commit']}`，原 HTML SHA256 为 `{summary['rollback']['htmlSHA256']}`。
"""
    (ROOT / "docs/acceptance-2.14.0.md").write_text(notes, encoding="utf-8")
    print(f"PASS 2.14.0: {summary['modelChecks']} model checks, {summary['browserChecks']} browser checks, {pdf_pages} PDF pages; {sha}")

if __name__ == "__main__":
    main()
