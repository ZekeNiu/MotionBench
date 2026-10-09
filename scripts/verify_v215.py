"""Bind athlete/context acceptance to the exact offline artifact; disclose live AI gaps."""
from pathlib import Path
import hashlib
import json
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def load(relative):
    return json.loads((ROOT / relative).read_text(encoding="utf-8-sig"))

def artifact(relative):
    return {"path": str(relative).replace("\\", "/"), "sha256": digest(ROOT / relative)}

def verify_item(item):
    path = Path(item["path"])
    path = path if path.is_absolute() else ROOT / path
    assert path.resolve().is_relative_to(ROOT) and path.is_file(), str(path)
    assert digest(path) == item["sha256"], str(path)

def main():
    sha = digest(ROOT / "MotionBench.html")
    assert load("package.json")["version"] == "2.15.0"
    assert digest(ROOT / "Ringside_Boxing_Assessment.html") == sha
    subprocess.run([sys.executable, "scripts/build.py"], cwd=ROOT, check=True)
    assert digest(ROOT / "MotionBench.html") == sha, "Build changed tested artifact"
    html = (ROOT / "MotionBench.html").read_text(encoding="utf-8")
    assert 'onclick="App.loadDemo()"' not in html
    for path in (ROOT / "src").glob("*.js"):
        source = path.read_text(encoding="utf-8").replace("</script", "<\\/script")
        assert "<script>\n" + source + "\n</script>" in html, path.name
    evidence = {}
    def read(name, relative):
        data = load(relative)
        assert data["sourceHash"] == sha, "Stale evidence: " + relative
        evidence[name] = artifact(relative)
        return data
    units = read("unit", "output/tests/unit-results.json")
    assert len(units["suites"]) == 28
    assert all(s["exitCode"] == 0 and s["checksPassed"] > 0 for s in units["suites"])
    suites = []
    pages = 0
    for channel in ["chrome", "msedge"]:
        data = read(channel + "Context", f"output/playwright/athlete-context/{channel}-results.json")
        assert data["pass"] and len(data["checks"]) >= 19 and not data["errors"] and not data["network"]
        assert len(data["layouts"]) == 3 and all(not row["overflow"] for row in data["layouts"])
        for item in data["artifacts"]:
            verify_item(item)
        suites.append({"name": channel + " athlete context", "checks": len(data["checks"]), "pass": True})
        report = read(channel + "Report", f"output/playwright/v212-capability/{channel}-results.json")
        assert report["pass"] and len(report["checks"]) >= 10 and not report["errors"]
        for item in report["images"]:
            verify_item(item)
        for key in ["pdf", "emptyHopPDF", "emptyHopHTML"]:
            verify_item(report[key])
        suites.append({"name": channel + " report/HTML/PDF", "checks": len(report["checks"]), "pass": True})
        rendered = read(channel + "PDFRender", f"output/playwright/v212-capability/pdf-rendered/{sha[:12]}/{channel}-render-results.json")
        assert rendered["a4"] and rendered["nonempty"] and rendered["visualReview"]["pass"]
        page_count = sum(case["pageCount"] for case in rendered["cases"])
        for case in rendered["cases"]:
            assert len(case["pages"]) == case["pageCount"]
            assert case["pdfDiagnostics"]["status"] == "complete"
            assert all(not case["pdfDiagnostics"][key] for key in ["missingRows","duplicateRows","changedRows","missingCharts","duplicateCharts"])
        assert rendered["visualReview"]["reviewedPages"] == page_count
        for item in rendered["artifacts"]:
            verify_item(item)
        pages += page_count
        storage = read(channel + "FVPRegression", f"output/playwright/fvp-storage/{channel}-results.json")
        assert storage["pass"] and storage["sourceUnchanged"] and not storage["errors"] and not storage["network"]
        assert len(storage["checks"]) == 9 and storage["saveFailureRecoveries"] == 2
        for item in storage["artifacts"]:
            verify_item(item)
        suites.append({"name": channel + " FVP/Excel/storage regression", "checks": len(storage["checks"]), "pass": True})
    regressions = read("regressions", "output/tests/v215-browser-regression.json")
    assert regressions["pass"] and all(item["pass"] and item["exitCode"] == 0 for item in regressions["suites"])
    suites += [{"name": item["name"] + " " + item.get("channel", "simulated AI"), "checks": item["checksPassed"], "pass": True} for item in regressions["suites"]]
    native = read("nativeExcel", "output/excel-native/athlete-context-results.json")
    assert native["pass"] and native["actualMicrosoftExcel"] and len(native["checks"]) == 8
    assert native["nativeExcel"]["Saved"] and native["nativeExcel"]["AgeReferenceEditBlocked"]
    assert all(row["embeddedExactly"] for row in native["embeddedSourceChecks"])
    for relative, expected in native["inputHashes"].items():
        assert digest(ROOT / relative) == expected, relative
    for item in native["outputFiles"]:
        verify_item({"path":item["file"],"sha256":item["sha256"]})
    visual_relative = "output/playwright/athlete-context/visual-review.json"
    visual = load(visual_relative)
    assert len(visual["artifacts"]) == 8 and all(item["viewed"] and item["sourceHash"] == sha for item in visual["artifacts"])
    for item in visual["artifacts"]:
        verify_item(item)
    evidence["contextVisual"] = artifact(visual_relative)
    live = read("liveAI", "output/ai/athlete-context/results.json")
    assert not live["errors"]
    if live["ran"]:
        assert live["pass"] and live["qualityReviewed"]
    else:
        assert live["unrunReason"] and not live["pass"]
    summary = {
        "version": "2.15.0", "date": "2026-10-09", "status": "local-offline-delivery",
        "implementationChecksPass": True, "allRequestedVerificationComplete": bool(live["ran"] and live["pass"]),
        "artifact": artifact("MotionBench.html"), "compatibleArtifact": artifact("Ringside_Boxing_Assessment.html"),
        "reproducibleBuild": True,
        "modelChecks": sum(item["checksPassed"] for item in units["suites"]),
        "browserChecks": sum(item["checks"] for item in suites), "browserSuites": suites,
        "exportedPDFPages": pages, "nativeExcelUniqueScenarios": len(native["checks"]),
        "liveAI": {key: live[key] for key in ["ran", "pass", "qualityReviewed", "configuration", "unrunReason"] if key in live},
        "sourceModules": {path.relative_to(ROOT).as_posix(): digest(path) for path in sorted((ROOT / "src").glob("*")) if path.is_file()},
        "evidence": evidence,
        "rollback": {"tag": "rollback-v2.14.0-20261009", "commit": "b8256ff8559807fe637b3feeb845c3d5d30119f9", "htmlSHA256": "11e0cc68d3834389cbffc852353cc81b8c10944a128cb3e612702968d72db197", "sourceBackupSHA256": "0731a579f3b7e9df68cab385091eeef4b2fc354f00024806ef812f035c566d70"},
        "verificationLimits": ["Synthetic athletes in isolated installed Chrome/Edge; personal browser databases were not accessed or backed up.", "Mobile layouts were emulated; physical phones, printers and clean-machine launcher setup were not tested.", "Actual model contrast was not run because the saved Windows AI configuration contains no key/model.", "No website was deployed; only the baseline rollback tag was pushed."],
    }
    (ROOT / "docs/acceptance-2.15.0.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    notes = f"""# MotionBench 2.15.0 验收记录

实现及离线流程验收通过。**置信度：高**，依据为冻结成品的模型、真实浏览器、原生 Excel、HTML 与 PDF 检查。计划中的真实 AI 模型对照尚未完成；因此完整验证状态保留为未完成。

- 模型：{summary['modelChecks']} 项，28 个测试套件。
- Chrome／Edge：{summary['browserChecks']} 项，包含各19项档案背景流程、保存失败与并发修改、刷新、恢复及AI过期保护；均使用模拟运动员。
- Microsoft Excel 16.0：8项独立情景；实际打开、锁定年龄、修改日期／手填年龄／测量、另存并由产品解析应用。准备阶段与验证阶段重复项没有重复计数。
- 4份实际按钮导出的PDF共{pages}页，均渲染检查A4与非空内容并实际查看；空Hop＋CMJ单报告HTML在独立离线上下文重开通过。
- 本次背景8张桌面／手机模拟截图均实际查看，无横向裁切；实体设备和打印机未测试。

成品 SHA256：`{sha}`。两个HTML相同，从正式源码重建后字节相同。机器记录含源码和所有证据哈希：[acceptance-2.15.0.json](acceptance-2.15.0.json)。

真实AI：启动原版Windows本机服务，只读检查已有加密配置，发现无保存密钥和模型，未覆盖配置、未发起模型请求。已验证输入包含伤病与比赛间隔、剔除生日，以及变化后旧任务／草稿不得应用；模拟响应不代表真实建议质量。

实施前已备份已跟踪源码与两HTML，并核验远程回退标签`rollback-v2.14.0-20261009`位于`b8256ff8559807fe637b3feeb845c3d5d30119f9`。备份未访问个人浏览器资料库，升级前应从原入口导出完整运动员备份。此次没有部署网站。
"""
    (ROOT / "docs/acceptance-2.15.0.md").write_text(notes, encoding="utf-8")
    print(f"PASS implementation: {summary['modelChecks']} model / {summary['browserChecks']} browser / {pages} PDF pages; live AI {'passed' if live['ran'] else 'unrun'}; {sha}")

if __name__ == "__main__":
    main()
