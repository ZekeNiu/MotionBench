"""Package the matching, captured before/after views into an offline viewer."""
from pathlib import Path
import sys
import base64
import hashlib
import json
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
CHART_AI = "--chart-ai" in sys.argv
OUT = ROOT / ("output/playwright/chart-ai" if CHART_AI else "output/playwright/visual-upgrade")
BACKUP = ROOT / ("output/backups/chart-ai-pre-implementation-20261007" if CHART_AI else "output/backups/visual-upgrade-pre-implementation-20261006")
digest = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
review = json.loads((OUT / "review.json").read_text(encoding="utf-8"))
assert review["pass"] and review["sourceHash"] == digest(ROOT / "Ringside_Boxing_Assessment.html")
names = [
    ("summary-1440", "报告首页 · 1440px"),
    ("fms-1440", "FMS 详细报告 · 1440px"),
    ("isometric-1440", "等长力量 · 1440px"),
    ("speed-1440", "速度与储备 · 1440px"),
    ("athlete-entry-1440", "运动员信息 · 1440px"),
    ("measurement-entry-1440", "IMTP 数据录入 · 1440px"),
    ("catalog-1440", "测试项目库 · 1440px"),
    ("catalog-expanded-1440", "展开项目指标 · 1440px"),
    ("settings-1440", "评价设置 · 1440px"),
    ("new-athlete-1440", "新建运动员弹窗 · 1440px"),
    ("summary-1920", "报告首页 · 1920px"),
    ("summary-1280", "报告首页 · 1280px"),
    ("summary-900", "报告首页 · 900px"),
    ("summary-390", "手机报告首页 · 390px"),
    ("entry-390", "手机数据录入 · 390px"),
    ("navigation-390", "手机侧栏 · 390px"),
    ("catalog-390", "手机项目库 · 390px"),
]
if CHART_AI:
    names = [(f"{name}-{width}", f"{label} · {width}px") for width in [1440, 390] for name, label in [("fms", "FMS 动作表现"), ("isometric", "等长力量"), ("imtp", "IMTP 力时曲线"), ("lactate", "递增负荷"), ("speed", "速度与储备"), ("lvp", "LVP")]]
assets = []
for name, label in names:
    assets.append((name, label, OUT / "before" / (name + ".png"), OUT / "after" / (name + ".png")))
for number, label in ([] if CHART_AI else [(1, "PDF 报告首页 · A4"), (2, "PDF FMS 报告 · A4")]):
    assets.append((f"pdf-{number}", label,
        BACKUP / f"output/pdf/rendered/chrome-sample/page-{number}.png",
        ROOT / f"output/pdf/rendered/chrome-sample/page-{number:02d}.png"))

font = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 22)
payload, evidence = [], []
for name, label, before, after in assets:
    a, b = Image.open(before).convert("RGB"), Image.open(after).convert("RGB")
    assert a.size == b.size, (name, a.size, b.size)
    width, height = a.size
    comparison = Image.new("RGB", (width * 2 + 24, height + 64), "#f3f5f7")
    draw = ImageDraw.Draw(comparison)
    draw.text((20, 18), ("原版 2.4.0" if CHART_AI else "原版 2.3.0"), fill="#5f6b7a", font=font)
    draw.text((width + 44, 18), ("新版 2.5.0" if CHART_AI else "新版 2.4.0"), fill="#365b80", font=font)
    comparison.paste(a, (0, 64))
    comparison.paste(b, (width + 24, 64))
    target = OUT / (name + "-comparison.png")
    comparison.save(target)
    payload.append({"id": name, "label": label, "width": width, "height": height,
        "before": "data:image/png;base64," + base64.b64encode(before.read_bytes()).decode("ascii"),
        "after": "data:image/png;base64," + base64.b64encode(after.read_bytes()).decode("ascii")})
    evidence.append({"name": name, "dimensions": [width, height], "files": [
        {"path": p.relative_to(ROOT).as_posix(), "sha256": digest(p)} for p in [before, after, target]]})

