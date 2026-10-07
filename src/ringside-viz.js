(function (global) {
  "use strict";

  const C = {
    ink: "#262a30",
    muted: "#636b76",
    grid: "#e5e8ec",
    blue: "#365b7a",
    green: "#187459",
    amber: "#8a5a12",
    red: "#b23f3d",
    gray: "#636b76",
    paper: "#f8f9fb",
    neutral: "#365b7a",
  };
  const FONT = "Segoe UI, 'Microsoft YaHei', 'PingFang SC', Arial, sans-serif";
  const SERIES = ["#365b7a", "#71849f", "#786aa8", "#a37e46"];
  let serial = 0;
  const esc = (v) =>
    String(v == null ? "" : v).replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  const num = (v) =>
    typeof v === "number"
      ? Number.isFinite(v)
        ? v
        : null
      : typeof v === "string" &&
          v.trim() &&
          /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(v.trim()) &&
          Number.isFinite(Number(v))
        ? Number(v)
        : null;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const fmt = (v, digits = 2) =>
    Number.isFinite(v) ? String(Number(v.toFixed(digits))) : "—";
  const color = (status) => C[status] || C.neutral;
  const text = (x, y, value, attrs = "") =>
    `<text x="${fmt(x)}" y="${fmt(y)}" font-family="${FONT}"${/\bfont-size\s*=/.test(attrs) ? "" : ' font-size="12"'}${/\bfill\s*=/.test(attrs) ? "" : ` fill="${C.muted}"`} ${attrs}>${esc(value)}</text>`;
  const line = (x1, y1, x2, y2, attrs = "") =>
    `<line x1="${fmt(x1)}" y1="${fmt(y1)}" x2="${fmt(x2)}" y2="${fmt(y2)}"${/\bstroke\s*=/.test(attrs) ? "" : ` stroke="${C.grid}"`} ${attrs}/>`;
  const circle = (x, y, r, fill, attrs = "") =>
    `<circle cx="${fmt(x)}" cy="${fmt(y)}" r="${r}" fill="${fill}" ${attrs}/>`;
  const polygonPoints = (points) =>
    points.map((p) => `${fmt(p[0])},${fmt(p[1])}`).join(" ");
  const polarFrame = (cx, cy, count) => (i, radius) => [
    cx + radius * Math.cos(-Math.PI / 2 + (i * 2 * Math.PI) / count),
    cy + radius * Math.sin(-Math.PI / 2 + (i * 2 * Math.PI) / count),
  ];
  function radarSeries(points, stroke, center = null, opacity = 0.07) {
    if (points.every(Boolean))
      return `<polygon class="radar-fill" points="${polygonPoints(points)}" fill="${stroke}" fill-opacity="${opacity}" stroke="${stroke}" stroke-width="2.3"/>`;
    // Fill only sectors between adjacent measured axes; missing axes stay open.
    const fill = center
      ? points
          .map((p, i) =>
            p && points[(i + 1) % points.length]
              ? `<polygon class="radar-fill" points="${polygonPoints([center, p, points[(i + 1) % points.length]])}" fill="${stroke}" fill-opacity="${opacity}" stroke="none"/>`
              : "",
          )
          .join("")
      : "";
    return (
      fill +
      points
        .map((p, i) =>
          p && points[(i + 1) % points.length]
            ? line(
                ...p,
                ...points[(i + 1) % points.length],
                `stroke="${stroke}" stroke-width="2.3"`,
              )
            : "",
        )
        .join("")
    );
  }
  function marker(x, y, r, fill, shape = "circle", attrs = "") {
    if (shape === "square")
      return `<rect x="${fmt(x - r)}" y="${fmt(y - r)}" width="${r * 2}" height="${r * 2}" rx="1" fill="${fill}" ${attrs}/>`;
    if (shape === "diamond")
      return `<polygon points="${polygonPoints([
        [x, y - r * 1.25],
        [x + r * 1.25, y],
        [x, y + r * 1.25],
        [x - r * 1.25, y],
      ])}" fill="${fill}" ${attrs}/>`;
    if (shape === "triangle")
      return `<polygon points="${polygonPoints([
        [x, y - r * 1.3],
        [x + r * 1.25, y + r],
        [x - r * 1.25, y + r],
      ])}" fill="${fill}" ${attrs}/>`;
    return circle(x, y, r, fill, attrs);
  }
  const point = (x, y, r, fill, tooltip, extra = "", shape = "circle") =>
    `<g class="viz-point" data-tooltip="${esc(tooltip)}" tabindex="0" ${extra}><title>${esc(tooltip)}</title>${marker(x, y, r, fill, shape, 'stroke="white" stroke-width="2"')}</g>`;
  function svg(w, h, title, markup, description = "", pixelLayout = false) {
    const id = `ringside-viz-${++serial}`;
    return `<svg id="${id}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" role="img" aria-labelledby="${id}-title ${id}-desc" style="display:block;width:100%;height:auto"><title id="${id}-title">${esc(title)}</title><desc id="${id}-desc">${esc(description || title)}</desc><style>.viz-point,.viz-region,.lvp-hit{outline:none}.viz-point:focus>circle,.viz-point:focus>polygon,.viz-point:focus>rect,.viz-region:focus .viz-hotspot{stroke:#365b7a;stroke-width:3}.viz-region{cursor:pointer}.lvp-hit{cursor:crosshair}.lvp-hit:focus{stroke:#365b7a;stroke-opacity:.15}${pixelLayout ? "" : `@media screen and (max-width:600px){#${id} text{font-size:18px}#${id} text[font-size="9"],#${id} text[font-size="10"]{font-size:15px}}`}</style>${markup}</svg>`;
  }
  function layoutSVG(w, h, title, markup, description, layout = {}) {
    const scale = layout.print ? 0.86 : 1;
    markup = markup.replace(/font-size="([\d.]+)"/g, (_, size) => `font-size="${fmt(Number(size) * scale)}"`);
    return svg(w, h, title, markup, description, true).replace("<svg ", '<svg data-pixel-layout="true" ');
  }
  function empty(title, subtitle, w = 620, h = 270) {
    return svg(
      w,
      h,
      title,
      `<rect x="18" y="18" width="${w - 36}" height="${h - 36}" rx="15" fill="${C.paper}" stroke="${C.grid}"/>${text(w / 2, h / 2 - 1, title, `text-anchor="middle" font-size="16" font-weight="600" fill="${C.ink}"`)}${text(w / 2, h / 2 + 26, subtitle || "录入数据后显示", 'text-anchor="middle" font-size="12"')}`,
    );
  }
  function ticks(min, max, count = 5) {
    const raw = Math.max(max - min, 0.0001) / count;
    const base = 10 ** Math.floor(Math.log10(raw)),
      fraction = raw / base;
    const step =
      (fraction <= 1
        ? 1
        : fraction <= 2
          ? 2
          : fraction <= 2.5
            ? 2.5
            : fraction <= 5
              ? 5
              : 10) * base;
    const values = [];
    for (
      let v = Math.ceil(min / step) * step;
      v <= max + step * 0.0001;
      v += step
    )
      values.push(Number(v.toFixed(8)));
    return values;
  }
  function axisGrid({
    left,
    right,
    top,
    bottom,
    xMin = 0,
    xMax,
    yMin = 0,
    yMax,
    xLabel,
    yLabel,
    solidGrid = false,
    xTicks = true,
  }) {
    const x = (v) => left + ((v - xMin) / (xMax - xMin)) * (right - left);
    const y = (v) => bottom - ((v - yMin) / (yMax - yMin)) * (bottom - top);
    let out = "";
    ticks(yMin, yMax).forEach((v) => {
      out += line(left, y(v), right, y(v));
      out += text(
        left - 11,
        y(v) + 4,
        fmt(v),
        'text-anchor="end" font-size="12"',
      );
    });
    (xTicks ? ticks(xMin, xMax) : []).forEach((v) => {
      out += line(
        x(v),
        top,
        x(v),
        bottom,
        solidGrid ? "" : 'stroke-dasharray="3 5"',
      );
      out += text(
        x(v),
        bottom + 22,
        fmt(v),
        'text-anchor="middle" font-size="12"',
      );
    });
    out +=
      line(left, bottom, right, bottom, `stroke="${C.gray}"`) +
      line(left, top, left, bottom, `stroke="${C.gray}"`);
    out +=
      text((left + right) / 2, bottom + 45, xLabel, 'text-anchor="middle" font-size="13"') +
      text(left, top - 13, yLabel, 'font-size="13"');
    return { out, x, y };
  }

  const bodyStatusLabels = { red: "重点关注", amber: "关注", green: "优秀", gray: "未测", neutral: "已测" };
  const bodyStatusLabel = (region) => region.status === "green" ? "优秀" : region.label || bodyStatusLabels[region.status] || "未测";
  function bodyTestText(test) {
    const side = { L: "左侧", R: "右侧", C: "中线" }[test.side] || test.side || "",
      title = [test.testName && test.testName !== test.name ? test.testName : "", test.name || "测试", side].filter(Boolean).join(" · "),
      value = test.missing ? "未测" : num(test.value) !== null ? fmt(test.value, 2) + (test.unit ? " " + test.unit : "") : test.label || "已测",
      facts = [value];
    if (num(test.target) !== null) facts.push("目标 " + fmt(test.target, 2) + (test.unit ? " " + test.unit : ""));
    if (!test.missing && test.label && test.label !== value) facts.push(test.label);
    if (num(test.asym) !== null) facts.push("双侧差异 " + fmt(test.asym, 1) + "%");
    if (test.pain) facts.push("疼痛");
    if (test.notes) facts.push(String(test.notes));
    return { title, detail: facts.join(" · ") };
  }
  function bodyTooltip(region = {}) {
    const status = Object.hasOwn(bodyStatusLabels, region.status) ? region.status : "gray",
      tests = Array.isArray(region.tests) ? region.tests : [];
    return `<div class="body-detail"><h3>${esc(region.name || "身体区域")}<span class="pill ${status}">${esc(bodyStatusLabel(region))}</span></h3>` +
      (tests.length ? `<ul>${tests.map(test => { const item = bodyTestText(test); return `<li><strong>${esc(item.title)}</strong><p>${esc(item.detail)}</p></li>`; }).join("")}</ul>` : `<p>${esc(region.detail || region.tooltip || "暂无关联测试数据")}</p>`) + `</div>`;
  }

  function body(regions, imageURL) {
    regions = regions || {};
    const find = (key) => {
      const [name, side] = key.split("_"),
        full = side === "r" ? "right" : "left";
      const aliases = side
        ? [
            key,
            `${full}_${name}`,
            `${name}_${full}`,
            `${full}${name[0].toUpperCase() + name.slice(1)}`,
            `${name}-${full}`,
          ]
        : [key];
      let r = aliases.map((a) => regions[a]).find((v) => v !== undefined);
      if (
        r === undefined &&
        side &&
        regions[name] &&
        typeof regions[name] === "object"
      )
        r = regions[name][full];
      if (typeof r === "string") r = { status: r };
      return {
        ...(r || {}),
        status: ["red", "amber", "green", "gray", "neutral"].includes(
          r && r.status,
        )
          ? r.status
          : "gray",
      };
    };
    const specs = [
      ["neck", "颈部", 512, 282],
      ["shoulder_r", "右肩", 367, 358],
      ["shoulder_l", "左肩", 657, 358],
      ["hip_r", "右髋", 425, 676],
      ["hip_l", "左髋", 601, 676],
      ["knee_r", "右膝", 444, 957],
      ["knee_l", "左膝", 584, 957],
      ["ankle_r", "右踝", 459, 1230],
      ["ankle_l", "左踝", 579, 1230],
    ];
    let out = imageURL
      ? `<image x="0" y="0" width="1024" height="1536" href="${esc(imageURL)}" preserveAspectRatio="xMidYMid meet"/>`
      : '<rect x="250" y="90" width="530" height="1260" fill="#e6edf6"/>';
    out +=
      text(
        297,
        132,
        "右侧 · R",
        `text-anchor="middle" fill="${C.neutral}" font-size="22" font-weight="600"`,
      ) +
      text(
        727,
        132,
        "左侧 · L",
        `text-anchor="middle" fill="${C.neutral}" font-size="22" font-weight="600"`,
      );
    specs.forEach(([key, name, x, y]) => {
      const r = { ...find(key), key, name }, c = color(r.status),
        tests = Array.isArray(r.tests) ? r.tests : [],
        details = tests.length ? tests.map(test => { const item = bodyTestText(test); return item.title + "：" + item.detail; }).join("；") : r.tooltip || r.detail || "",
        tooltip = `${name}：${bodyStatusLabel(r)}${details ? " · " + details : ""}`;
      out += `<g class="viz-region" data-region="${key}" data-body-detail="${esc(JSON.stringify(r))}" data-tooltip="${esc(tooltip)}" role="button" tabindex="0" aria-label="${esc(tooltip)}">${circle(x, y, 32, c, 'opacity=".16"')}${circle(x, y, 24, c, 'class="viz-hotspot" stroke="white" stroke-width="3"')}</g>`;
    });
    const id = `ringside-body-${++serial}`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="250 90 530 1260" role="img" aria-labelledby="${id}" style="display:block"><title id="${id}">身体区域筛查；图左为运动员右侧，图右为运动员左侧</title><style>.viz-region{cursor:pointer;outline:none}.viz-region:focus .viz-hotspot,.viz-region:hover .viz-hotspot{stroke:#dbe6ff;stroke-width:5}</style>${out}</svg>`;
  }

  function radar(items) {
    items = Array.isArray(items) ? items : [];
    if (!items.length)
      return empty(
        "运动表现等待数据",
        "录入测试并配置评价标准后显示",
        520,
        350,
      );
    if (items.length < 3 || items.length > 8) return abilityList(items);
    const w = 520,
      h = 390,
      cx = 260,
      cy = 189,
      radius = 124,
      n = items.length;
    const polar = polarFrame(cx, cy, n);
    let out =
      `<polygon points="${polygonPoints(items.map((_, i) => polar(i, radius)))}" fill="${C.paper}" fill-opacity=".6"/>` +
      [20, 40, 60, 80, 100]
        .map(
          (v) =>
            `<polygon points="${polygonPoints(items.map((_, i) => polar(i, (radius * v) / 100)))}" fill="none" stroke="${C.grid}"/>`,
        )
        .join("");
    [20, 40, 60, 80].forEach((v) => {
      out += text(cx + 7, cy - (radius * v) / 100 + 4, v, 'font-size="9"');
    });
    items.forEach((_, i) => {
      const p = polar(i, radius);
      out += line(cx, cy, p[0], p[1]);
    });
    const points = items.map((item, i) =>
      num(item.value) === null
        ? null
        : polar(i, (radius * clamp(Number(item.value), 0, 100)) / 100),
    );
    if (points.every(Boolean))
      out += `<polygon points="${polygonPoints(points)}" fill="${C.neutral}" fill-opacity=".06" stroke="${C.neutral}" stroke-width="2.2" stroke-linejoin="round"/>`;
    else
      points.forEach((p, i) => {
        const q = points[(i + 1) % n];
        if (p && q)
          out += line(
            p[0],
            p[1],
            q[0],
            q[1],
            `stroke="${C.neutral}" stroke-width="2.2"`,
          );
      });
    items.forEach((item, i) => {
      const v = num(item.value),
        a = -Math.PI / 2 + (i * 2 * Math.PI) / n,
        p = polar(i, radius + 25);
      const anchor =
          Math.cos(a) > 0.25 ? "start" : Math.cos(a) < -0.25 ? "end" : "middle",
        c = v === null ? C.gray : color(item.status);
      const label = String(item.label || "能力"),
        parts =
          label.length > 6
            ? [
                label.slice(0, 6),
                label.length > 12 ? label.slice(6, 11) + "…" : label.slice(6),
              ]
            : [label];
      out += `<text class="radar-label" x="${fmt(p[0])}" y="${fmt(p[1] - (parts.length > 1 ? 8 : 0))}" font-family="${FONT}" font-size="18" font-weight="600" fill="${c}" text-anchor="${anchor}"><title>${esc(label)}</title>${parts.map((part, j) => `<tspan x="${fmt(p[0])}" dy="${j ? 22 : 0}">${esc(part)}</tspan>`).join("")}</text>`;
      out += text(
        p[0],
        p[1] + (parts.length > 1 ? 38 : 24),
        v === null ? "—" : `${fmt(v, 0)} / 100`,
        `class="radar-score" text-anchor="${anchor}" font-size="14" fill="${c}"`,
      );
      if (points[i])
        out += point(
          points[i][0],
          points[i][1],
          5,
          c,
          `${label}：${fmt(v, 1)} / 100${item.tooltip ? " · " + item.tooltip : ""}`,
        );
    });
    return svg(w, h, "运动表现能力雷达图", out);
  }

  function abilityList(items) {
    return (
      '<div class="ability-comparison table-wrap"><table><thead><tr><th scope="col">能力</th><th scope="col">目标达成</th></tr></thead><tbody>' +
      items
        .map(
          (item) =>
            "<tr><td>" +
            esc(item.label) +
            '</td><td><strong style="color:' +
            color(item.status) +
            '">' +
            (num(item.value) === null ? "—" : fmt(num(item.value), 0) + "%") +
            "</strong></td></tr>",
        )
        .join("") +
      "</tbody></table></div>"
    );
  }
  function fms(items, layout = {}) {
    items = Array.isArray(items) ? items : [];
    const w = layout.width || 460,
      h = layout.height || 350,
      cx = w / 2,
      radius = Math.min(w / 2 - (layout.print ? 80 : 88), (h - 148) / 2),
      cy = radius + 66,
      n = 7;
    const polar = polarFrame(cx, cy, n);
    const valid = (item) => {
      const score = num(item?.score);
      return Number.isInteger(score) && score >= 0 && score <= 3 ? score : null;
    };
    const points = Array.from({ length: n }, (_, i) =>
      valid(items[i]) === null
        ? null
        : polar(i, (radius * valid(items[i])) / 3),
    );
    let out = [1, 2, 3]
      .map(
        (score) =>
          '<polygon points="' +
          polygonPoints(
            Array.from({ length: n }, (_, i) => polar(i, (radius * score) / 3)),
          ) +
          '" fill="none" stroke="' +
          C.grid +
          '"/>',
      )
      .join("");
    [1, 2, 3].forEach((score) => {
      out += text(
        cx + 7,
        cy - (radius * score) / 3 + 4,
        score,
        'font-size="10"',
      );
    });
    for (let i = 0; i < n; i++) {
      const p = polar(i, radius);
      out += line(cx, cy, p[0], p[1]);
    }
    if (points.every(Boolean))
      out +=
        '<polygon points="' +
        polygonPoints(points) +
        '" fill="' +
        C.neutral +
        '" fill-opacity=".07" stroke="' +
        C.neutral +
        '" stroke-width="2"/>';
    else
      points.forEach((p, i) => {
        const q = points[(i + 1) % n];
        if (p && q)
          out += line(
            ...p,
            ...q,
            'stroke="' + C.neutral + '" stroke-width="2"',
          );
      });
    for (let i = 0; i < n; i++) {
      const item = items[i] || {},
        score = valid(item),
        a = -Math.PI / 2 + (i * 2 * Math.PI) / n,
        p = polar(i, radius + (i === 0 ? 43 : i === 2 || i === 5 ? 45 : i === 1 || i === 6 ? 32 : 23));
      const anchor = "middle";
      const label = String(
        item.label ||
          global.RingsideTests?.fmsAbilities[i] ||
          "动作 " + (i + 1),
      );
      const parts =
        label === "髋部活动与骨盆控制"
          ? ["髋部活动", "与骨盆控制"]
          : label.length > 6
            ? [label.slice(0, 5), label.slice(5)]
            : [label];
      const status =
          score === null
            ? "gray"
            : score === 0
              ? "red"
              : score === 3
                ? "green"
                : "amber",
        c = color(status);
      out +=
        '<g data-fms-axis="' +
        i +
        '"><text x="' +
        fmt(p[0]) +
        '" y="' +
        fmt(p[1] - (parts.length > 1 ? 7 : 0)) +
        '" text-anchor="' +
        anchor +
        '" font-family="' +
        FONT +
        '" font-size="13" font-weight="400" fill="' +
        c +
        '"><title>' +
        esc(item.testName || label) +
        "</title>" +
        parts
          .map(
            (part, j) =>
              '<tspan x="' +
              fmt(p[0]) +
              '" dy="' +
              (j ? 17 : 0) +
              '">' +
              esc(part) +
              "</tspan>",
          )
          .join("") +
        "</text>";
      out += text(
        p[0],
        p[1] + (parts.length > 1 ? 30 : 19),
        score === null ? "未测" : score === 0 ? "0 · 疼痛" : score + " / 3",
        'text-anchor="' + anchor + '" font-size="12" fill="' + c + '"',
      );
      if (points[i])
        out += point(
          ...points[i],
          4.5,
          c,
          (item.testName || label) +
            "：" +
            score +
            " / 3" +
            (score === 0 ? " · 疼痛" : ""),
        );
      out += "</g>";
    }
    out += text(
      w / 2,
      h - 12,
      "0 疼痛 · 1 未完成 · 2 代偿完成 · 3 无代偿完成",
      'text-anchor="middle" font-size="11"',
    );
    return layoutSVG(w, h, "FMS 动作表现雷达图", out, "保留原动作分数、疼痛与缺测，不推断病因。", layout);
  }
  function isoRadar(data, layout = {}) {
    const w = layout.width || 470,
      h = layout.height || 360,
      cx = w / 2,
      axes = data.axes,
      max = data.max || 100,
      labelClearance = Math.max(34, ...axes.map((axis) => (axis.label.length + (axis.pain ? 5 : 0)) * 6.5 * (layout.print ? .86 : 1) + 27)),
      radius = .9 * Math.min(w / 2 - labelClearance, (h - 112) / 2),
      cy = (h - 36) / 2,
      polar = polarFrame(cx, cy, axes.length);
    const series = [
      {
        key: "strength",
        name: "力量水平",
        color: C.blue,
        source: "strengthSources",
      },
      {
        key: "symmetry",
        name: "对称性",
        color: "#956a43",
        source: "symmetrySources",
      },
    ];
    let out = "";
    for (const v of [...new Set([max / 4, max / 2, max * 0.75, max, 100])].sort(
      (a, b) => a - b,
    )) {
      out += `<polygon points="${polygonPoints(axes.map((_, i) => polar(i, (radius * v) / max)))}" fill="none" stroke="${C.grid}" stroke-width="1"/>`;
      out += text(
        cx + 6,
        cy - (radius * v) / max + 4,
        fmt(v, 0) + "%",
        'font-size="10"',
      );
    }
    axes.forEach((axis, i) => {
      out += line(cx, cy, ...polar(i, radius));
      const side = i === 1 || i === 4,
        p = polar(i, radius + (side ? 25 : 22)),
        anchor = "middle";
      out += text(
        ...p,
        axis.label + (axis.pain ? " · 疼痛" : ""),
        `text-anchor="${anchor}" font-size="13" fill="${axis.pain ? C.red : C.ink}"`,
      );
    });
    series.forEach((s, j) => {
      const points = axes.map((axis, i) =>
        num(axis[s.key]) === null
          ? null
          : polar(i, (radius * axis[s.key]) / max),
      );
      out +=
        `<g data-radar-series="${s.key}">` +
        radarSeries(points, s.color, [cx, cy], j ? 0.22 : 0.14);
      points.forEach((p, i) => {
        if (p) {
          const a = axes[i];
          out += point(
            ...p,
            4.4,
            s.color,
            `${a.label} · ${s.name} ${fmt(a[s.key], 1)}%${s.key === "symmetry" ? " · 平均双侧差异 " + fmt(100 - a[s.key], 1) + "%" : ""}；${a[s.source].map((x) => x.label + " " + fmt(s.key === "symmetry" ? 100 - x.value : x.value, 1) + "%").join("；")}`,
          );
        }
      });
      out +=
        "</g>" +
        circle(cx - 107 + j * 136, h - 34, 4, s.color) +
        text(cx - 95 + j * 136, h - 30, s.name, `fill="${s.color}" font-size="12"`);
    });
    out += text(
      cx,
      h - 8,
      "力量：目标达成均值 · 对称：100% − 平均差异",
      'text-anchor="middle" font-size="11"',
    );
    return layoutSVG(
      w,
      h,
      "关节力量与对称性",
      out,
      "每个关节按有效方向等权平均；缺测留空，两条轮廓均越外越好。",
      layout,
    );
  }
  function jumpBars(items) {
    const max = Math.max(10, ...items.map((x) => num(x.value) || 0)) * 1.2;
    const grid = axisGrid({
      left: 65,
      right: 475,
      top: 30,
      bottom: 265,
      xMax: items.length,
      yMax: max,
      xLabel: "",
      yLabel: "跳高 / cm",
      solidGrid: true,
      xTicks: false,
    });
    let out = grid.out;
    items.forEach((item, i) => {
      const x = 65 + ((i + 0.5) * 410) / items.length,
        v = num(item.value),
        c = i ? "#956a43" : C.blue;
      if (v !== null)
        out += `<rect x="${fmt(x - 38)}" y="${fmt(grid.y(v))}" width="76" height="${fmt(265 - grid.y(v))}" rx="3" fill="${c}"/><g>${text(x, grid.y(v) - 11, fmt(v, 1), `text-anchor="middle" font-size="16" fill="${c}"`)}</g>`;
      out += text(
        x,
        316,
        item.label,
        'text-anchor="middle" font-size="15" fill="' + C.ink + '"',
      );
      if (v === null) out += text(x, 245, "未录入跳高", 'text-anchor="middle"');
    });
    return svg(540, 345, "CMJ / SJ 跳高对比", out);
  }
  function asymInline(value, weakSide, rules = {}) {
    value = num(value);
    if (value === null) return '<span class="muted">—</span>';
    const max = Math.max(
        20,
        num(rules.asymMax) || 0,
        value * 1.1,
        (num(rules.asymRed) || 0) * 1.2,
      ),
      x = (v) => 8 + 164 * clamp(v / max, 0, 1);
    const status =
      value >= Number(rules.asymRed)
        ? "red"
        : value >= Number(rules.asymAmber)
          ? "amber"
          : "green";
    const label =
      fmt(value, 1) +
      "%" +
      (weakSide
        ? " · " + (weakSide === "L" ? "左侧低" : "右侧低")
        : value === 0
          ? " · 两侧相同"
          : "");
    let out = line(8, 12, 172, 12, 'stroke-width="4" stroke-linecap="round"');
    [
      [rules.asymAmber, C.amber],
      [rules.asymRed, C.red],
    ].forEach(([limit, c]) => {
      if (num(limit) !== null)
        out += line(
          x(Number(limit)),
          3,
          x(Number(limit)),
          23,
          'stroke="' + c + '" stroke-dasharray="2 2"',
        );
    });
    out += circle(x(value), 12, 4.5, color(status));
    return (
      '<div class="inline-asym"><span class="' +
      status +
      '">' +
      esc(label) +
      "</span>" +
      svg(180, 26, "双侧差异 " + label, out) +
      "</div>"
    );
  }

  function compare(items, opts) {
    opts = opts || {};
    items = Array.isArray(items) ? items : [];
    if (!items.length)
      return empty("等待测试结果", "录入数据后显示实测值与评价目标");
    if (opts.compact && items.length === 1) {
      const item = items[0],
        value = num(item.value),
        target = num(item.target),
        max = Math.max(1, (value || 0) * 1.15, (target || 0) * 1.2),
        x = (v) => 20 + 440 * clamp(v / max, 0, 1);
      let out = line(
        20,
        26,
        460,
        26,
        'stroke-width="8" stroke-linecap="round"',
      );
      if (target !== null) {
        out +=
          line(
            x(target),
            12,
            x(target),
            42,
            `stroke="${C.gray}" stroke-dasharray="3 3"`,
          ) +
          text(
            x(target),
            65,
            "目标 " + fmt(target) + " " + (item.unit || ""),
            'text-anchor="middle" font-size="12"',
          );
      }
      if (value !== null)
        out += point(
          x(value),
          26,
          6,
          color(item.status),
          `${item.label}：${fmt(value)} ${item.unit || ""}`,
        );
      out += text(
        600,
        32,
        value === null ? "—" : fmt(value) + " " + (item.unit || ""),
        `text-anchor="end" font-size="17" font-weight="600" fill="${color(item.status)}"`,
      );
      return svg(620, 82, item.label || "实测与目标", out);
    }
    const w = 620,
      row = 66,
      h = 54 + items.length * row + 22,
      left = 208,
      right = 493;
    let out = text(
      18,
      22,
      opts.title || "实测与评价目标",
      `font-size="14" font-weight="600" fill="${C.ink}"`,
    );
    items.forEach((item, i) => {
      const cy = 57 + i * row,
        value = num(item.value),
        target = num(item.target),
        unit = item.unit || "";
      const min = num(item.min) ?? num(opts.min) ?? 0,
        max =
          num(item.max) ??
          num(opts.max) ??
          Math.max((value || 0) * 1.15, (target || 0) * 1.2, min + 1);
      const x = (v) =>
          left +
          ((clamp(v, min, max) - min) / Math.max(0.001, max - min)) *
            (right - left),
        label = String(item.label || "测试结果");
      const labels =
        label.length > 14 ? [label.slice(0, 14), label.slice(14, 28)] : [label];
      out += `<text x="18" y="${cy + (labels.length > 1 ? -6 : 0)}" font-family="${FONT}" font-size="12" font-weight="500" fill="${C.ink}">${labels.map((part, j) => `<tspan x="18" dy="${j ? 22 : 0}">${esc(part)}</tspan>`).join("")}</text>`;
      out += `<rect x="${left}" y="${cy - 7}" width="${right - left}" height="10" rx="5" fill="${C.paper}"/>`;
      if (target !== null && target >= min && target <= max) {
        out += line(
          x(target),
          cy - 16,
          x(target),
          cy + 11,
          `stroke="${C.gray}" stroke-width="1.5" stroke-dasharray="3 2"`,
        );
        out += text(
          x(target),
          cy + 28,
          `${item.targetLabel || "目标"} ${fmt(target)} ${unit}`,
          'text-anchor="middle" font-size="10"',
        );
      }
      if (value !== null)
        out += point(
          x(value),
          cy - 2,
          5.5,
          color(item.status),
          `${label}：${fmt(value)} ${unit}${target !== null ? " · " + (item.targetLabel || "目标") + " " + fmt(target) + " " + unit : ""}${item.tooltip ? " · " + item.tooltip : ""}`,
        );
      out += text(
        603,
        cy + 3,
        value === null ? "—" : `${fmt(value)} ${unit}`,
        `text-anchor="end" font-size="14" font-weight="600" fill="${value === null ? C.gray : color(item.status)}"`,
      );
      if (i < items.length - 1) out += line(18, cy + 44, 603, cy + 44);
    });
    if (opts.footnote)
      out += text(
        603,
        h - 10,
        opts.footnote,
        'text-anchor="end" font-size="10"',
      );
    return svg(w, h, opts.title || "测试结果对比", out);
  }

  function isoAsymRows(asymRows) {
    return (Array.isArray(asymRows) ? asymRows : [])
      .map((row) => {
        const left = num(row.left),
          right = num(row.right),
          denominator = Math.max(Math.abs(left || 0), Math.abs(right || 0));
        const value =
          num(row.asym) ??
          num(row.value) ??
          (left !== null && right !== null && denominator > 0
            ? (Math.abs(left - right) / denominator) * 100
            : null);
        const side =
          row.stronger ||
          row.side ||
          (left !== null && right !== null && left !== right
            ? left > right
              ? "L"
              : "R"
            : "");
        return {
          ...row,
          value,
          side,
          label:
            row.label ||
            [row.regionLabel || row.region, row.direction]
              .filter(Boolean)
              .join(" · "),
        };
      })
      .filter((row) => row.value !== null);
  }
  function isoBalanceRows(balanceResults) {
    return (Array.isArray(balanceResults) ? balanceResults : []).filter(
      (row) =>
        num(row.left) !== null ||
        num(row.right) !== null ||
        num(row.value) !== null,
    );
  }
  function iso(asymRows, balanceResults, opts = {}) {
    const asym = isoAsymRows(asymRows),
      balance = isoBalanceRows(balanceResults);
    if (!asym.length && !balance.length)
      return empty("关节表现等待数据", "双侧结果与配对测试录入后显示");
    const max = Math.max(
      20,
      ...asym.map((row) => row.value * 1.15),
      (num(opts.asymAmber) || 0) * 1.3,
      (num(opts.asymRed) || 0) * 1.3,
    );
    const panelOpts = { ...opts, asymMax: max };
    const panels = [];
    for (let i = 0; i < asym.length; i += 5)
      panels.push(isoPanel(asym.slice(i, i + 5), [], panelOpts));
    for (let i = 0; i < balance.length; i += 5)
      panels.push(isoPanel([], balance.slice(i, i + 5), panelOpts));
    return `<div class="iso-charts">${panels.join("")}</div>`;
  }
  function isoPanel(asymRows, balanceResults, opts) {
    if (!asymRows.length && !balanceResults.length)
      return empty("关节表现等待数据", "双侧结果与配对测试录入后显示");
    const w = 620,
      asymHeight = asymRows.length ? 118 + asymRows.length * 43 : 0,
      ratioHeight = balanceResults.length ? 65 + balanceResults.length * 69 : 0,
      h = asymHeight + ratioHeight + 12;
    let out = "";
    if (asymRows.length) {
      out += text(
        18,
        24,
        "双侧不对称性",
        `font-size="14" font-weight="600" fill="${C.ink}"`,
      );
      out += text(
        603,
        24,
        "% · L / R 为较强侧",
        'text-anchor="end" font-size="10"',
      );
      const max = opts.asymMax,
        left = 232,
        right = 518,
        graphTop = 49,
        graphBottom = 85 + (asymRows.length - 1) * 43;
      const x = (value) => left + ((right - left) * value) / max;
      ticks(0, max, 4).forEach((v) => {
        out +=
          line(x(v), graphTop, x(v), graphBottom, 'stroke-dasharray="2 5"') +
          text(
            x(v),
            graphBottom + 22,
            fmt(v, 0) + "%",
            'text-anchor="middle" font-size="10"',
          );
      });
      let legendX = 18;
      [
        [num(opts.asymAmber), C.amber, "关注阈值"],
        [num(opts.asymRed), C.red, "重点关注阈值"],
      ].forEach(([value, c, label]) => {
        if (value === null || value < 0 || value > max) return;
        const tooltip = `${label} ${fmt(value)}%`;
        out += `<g data-tooltip="${esc(tooltip)}"><title>${esc(tooltip)}</title>${line(x(value), graphTop, x(value), graphBottom, `stroke="${c}" stroke-opacity=".7" stroke-dasharray="4 4" stroke-width="1.4"`)}</g>`;
        out +=
          line(
            legendX,
            graphBottom + 45,
            legendX + 20,
            graphBottom + 45,
            `stroke="${c}" stroke-dasharray="4 3" stroke-width="1.4"`,
          ) + text(legendX + 27, graphBottom + 49, tooltip, 'font-size="10"');
        legendX += 178;
      });
      asymRows.forEach((row, i) => {
        const y = 70 + i * 43,
          cx = x(row.value);
        out +=
          text(18, y + 4, row.label, `font-size="11" fill="${C.ink}"`) +
          line(left, y, right, y, 'stroke-width="2"');
        out += line(
          left,
          y,
          cx,
          y,
          `stroke="${color(row.status)}" stroke-opacity=".55" stroke-width="4" stroke-linecap="round"`,
        );
        out += point(
          cx,
          y,
          5.5,
          color(row.status),
          `${row.label}：${fmt(row.value, 1)}%${row.side ? " · " + row.side + " 较强" : ""}${row.tooltip ? " · " + row.tooltip : ""}`,
        );
        out += text(
          603,
          y + 4,
          `${fmt(row.value, 1)}%${row.side ? " " + row.side : ""}`,
          `text-anchor="end" font-weight="600" fill="${color(row.status)}"`,
        );
      });
    }
    if (balanceResults.length) {
      const top = asymHeight;
      if (asymHeight) out += line(18, top + 2, 603, top + 2);
      out += text(
        18,
        top + 27,
        "关节平衡",
        `font-size="14" font-weight="600" fill="${C.ink}"`,
      );
      balanceResults.forEach((row, i) => {
        const cy = top + 65 + i * 69,
          l = num(row.left),
          r = num(row.right),
          value = num(row.value),
          left = 232,
          right = 518;
        const ranges = row.range
          ? [row.range]
          : row.confirmed && row.referenceEnabled
            ? (row.ranges || []).filter((range) => range.status === "green")
            : [];
        const max =
          Math.max(
            1,
            l || 0,
            r || 0,
            value || 0,
            ...ranges.map((range) => num(range.max) || num(range.min) || 0),
          ) * 1.16;
        const x = (v) => left + (Math.max(0, v) / max) * (right - left);
        const rangeLabel = (range) =>
          num(range.min) === null
            ? `${range.includeMax === false ? "<" : "≤"} ${fmt(num(range.max))}`
            : num(range.max) === null
              ? `${range.includeMin === false ? ">" : "≥"} ${fmt(num(range.min))}`
              : `${fmt(num(range.min))}–${fmt(num(range.max))}`;
        out +=
          text(
            18,
            cy + 4,
            row.label || row.name || "肌力比值",
            `font-size="11" fill="${C.ink}"`,
          ) + line(left, cy, right, cy, 'stroke-width="2"');
        ranges.forEach((range) => {
          const lo = num(range.min) ?? 0,
            hi = num(range.max) ?? max;
          if (hi <= lo) return;
          out += `<g data-tooltip="${esc("已设评价区间 " + rangeLabel(range))}">${line(x(lo), cy, x(hi), cy, `stroke="${C.green}" stroke-width="10" stroke-opacity=".18"`)}${num(range.min) !== null ? line(x(lo), cy - 9, x(lo), cy + 9, `stroke="${C.green}" stroke-opacity=".65"`) : ""}${num(range.max) !== null ? line(x(hi), cy - 9, x(hi), cy + 9, `stroke="${C.green}" stroke-opacity=".65"`) : ""}</g>`;
        });
        if (l !== null)
          out += point(
            x(l),
            cy - 4,
            5,
            color(row.statusLeft || row.leftStatus || row.status),
            `${row.label} · L：${fmt(l, 2)}${row.unit || ""}`,
            "",
            "circle",
          );
        if (r !== null)
          out += point(
            x(r),
            cy + 5,
            5,
            color(row.statusRight || row.rightStatus || row.status),
            `${row.label} · R：${fmt(r, 2)}${row.unit || ""}`,
            "",
            "square",
          );
        if (l === null && r === null && value !== null)
          out += point(
            x(value),
            cy,
            5,
            color(row.status),
            `${row.label}：${fmt(value, 2)}${row.unit || ""}`,
          );
        out += text(
          603,
          cy + 4,
          l !== null || r !== null ? `L ${fmt(l)} / R ${fmt(r)}` : fmt(value),
          `text-anchor="end" font-size="11" fill="${C.ink}"`,
        );
        out += text(
          left,
          cy + 28,
          ranges.length
            ? `评价区间 ${ranges.map(rangeLabel).join(" / ")}`
            : "未设适用评价区间",
          'font-size="10"',
        );
        if (l !== null || r !== null)
          out += text(
            603,
            cy + 44,
            "圆点 L · 方点 R",
            'text-anchor="end" font-size="9"',
          );
      });
    }
    return svg(w, h, asymRows.length ? "双侧不对称性" : "关节平衡", out);
  }

  function jumps(values, definitions) {
    values = values || {};
    definitions = definitions || {};
    const items = ["cmj", "sj"].map((key) => {
      const raw = values[key],
        def = definitions[key] || {};
      return {
        label: key.toUpperCase(),
        value: num(
          raw && typeof raw === "object" ? (raw.value ?? raw.height) : raw,
        ),
        target: num(def.target ?? (raw && raw.target)),
        status: def.status || (raw && raw.status),
      };
    });
    if (items.every((item) => item.value === null))
      return empty("CMJ / SJ 等待录入", "录入结果后显示同尺度对比");
    const w = 620,
      h = 330,
      left = 68,
      right = 583,
      top = 42,
      bottom = 254,
      max =
        Math.max(
          10,
          ...items.map((item) => item.value || 0),
          ...items.map((item) => item.target || 0),
        ) * 1.2;
    const y = (value) => bottom - (value / max) * (bottom - top);
    let out = "";
    ticks(0, max).forEach((v) => {
      out +=
        line(left, y(v), right, y(v)) +
        text(left - 11, y(v) + 4, fmt(v), 'text-anchor="end" font-size="11"');
    });
    out +=
      line(left, bottom, right, bottom, `stroke="${C.gray}"`) +
      text(left, top - 14, "高度 / cm");
    items.forEach((item, i) => {
      const cx = 217 + i * 218,
        width = 85;
      if (item.value !== null)
        out += `<g data-tooltip="${esc(item.label + "：" + fmt(item.value) + " cm")}" tabindex="0"><title>${esc(item.label + "：" + fmt(item.value) + " cm")}</title><rect x="${cx - width / 2}" y="${fmt(y(item.value))}" width="${width}" height="${fmt(bottom - y(item.value))}" rx="4" fill="${color(item.status)}" opacity=".84"/>${text(cx, y(item.value) - 12, fmt(item.value), `text-anchor="middle" font-size="18" font-weight="600" fill="${color(item.status)}"`)}</g>`;
      else
        out += text(
          cx,
          bottom - 14,
          "—",
          'text-anchor="middle" font-size="18"',
        );
      if (item.target !== null) {
        const targetY = y(item.target),
          valueY = item.value !== null ? y(item.value) - 12 : null;
        const labelY =
          valueY !== null && Math.abs(targetY + 17 - valueY) < 18
            ? targetY - 10
            : targetY + 17;
        out +=
          line(
            cx - width / 2 - 15,
            targetY,
            cx + width / 2 + 15,
            targetY,
            `stroke="${C.gray}" stroke-dasharray="4 3" stroke-width="2"`,
          ) +
          text(
            cx,
            labelY,
            `目标 ${fmt(item.target)}`,
            'text-anchor="middle" font-size="10"',
          );
      }
      out += text(
        cx,
        bottom + 30,
        item.label,
        `text-anchor="middle" font-size="15" font-weight="600" fill="${C.ink}"`,
      );
    });
    return svg(w, h, "CMJ 与 SJ", out);
  }

  function speed(values, layout = {}) {
    values = values || {};
    const statuses = values.statuses || {},
      rows = [
        { id: "mas", label: values.labels?.mas || "MAS", value: num(values.mas) },
        { id: "mss", label: values.labels?.mss || "MSS", value: num(values.mss) },
        { id: "ift", label: values.labels?.ift || "30-15VIFT", value: num(values.ift) },
      ].filter((row) => row.value !== null && row.value > 0),
      mas = rows.find((row) => row.id === "mas")?.value,
      mss = rows.find((row) => row.id === "mss")?.value,
      asr = mas !== undefined && mss !== undefined && mss >= mas ? mss - mas : null;
    if (!rows.length)
      return empty("速度表现等待录入", "录入 MAS、MSS 或 30-15VIFT 后显示");
    const w = layout.width || 470,
      h = layout.height || 300,
      labelWidth = label => Array.from(label).reduce((sum, c) => sum + (c.charCodeAt(0) > 255 ? 13 : 7), 0),
      left = Math.max(rows.some(row => row.id === "ift") ? 98 : 58,
        Math.min(160, w * .4, Math.max(...rows.map(row => labelWidth(row.label))) + 28)),
      right = w - 64,
      max = Math.max(...rows.map((row) => row.value), 1) * 1.08,
      x = (value) => left + value / max * (right - left),
      firstY = rows.length === 1 ? h / 2 - 10 : asr !== null ? 78 : 42,
      axisY = h - 42,
      step = rows.length > 1 ? (axisY - 30 - firstY) / (rows.length - 1) : 0;
    let out = "";
    ticks(0, max).forEach((value) => {
      out += line(x(value), firstY - 22, x(value), axisY, `stroke="${C.grid}"`) +
        text(x(value), axisY + 22, fmt(value), 'text-anchor="middle" font-size="12"');
    });
    rows.forEach((row, i) => {
      const y = firstY + i * step,
        fill = color(statuses[row.id]),
        tooltip = `${row.label} ${fmt(row.value, 2)} m/s`;
      const labelLines = [""];
      for (const character of Array.from(row.label)) {
        if (labelWidth(labelLines[labelLines.length - 1] + character) > left - 28) labelLines.push("");
        labelLines[labelLines.length - 1] += character;
      }
      const visibleLines = labelLines.slice(0, 3);
      if (labelLines.length > 3) visibleLines[2] = visibleLines[2].slice(0, -1) + "…";
      out += `<g data-speed-metric="${row.id}" class="viz-point" data-tooltip="${esc(tooltip)}" tabindex="0"><title>${esc(tooltip)}</title>` +
        visibleLines.map((label, index) => text(14, y + 5 + (index - (visibleLines.length - 1) / 2) * 15, label, `font-size="13" font-weight="600" fill="${C.ink}"`)).join("") +
        `<rect x="${left}" y="${y - 13}" width="${fmt(x(row.value) - left)}" height="26" rx="4" fill="${fill}" fill-opacity=".8"/>` +
        text(w - 8, y + 5, row.value.toFixed(2), `text-anchor="end" font-size="14" font-weight="600" fill="${C.ink}"`) + '</g>';
    });
    out += line(left, axisY, right, axisY) +
      text(w - 8, axisY + 22, "m/s", 'text-anchor="end" font-size="12"');
    if (asr !== null) {
      const width = x(mss) - x(mas),
        label = `ASR ${asr.toFixed(2)} m/s`,
        inside = width >= Math.max(104, label.length * 7),
        labelX = clamp((x(mas) + x(mss)) / 2, left + 65, right - 65),
        captionY = 24;
      out += `<g data-speed-asr="true"><title>${esc(label + " · MSS − MAS")}</title>`;
      out += text(left, captionY, "ASR＝MSS−MAS", 'font-size="12"');
      if (asr > 0)
        out += `<rect data-asr-extension x="${fmt(x(mas))}" y="${firstY - 13}" width="${fmt(width)}" height="26" fill="${C.neutral}" fill-opacity=".12" stroke="${C.neutral}" stroke-width="1.2" stroke-dasharray="4 3"/>` +
          line(x(mas), firstY - 13, x(mas), firstY + 13, `stroke="${C.neutral}" stroke-width="1.3"`);
      out += text(labelX, inside ? firstY + 4 : firstY - 23, label,
        `data-asr-label data-asr-placement="${inside ? "inside" : "above"}" text-anchor="middle" font-size="12" fill="${C.ink}"`) + '</g>';
    }
    return layoutSVG(w, h, "速度与储备", out,
      "MAS、MSS 与 30-15VIFT 使用同一速度轴；只展示已测项目。MAS柱尾的虚线延伸段为ASR＝MSS−MAS。", layout);
  }

  function calculateFit(points) {
    const n = points.length;
    if (n < 2) return null;
    const meanX = points.reduce((sum, p) => sum + p.load, 0) / n,
      meanY = points.reduce((sum, p) => sum + p.velocity, 0) / n;
    const sxx = points.reduce((sum, p) => sum + (p.load - meanX) ** 2, 0);
    if (sxx <= 0) return null;
    const b =
        points.reduce(
          (sum, p) => sum + (p.load - meanX) * (p.velocity - meanY),
          0,
        ) / sxx,
      a = meanY - b * meanX;
    const sse = points.reduce(
        (sum, p) => sum + (p.velocity - a - b * p.load) ** 2,
        0,
      ),
      sst = points.reduce((sum, p) => sum + (p.velocity - meanY) ** 2, 0);
    return {
      a,
      b,
      n,
      meanX,
      sxx,
      s: n > 2 ? Math.sqrt(sse / (n - 2)) : null,
      r2: sst > 0 ? 1 - sse / sst : null,
      valid: n >= 3 && b < 0 && a > 0,
    };
  }
  function tCritical(df) {
    const values = [
      null,
      12.7062,
      4.3027,
      3.1824,
      2.7764,
      2.5706,
      2.4469,
      2.3646,
      2.306,
      2.2622,
      2.2281,
      2.201,
      2.1788,
      2.1604,
      2.1448,
      2.1314,
      2.1199,
      2.1098,
      2.1009,
      2.093,
      2.08596,
      2.07961,
      2.07387,
      2.06866,
      2.0639,
      2.05954,
      2.05553,
      2.05183,
      2.04841,
      2.04523,
      2.04227,
    ];
    if (df <= 30) return values[Math.max(1, Math.floor(df))];
    const z = 1.95996398454;
    return (
      z +
      (z ** 3 + z) / (4 * df) +
      (5 * z ** 5 + 16 * z ** 3 + 3 * z) / (96 * df ** 2) +
      (3 * z ** 7 + 19 * z ** 5 + 17 * z ** 3 - 15 * z) / (384 * df ** 3)
    );
  }
  function lvp(series, options, layout = {}) {
    options = options || {};
    series = (Array.isArray(series) ? series : [])
      .map((item, index) => {
        const points = (Array.isArray(item.points) ? item.points : [])
          .map((p) => ({ ...p, load: num(p.load), velocity: num(p.velocity) }))
          .filter(
            (p) =>
              p.load !== null &&
              p.velocity !== null &&
              p.load >= 0 &&
              p.velocity >= 0,
          )
          .sort((a, b) => a.load - b.load);
        const own = calculateFit(points),
          supplied = item.fit;
        const fit =
          supplied && num(supplied.a) !== null && num(supplied.b) !== null
            ? { ...(own || {}), ...supplied }
            : own;
        return {
          ...item,
          points,
          fit,
          color:
            item.color ||
            {
              bench: "#365b7a",
              landmineR: "#956a43",
              landmineL: "#786aa8",
              squat: "#365b7a",
              deadlift: "#956a43",
            }[item.id] ||
            SERIES[index % SERIES.length],
          shape: "circle",
        };
      })
      .filter((item) => item.points.length);
    if (!series.length)
      return empty("负荷速度曲线等待录入", "选择动作并录入负荷与速度");
    const showPoints = options.showPoints !== false,
      showBand =
        typeof options.showBand === "boolean"
          ? options.showBand
          : series.length === 1,
      showEstimate = options.showEstimate !== false;
    const w = layout.width || 470,
      h = layout.height || 350,
      legendColumns = w >= 440 ? 2 : 1,
      legendRows = Math.ceil(series.length / legendColumns),
      left = 54,
      right = w - 20,
      top = 44,
      bottom = h - 58 - legendRows * 24;
    const allPoints = series.flatMap((item) => item.points),
      intercepts = series
        .filter((item) => item.fit && item.fit.b < 0 && item.fit.a > 0)
        .map((item) => -item.fit.a / item.fit.b);
    const estimates = series
      .map((item) => num(item.estimate && item.estimate.load))
      .filter((v) => v !== null && v >= 0);
    const xMax =
      Math.max(
        5,
        ...allPoints.map((p) => p.load),
        ...intercepts,
        ...estimates,
      ) * 1.065;
    let yMax =
      Math.max(
        0.4,
        ...allPoints.map((p) => p.velocity),
        ...series.map((item) => (item.fit && item.fit.a > 0 ? item.fit.a : 0)),
      ) * 1.13;
    series.forEach((item) => {
      const fit = item.fit,
        supportMin = item.points[0].load,
        supportMax = item.points[item.points.length - 1].load;
      item.band = [];
      if (
        showBand &&
        fit &&
        num(fit.n) >= 3 &&
        num(fit.sxx) > 0 &&
        num(fit.meanX) !== null &&
        num(fit.s) !== null &&
        fit.s >= 0
      ) {
        const critical = num(fit.tcrit) ?? tCritical(fit.n - 2);
        for (let i = 0; i <= 48; i++) {
          const load = supportMin + ((supportMax - supportMin) * i) / 48,
            center = fit.a + fit.b * load;
          const error =
            critical *
            fit.s *
            Math.sqrt(1 / fit.n + (load - fit.meanX) ** 2 / fit.sxx);
          item.band.push({ load, low: center - error, high: center + error });
        }
        yMax = Math.max(yMax, ...item.band.map((p) => p.high * 1.06));
      }
    });
    const {
      out: grid,
      x,
      y,
    } = axisGrid({
      left,
      right,
      top,
      bottom,
      xMax,
      yMax,
      xLabel: "负荷 / kg",
      yLabel: "速度 / m/s",
      solidGrid: true,
    });
    const clip = `ringside-lvp-clip-${++serial}`;
    let out =
      `<defs><clipPath id="${clip}"><rect x="${left}" y="${top}" width="${right - left}" height="${bottom - top}"/></clipPath></defs>` +
      grid;
    const estimateLabels = [];
    out += `<g clip-path="url(#${clip})">`;
    series.forEach((item) => {
      const fit = item.fit,
        supportMin = item.points[0].load,
        supportMax = item.points[item.points.length - 1].load;
      if (item.band.length)
        out += `<polygon points="${polygonPoints(
          item.band
            .map((p) => [x(p.load), y(p.high)])
            .concat(
              item.band
                .slice()
                .reverse()
                .map((p) => [x(p.load), y(p.low)]),
            ),
        )}" fill="${item.color}" fill-opacity=".11" stroke="none" pointer-events="none"><title>95% 均值响应置信带</title></polygon>`;
      if (fit) {
        const hasIntercept = fit.a > 0 && fit.b < 0,
          end = hasIntercept ? -fit.a / fit.b : supportMax;
        const model = (load) => fit.a + fit.b * load;
        if (hasIntercept)
          out += line(
            x(0),
            y(fit.a),
            x(supportMin),
            y(model(supportMin)),
            `stroke="${item.color}" stroke-width="2" pointer-events="none"`,
          );
        out += line(
          x(supportMin),
          y(model(supportMin)),
          x(supportMax),
          y(model(supportMax)),
          `stroke="${item.color}" stroke-width="2.5" pointer-events="none"`,
        );
        if (hasIntercept)
          out += line(
            x(supportMax),
            y(model(supportMax)),
            x(end),
            y(0),
            `stroke="${item.color}" stroke-width="2" pointer-events="none"`,
          );
        const start = hasIntercept ? 0 : supportMin;
        const tooltip = `${item.label || item.id} · ${item.metric || "速度"}：沿拟合线查看负荷与速度`;
        out += `<path class="lvp-hit" d="M${fmt(x(start))},${fmt(y(model(start)))} L${fmt(x(end))},${fmt(y(model(end)))}" fill="none" stroke="transparent" stroke-width="18" pointer-events="stroke" tabindex="0" data-tooltip="${esc(tooltip)}" data-lvp-series="${esc(item.id || "")}" data-label="${esc(item.label || item.id || "")}" data-metric="${esc(item.metric || "")}" data-a="${fit.a}" data-b="${fit.b}" data-support-min="${supportMin}" data-support-max="${supportMax}" data-domain-min="${start}" data-domain-max="${end}" data-plot-left="${left}" data-plot-right="${right}" data-plot-top="${top}" data-plot-bottom="${bottom}" data-x-max="${xMax}" data-y-max="${yMax}" data-zones="${esc(JSON.stringify(item.zones || []))}" aria-label="${esc(tooltip)}"><title>${esc(tooltip)}</title></path>`;
      }
      if (showPoints)
        item.points.forEach((p) => {
          out += point(
            x(p.load),
            y(p.velocity),
            4.8,
            item.color,
            `${item.label || item.id} · ${fmt(p.load)} kg · ${fmt(p.velocity, 3)} m/s`,
            "",
            item.shape,
          );
        });
      const estimateLoad = num(item.estimate && item.estimate.load),
        mvt = num(item.mvt ?? (item.estimate && item.estimate.mvt));
      if (
        showEstimate &&
        estimateLoad !== null &&
        estimateLoad >= 0 &&
        mvt !== null &&
        mvt >= 0 &&
        item.estimate.valid !== false &&
        fit &&
        fit.valid &&
        fit.b < 0 &&
        fit.a > 0
      ) {
        const label = "预估1RM";
        // Reserve the larger mobile label footprint, and stagger only overlapping labels.
        const labelWidth = label.length * 15,
          placeRight = x(estimateLoad) + 10 + labelWidth < right - 3;
        const labelX = x(estimateLoad) + (placeRight ? 10 : -10),
          baseY = y(mvt) - (placeRight ? 12 : 28);
        const boxAt = (cy) => ({
          left: labelX - (placeRight ? 0 : labelWidth),
          right: labelX + (placeRight ? labelWidth : 0),
          top: cy - 16,
          bottom: cy + 4,
        });
        const labelY =
          [0, -24, 24, -48, 48]
            .map((offset) => baseY + offset)
            .find((cy) => {
              const box = boxAt(cy);
              return (
                box.top >= top + 1 &&
                box.bottom <= bottom - 1 &&
                !estimateLabels.some(
                  (prior) =>
                    box.left < prior.right + 3 &&
                    box.right > prior.left - 3 &&
                    box.top < prior.bottom + 3 &&
                    box.bottom > prior.top - 3,
                )
              );
            }) ?? clamp(baseY, top + 17, bottom - 5);
        estimateLabels.push(boxAt(labelY));
        out += `<g class="viz-point" data-tooltip="${esc(`${item.label || item.id} · ${label} ${fmt(estimateLoad)} kg · MVT ${fmt(mvt, 3)} m/s`)}" tabindex="0"><title>${esc(`${label} ${fmt(estimateLoad)} kg`)}</title>${marker(x(estimateLoad), y(mvt), 6.2, "white", item.shape, `stroke="${item.color}" stroke-width="2.3"`)}${text(labelX, labelY, label, `class="lvp-estimate-label" text-anchor="${placeRight ? "start" : "end"}" font-size="12" fill="${item.color}" pointer-events="none"`)}</g>`;
      }
    });
    out += "</g>";
    series.forEach((item, i) => {
      const xLegend = 16 + (i % legendColumns) * (w / legendColumns),
        yLegend = h - legendRows * 24 + 10 + Math.floor(i / legendColumns) * 24;
      out +=
        marker(xLegend, yLegend - 2, 4, item.color, item.shape) +
        line(
          xLegend + 12,
          yLegend - 2,
          xLegend + 34,
          yLegend - 2,
          `stroke="${item.color}" stroke-width="2"`,
        );
      out += text(
        xLegend + 43,
        yLegend + 2,
        `${item.label || item.id}${item.metric ? " · " + item.metric : ""}`,
        `font-size="12" fill="${item.color}"`,
      );
    });
    return layoutSVG(
      w,
      h,
      options.title || "负荷速度曲线",
      out,
      "坐标从零开始，拟合线延伸至两轴；置信带仅在实测范围显示。",
      layout,
    );
  }
  function lvpHover(hit, event) {
    if (!hit || !hit.ownerSVGElement) return null;
    const svgElement = hit.ownerSVGElement,
      matrix = svgElement.getScreenCTM();
    if (!matrix) return null;
    const d = hit.dataset,
      point = svgElement.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const local = point.matrixTransform(matrix.inverse());
    const left = Number(d.plotLeft),
      right = Number(d.plotRight),
      load = clamp(
        ((local.x - left) / (right - left)) * Number(d.xMax),
        Number(d.domainMin),
        Number(d.domainMax),
      );
    const velocity = Number(d.a) + Number(d.b) * load;
    let zones = [];
    try {
      zones = JSON.parse(d.zones || "[]");
    } catch (_) {
      /* Unconfigured intervals have no zone label. */
    }
    const matches = zones.filter(
      (z) =>
        num(z.min) !== null &&
        num(z.max) !== null &&
        velocity >= Number(z.min) &&
        velocity <= Number(z.max),
    );
    // At a shared boundary, use the upper interval consistently with Calc.classify.
    const selected =
      matches.find((z) => Number(z.min) === velocity) || matches[0];
    return {
      id: d.lvpSeries,
      label: d.label,
      metric: d.metric,
      load,
      velocity,
      zone: selected ? selected.label : "",
      supported: load >= Number(d.supportMin) && load <= Number(d.supportMax),
      screenX: event.clientX,
      screenY: event.clientY,
    };
  }

  function lactate(rows, opts, layout = {}) {
    opts = opts || {};
    rows = (Array.isArray(rows) ? rows : [])
      .map((row) => ({
        ...row,
        speed: num(row.speed),
        lactate: num(row.lactate),
        hr: num(row.hr),
      }))
      .filter(
        (row) =>
          row.speed !== null &&
          row.speed >= 0 &&
          (row.lactate !== null || row.hr !== null),
      )
      .sort((a, b) => a.speed - b.speed);
    if (!rows.length)
      return empty("乳酸与心率等待录入", "逐级记录阶段速度、血乳酸与心率");
    const w = layout.width || 470,
      h = layout.height || 420,
      left = 48,
      right = w - 48,
      top = 64,
      bottom = h - 92;
    const stage = (value) =>
      typeof value === "object" && value !== null
        ? num(value.speed ?? value.velocity ?? value.x)
        : num(value);
    const lt1 = stage(opts.lt1),
      lt2 = stage(opts.lt2),
      speeds = rows.map((row) => row.speed),
      range = Math.max(0.4, Math.max(...speeds) - Math.min(...speeds));
    const xMin = Math.max(0, Math.min(...speeds) - range * 0.12),
      xMax = Math.max(...speeds) + range * 0.12;
    const validLac = rows.filter(
        (row) => row.lactate !== null && row.lactate >= 0,
      ),
      validHr = rows.filter((row) => row.hr !== null && row.hr > 0),
      yMax = Math.max(4, ...validLac.map((row) => row.lactate)) * 1.15;
    const {
      out: grid,
      x,
      y,
    } = axisGrid({
      left,
      right,
      top,
      bottom,
      xMin,
      xMax,
      yMax,
      xLabel: `阶段速度 / ${opts.speedUnit || "m/s"}`,
      yLabel: "乳酸 / mmol/L",
    });
    let out = text(
      18,
      23,
      opts.title || "递增负荷 · 乳酸与心率",
      `font-size="14" font-weight="600" fill="${C.ink}"`,
    );
    if (
      lt1 !== null &&
      lt2 !== null &&
      lt1 < lt2 &&
      lt1 >= xMin &&
      lt2 <= xMax
    ) {
      [
        [left, x(lt1), C.green],
        [x(lt1), x(lt2), C.amber],
        [x(lt2), right, C.red],
      ].forEach(([start, end, fill]) => {
        out += `<rect x="${fmt(start)}" y="${top}" width="${fmt(end - start)}" height="${bottom - top}" fill="${fill}" opacity=".045"/>`;
      });
    }
    out += grid;
    if (opts.showFixedReference !== false)
      [2, 4].forEach((value) => {
        if (value >= yMax) return;
        const label = `${value} mmol/L · 固定浓度参考`;
        out += `<g data-tooltip="${esc(label)}"><title>${esc(label)}</title>${line(left, y(value), right, y(value), `stroke="${C.gray}" stroke-dasharray="6 5"`)}<rect x="${left + 5}" y="${fmt(y(value) - 18)}" width="150" height="15" rx="3" fill="white" fill-opacity=".9"/>${text(left + 9, y(value) - 7, label, 'font-size="11"')}</g>`;
      });
    [
      [lt1, "lt1", opts.lt1Label || "LT1", C.green],
      [lt2, "lt2", opts.lt2Label || "LT2", C.amber],
    ].forEach(([value, key, label, c], i) => {
      if (value === null || value < xMin || value > xMax) return;
      const source = opts[key],
        method =
          source && typeof source === "object" ? source.method : opts.method;
      const tooltip = `${label} ${fmt(value)} ${opts.speedUnit || "m/s"}${method ? " · " + method : ""}`;
      const labelY =
          top +
          6 +
          (i && lt1 !== null && Math.abs(x(lt2) - x(lt1)) < 70 ? 28 : 0),
        labelX = clamp(x(value), left + 27, right - 27);
      out += `<g data-tooltip="${esc(tooltip)}"><title>${esc(tooltip)}</title>${line(x(value), top, x(value), bottom, `stroke="${c}" stroke-width="1.5" stroke-dasharray="5 4"`)}<rect x="${fmt(labelX - 26)}" y="${labelY}" width="52" height="22" rx="11" fill="white" stroke="${c}" stroke-opacity=".5"/>${text(labelX, labelY + 15, label, `text-anchor="middle" font-size="12" font-weight="600" fill="${c}"`)}</g>`;
    });
    if (validLac.length > 1)
      out += `<polyline points="${polygonPoints(validLac.map((row) => [x(row.speed), y(row.lactate)]))}" fill="none" stroke="${C.blue}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;
    validLac.forEach((row) => {
      out += point(
        x(row.speed),
        y(row.lactate),
        4.5,
        C.blue,
        `速度 ${fmt(row.speed)} ${opts.speedUnit || "m/s"} · 乳酸 ${fmt(row.lactate)} mmol/L${row.hr !== null ? " · 心率 " + fmt(row.hr, 0) + " bpm" : ""}`,
      );
    });
    if (validHr.length) {
      const minHr =
          Math.floor((Math.min(...validHr.map((row) => row.hr)) - 10) / 10) *
          10,
        maxHr =
          Math.ceil((Math.max(...validHr.map((row) => row.hr)) + 10) / 10) * 10;
      const yh = (value) =>
        bottom -
        ((value - minHr) / Math.max(20, maxHr - minHr)) * (bottom - top);
      ticks(minHr, maxHr, 4).forEach((value) => {
        out += text(
          right + 11,
          yh(value) + 4,
          fmt(value, 0),
          `font-size="12" fill="${C.red}"`,
        );
      });
      out += text(
        right,
        top - 13,
        "心率 / bpm",
        `text-anchor="end" fill="${C.red}"`,
      );
      if (validHr.length > 1)
        out += `<polyline points="${polygonPoints(validHr.map((row) => [x(row.speed), yh(row.hr)]))}" fill="none" stroke="${C.red}" stroke-width="1.8" stroke-dasharray="5 4"/>`;
      validHr.forEach((row) => {
        out += point(
          x(row.speed),
          yh(row.hr),
          3.3,
          C.red,
          `速度 ${fmt(row.speed)} ${opts.speedUnit || "m/s"} · 心率 ${fmt(row.hr, 0)} bpm`,
        );
      });
    }
    out +=
      circle(64, h - 19, 4, C.blue) +
      text(76, h - 15, "血乳酸", 'font-size="12"');
    if (validHr.length)
      out +=
        line(
          156,
          h - 19,
          180,
          h - 19,
          `stroke="${C.red}" stroke-dasharray="4 3" stroke-width="2"`,
        ) + text(190, h - 15, "心率（右轴）", 'font-size="12"');
    return layoutSVG(
      w,
      h,
      opts.title || "递增负荷测试：乳酸与心率",
      out,
      "横轴为阶段速度；蓝色实线为血乳酸，红色虚线为心率及独立右轴；固定浓度参考线与已录入个体阈值分别显示。",
      layout,
    );
  }

  function forceTime(data, layout = {}) {
    data = data || {};
    const rows = (Array.isArray(data.points) ? data.points : [])
      .map((row) => ({ ...row, timeMs: num(row.timeMs), force: num(row.force) }))
      .filter((row) => row.timeMs !== null && row.timeMs > 0 && row.force !== null && row.force >= 0)
      .sort((a, b) => a.timeMs - b.timeMs);
    const peak = num(data.peakForce), peakTime = num(data.peakTimeMs),
      baseline = num(data.baselineForce), percent = data.yAxis !== "force",
      validPeak = peak !== null && peak > 0, w = layout.width || 470,
      h = layout.height || 368, title = "IMTP 力时曲线",
      percentage = (row) => num(row.percent) !== null ? num(row.percent) : validPeak ? row.force / peak * 100 : null,
      value = (row) => percent ? percentage(row) : row.force,
      peakLabel = validPeak ? `峰值 ${percent ? "100% · " : ""}${fmt(peak, 0)} N` : "",
      complete = rows.length || (validPeak && peakTime !== null && peakTime > 0);
    let out = "";
    if (percent && !validPeak) {
      out += text(w / 2, 102, "缺少有效峰值力", 'text-anchor="middle" font-size="14"') +
        text(w / 2, 129, "无法计算百分比，可切换绝对力 N", 'text-anchor="middle" font-size="12"');
      return layoutSVG(w, 210, title, out, "未以零或缺失峰值计算百分比。", layout);
    }
    if (!complete) {
      if (!validPeak) return empty("等待力与时间数据", "录入指定时间的力，或基线力与对应 RFD", w, 210);
      out += line(28, 92, w - 28, 92, `stroke="${C.neutral}" stroke-dasharray="6 5"`) +
        text(w - 28, 78, peakLabel, `text-anchor="end" font-size="13" fill="${C.ink}"`) +
        text(w / 2, 142, "指定时间的力尚未录入", 'text-anchor="middle" font-size="13"') +
        text(w / 2, 165, "录入时间点后显示力的建立过程", 'text-anchor="middle" font-size="12"');
      return layoutSVG(w, 210, title, out, "仅有峰值力，峰值发生时间未知，未绘制力—时间曲线。", layout);
    }
    const known = [...rows];
    if (baseline !== null && baseline >= 0)
      known.unshift({ timeMs: 0, force: baseline, percent: data.baselinePercent, baseline: true, n: data.n });
    if (validPeak && peakTime !== null && peakTime > 0 && !known.some((row) => row.timeMs === peakTime))
      known.push({ timeMs: peakTime, force: peak, percent: 100, peak: true, n: data.n });
    known.sort((a, b) => a.timeMs - b.timeMs);
    const left = 54, right = w - 20, top = 60, bottom = h - 88,
      xMax = Math.max(...known.map((row) => row.timeMs)) * 1.1,
      yMax = Math.max(percent ? 100 : 1, validPeak ? (percent ? 100 : peak) : 0, ...known.map(value)) * 1.18;
    const { out: grid, x, y } = axisGrid({ left, right, top, bottom, xMax, yMax,
      xLabel: "时间 / ms", yLabel: percent ? "占峰值力 / %" : "力 / N" });
    out += grid;
    if (validPeak) out += line(left, y(percent ? 100 : peak), right, y(percent ? 100 : peak),
      `stroke="${C.neutral}" stroke-dasharray="6 5" stroke-width="1.3"`) +
      text(right, y(percent ? 100 : peak) - 9, peakLabel, `text-anchor="end" font-size="12" fill="${C.ink}"`);
    known.forEach((row, i) => {
      const previous = known[i - 1];
      if (previous) out += line(x(previous.timeMs), y(value(previous)), x(row.timeMs), y(value(row)),
        `stroke="${C.blue}" stroke-width="2"${previous.derived || row.derived ? ' stroke-dasharray="5 4"' : ""}`);
      const source = row.baseline ? "起始基线" : row.peak ? "峰值时间点" : row.derived ? "含 RFD 推算" : "实测",
        counts = num(row.n) !== null ? ` · 有效 ${row.n} 次${num(row.derivedN) > 0 ? "（" + (num(row.measuredN) || 0) + " 实测 / " + row.derivedN + " 推算）" : ""}` : "",
        ratio = validPeak ? ` · ${fmt(percentage(row), 1)}% 峰值` : "";
      out += point(x(row.timeMs), y(value(row)), 4.5, C.blue,
        `${row.timeMs} ms${ratio} · ${fmt(row.force, 1)} N · ${source}${counts}`,
        `data-force-time="${esc(row.timeMs)}" data-force-n="${row.force}" data-force-percent="${validPeak ? percentage(row) : ""}" data-derived="${!!row.derived}"`,
        row.derived ? "diamond" : "circle");
    });
    out += circle(left, h - 16, 4, C.blue) + text(left + 12, h - 12, "实测", 'font-size="12"') +
      marker(left + 77, h - 16, 4, C.blue, "diamond") + text(left + 89, h - 12, "RFD 推算", 'font-size="12"');
    return layoutSVG(w, h, title, out,
      "圆点为实测力，菱形为按已录入起始基线和区间 RFD 推算的力。只连接已知离散时间点，不平滑或补造零点；未知峰值时间仅显示峰值参考线。每次试次先以时点力除以同次峰值力计算百分比，均值模式再平均这些百分比；不改变原始 N 与 N/s。", layout);
  }

  global.RingsideViz = {
    body,
    bodyTooltip,
    radar,
    fms,
    isoRadar,
    jumpBars,
    asymInline,
    iso,
    jumps,
    speed,
    lvp,
    lvpHover,
    lactate,
    forceTime,
    compare,
    empty,
    C,
  };
})(typeof window !== "undefined" ? window : globalThis);
