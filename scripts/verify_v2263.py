"""Bind the report-layout acceptance scope to the exact 2.26.3 build."""
from pathlib import Path
import argparse
import hashlib
import json

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "output/release/2.26.3-local"


def read(file):
    return json.loads(Path(file).read_text(encoding="utf-8-sig"))


def digest(file):
    return hashlib.sha256(Path(file).read_bytes()).hexdigest()


def verify():
    source_hash = digest(ROOT / "MotionBench.html")
    package = read(OUT / "packaging-evidence.json")
    inspected = read(OUT / "package-check.json")
    assert read(ROOT / "package.json")["version"] == "2.26.3"
    assert package["version"] == inspected["version"] == "2.26.3-desktop.1"
    assert package["sourceHash"] == package["expectedHtmlSha256"] == source_hash
    assert package["archiveSha256"] == inspected["archiveSha256"]
    evidence = []

    def record(file, runner=None, minimum=None):
        file = ROOT / file
        value = read(file)
        assert value["pass"] and not value.get("errors"), file
        assert value["sourceHash"] == source_hash, "Receipt belongs to another HTML"
        if runner:
            assert value["runnerSha256"] == digest(ROOT / runner), "Runner changed"
        if minimum:
            assert len(value["checks"]) >= minimum
        for name, expected in value.get("moduleHashes", {}).items():
            assert digest(ROOT / name) == expected, name
        evidence.append({"file": file.relative_to(ROOT).as_posix(), "sha256": digest(file)})
        return value

    unit = record("output/release/2.26.3-local/acceptance/unit-targeted/results.json",
                  "output/release/2.26.3-local/run-targeted.cjs")
    assert unit["unitSuites"] == 5 and unit["unitChecks"] == 99
    for suite in unit["suites"]:
        assert suite["exitCode"] == 0 and suite["sourceUnchanged"]
        assert digest(ROOT / "tests" / suite["name"]) == suite["sha256"]
        assert digest(ROOT / suite["log"]) == suite["logSha256"]
    evidence[-1]["checks"] = unit["unitChecks"]
    browsers = []
    for channel in ["chrome", "msedge"]:
        browser = record(f"output/release/2.26.3-local/mini-layout/{channel}/results.json",
                         "tests/mini-chart-layout-browser-tests.cjs", 21)
        assert browser["sourceUnchanged"] and not browser["skipPDF"]
        assert len(browser["matrix"]) == 16
        assert {(item["count"], item["width"], item["media"]) for item in browser["matrix"]} == {
            (count, width, media) for count in [2, 3, 8, 17] for width in [1440, 390] for media in ["screen", "print"]}
        assert digest(ROOT / browser["pdf"]["file"]) == browser["pdf"]["sha256"]
        browsers.append(browser)
        evidence[-1]["checks"] = len(browser["checks"])
    native = record("output/horizontal-refinement/native-2.26.3/results.json",
                    "tests/horizontal-refinement-native-tests.cjs", 11)
    assert not native.get("cleanupErrors")
    assert native["identity"]["sourceHtmlSha256"] == native["identity"]["runtimeHtmlSha256"] == source_hash
    assert native["identity"]["archiveSha256"] == package["archiveSha256"]
    failure = record("output/release/2.26.3-local/native-failure-tests/results.json",
                     "tests/native-runner-failure-tests.cjs", 2)
    assert {item["mode"] for item in failure["checks"]} == {"export-hang", "close-refusal"}
    assert all(item["subprocessExited"] and item["exitCode"] == 1 for item in failure["checks"])
    evidence.extend({"file": file.relative_to(ROOT).as_posix(), "sha256": digest(file)}
                    for file in [OUT / "packaging-evidence.json", OUT / "package-check.json"])
    assets = {Path(item["path"]).name: item for item in package["artifacts"]}
    setup = assets["MotionBench-2.26.3-desktop.1-Setup-x64.exe"]
    portable = assets["MotionBench-2.26.3-desktop.1-Portable-x64.exe"]
    for item in package["artifacts"]:
        assert Path(item["path"]).stat().st_size == item["bytes"] and digest(item["path"]) == item["sha256"]
    return {"pass": True, "version": "2.26.3", "desktopVersion": "2.26.3-desktop.1",
            "scope": ["本机报告布局专项验收：统一 mini 外框与报告内绘图区，保留原雷达及 mini 底色。",
                      "屏幕、窄屏、打印和实际 PDF 覆盖 2/3/8/17 日期、跨模块单位、缺测、键盘及冻结分页。",
                      "完整 Windows CI、真实资料保护、本机升级和服务器资产在最终交付记录中单独核验。"],
            "unitSuites": 5, "unitChecks": 99, "browserChecks": sum(len(value["checks"]) for value in browsers),
            "nativeHorizontalChecks": 11, "nativeFailureChecks": 2,
            "artifact": {"file": "MotionBench.html", "bytes": (ROOT / "MotionBench.html").stat().st_size, "sha256": source_hash},
            "package": {"archiveSha256": package["archiveSha256"], "assets": len(inspected["files"]),
                        "installerSha256": setup["sha256"], "portableSha256": portable["sha256"]}, "evidence": evidence}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()
    result = verify()
    if args.write:
        (ROOT / "docs/acceptance-2.26.3.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf8")
        text = ("# MotionBench 2.26.3 布局专项验收\n\n" + "\n\n".join(result["scope"]) +
                "\n\n- 定向单元：5 组、99 项。\n- Chrome 与 Edge：各 21 项，均包含实际 PDF。\n" +
                "- 原生横向流程：11 项；原生故障路径：2 项。\n- 桌面包：271 个运行资源，安装器及 Portable 已绑定同一构建。\n\n" +
                "mini 外框为 160 × 72 像素，同份报告中的绘图区共享刻度留白。原始测量、计算结果、评价依据和正文不变；视窗调整产生的滚动位置及其保存版本单独记录。\n\n" +
                "HTML SHA256：`" + result["artifact"]["sha256"] + "`\n\nASAR SHA256：`" + result["package"]["archiveSha256"] + "`\n")
        (ROOT / "docs/acceptance-2.26.3.md").write_text(text, encoding="utf8")
    print(json.dumps({"pass": True, "sourceHash": result["artifact"]["sha256"], "unitSuites": 5, "unitChecks": 99, "browserChecks": result["browserChecks"]}))


if __name__ == "__main__":
    main()