template = r'''<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ringside · 前后视觉对比</title><style>
*{box-sizing:border-box}body{margin:0;background:#f3f5f7;color:#1e293b;font:14px/1.6 "Segoe UI","Microsoft YaHei",sans-serif}
header{background:#fff;border-bottom:1px solid #dce2e8;padding:28px 32px 24px}.heading{max-width:1600px;margin:auto}
.brand{font-size:12px;font-weight:700;letter-spacing:.16em;color:#365b80}h1{font-size:28px;line-height:1.4;margin:8px 0}p{color:#5f6b7a;margin:8px 0 0}
.controls{display:flex;gap:16px;align-items:center;flex-wrap:wrap;max-width:1600px;margin:24px auto;padding:0 24px}
label{font-weight:600}select,button{font:inherit;color:inherit;border:1px solid #cbd4de;border-radius:8px;background:#fff;padding:9px 14px;min-height:44px}
select{min-width:260px}button{cursor:pointer}button:hover{border-color:#365b80}button[aria-pressed=true]{background:#365b80;color:white;border-color:#365b80}
.modes{display:flex;gap:8px;margin-left:auto}button:focus-visible,select:focus-visible{outline:3px solid #365b80;outline-offset:3px}
main{padding:0 24px 32px;margin:auto;max-width:1800px}.panels{display:grid;grid-template-columns:1fr 1fr;gap:24px;align-items:start}
.panels.single{grid-template-columns:minmax(0,1fr);max-width:1440px;margin:auto}.panels.mobile{max-width:820px;margin:auto}.panels.mobile.single{max-width:390px}
figure{background:white;border:1px solid #dce2e8;border-radius:12px;overflow:hidden;margin:0;box-shadow:0 4px 16px #1e293b06}
figcaption{padding:12px 16px;border-bottom:1px solid #dce2e8;display:flex;justify-content:space-between;align-items:center;font-weight:600}.version{font-size:12px;color:#5f6b7a;font-weight:400}
.image-button{display:block;border:0;padding:0;width:100%;border-radius:0;min-height:0;background:#fff;cursor:zoom-in}.image-button img{display:block;width:100%;height:auto}
[hidden]{display:none!important}.hint{max-width:1600px;margin:0 auto 28px;padding:0 24px;font-size:12px;color:#5f6b7a}
dialog{border:1px solid #dce2e8;border-radius:12px;padding:0;width:min(96vw,1800px);max-height:94vh;background:#f3f5f7}dialog::backdrop{background:#152338bb}
.dialog-head{position:sticky;top:0;padding:12px 16px;display:flex;align-items:center;justify-content:space-between;background:white;border-bottom:1px solid #dce2e8;z-index:1}
.zoom-image{display:block;max-width:none;margin:0 auto}.zoom-scroll{overflow:auto;max-height:calc(94vh - 70px)}
@media(max-width:760px){header{padding:20px 16px}h1{font-size:24px}.controls{padding:0 16px;gap:12px}.controls label{width:100%}select{width:100%}.modes{margin:0;width:100%}.modes button{flex:1;padding:8px}.panels{grid-template-columns:1fr;gap:16px}main{padding:0 16px 24px}.hint{padding:0 16px}}
</style></head><body>
<header><div class="heading"><div class="brand">RINGSIDE / VISUAL UPDATE</div><h1>清晰、克制的专业工作台</h1><p>相同数据、相同尺寸，查看页面与 PDF 的前后变化。</p></div></header>
<div class="controls"><label for="scene">查看界面</label><select id="scene"></select><div class="modes" aria-label="对比方式"><button data-mode="both" aria-pressed="true">并排对比</button><button data-mode="after" aria-pressed="false">仅看新版</button><button data-mode="before" aria-pressed="false">仅看原版</button></div></div>
<main><div class="panels" id="panels"><figure id="beforePanel"><figcaption>原版<span class="version">2.3.0</span></figcaption><button class="image-button" id="beforeZoom" aria-label="放大原版截图"><img id="before" alt="原版界面"></button></figure><figure id="afterPanel"><figcaption>新版<span class="version">2.4.0</span></figcaption><button class="image-button" id="afterZoom" aria-label="放大新版截图"><img id="after" alt="新版界面"></button></figure></div></main>
<p class="hint">点击截图按原始尺寸查看；按 Esc 关闭。截图固定为同一示例与日期。本页可离线打开。</p>
<dialog id="zoom"><div class="dialog-head"><strong id="zoomTitle"></strong><button id="closeZoom" aria-label="关闭放大截图">关闭</button></div><div class="zoom-scroll"><img class="zoom-image" id="zoomImage" alt=""></div></dialog>
<script>
const scenes=__SCENES__;
const select=document.getElementById('scene'),panels=document.getElementById('panels'),zoom=document.getElementById('zoom');let mode='both';
scenes.forEach(s=>{const o=document.createElement('option');o.value=s.id;o.textContent=s.label;select.append(o)});
function render(){const s=scenes.find(s=>s.id===select.value);panels.classList.toggle('mobile',s.width===390);panels.classList.toggle('single',mode!=='both');for(const version of ['before','after']){const image=document.getElementById(version);image.src=s[version];image.width=s.width;image.height=s.height;image.alt=s.label+' · '+(version==='before'?'原版':'新版');document.getElementById(version+'Panel').hidden=mode!=='both'&&mode!==version;}document.querySelectorAll('[data-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.mode===mode)))}
select.addEventListener('change',render);document.querySelectorAll('[data-mode]').forEach(b=>b.addEventListener('click',()=>{mode=b.dataset.mode;render()}));
for(const version of ['before','after'])document.getElementById(version+'Zoom').addEventListener('click',()=>{const s=scenes.find(s=>s.id===select.value),image=document.getElementById('zoomImage');image.src=s[version];image.width=s.width;image.height=s.height;image.alt=s.label;document.getElementById('zoomTitle').textContent=s.label+' · '+(version==='before'?'原版':'新版');zoom.showModal()});
document.getElementById('closeZoom').addEventListener('click',()=>zoom.close());render();
</script></body></html>'''
if CHART_AI:
    template = template.replace("2.4.0", "2.5.0").replace("2.3.0", "2.4.0")
target = OUT / "comparison.html"
target.write_text(template.replace("__SCENES__", json.dumps(payload, ensure_ascii=False).replace("</", "<\\/")), encoding="utf-8")
manifest = {"sourceHash": review["sourceHash"], "baselineHash": review["baselineHash"],
    "viewer": {"path": target.relative_to(ROOT).as_posix(), "sha256": digest(target)}, "scenes": evidence}
(OUT / "comparison-manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"Built offline comparison: {len(payload)} matching image pairs; {target.stat().st_size:,} bytes")
