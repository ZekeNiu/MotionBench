(function (root) {
  "use strict";

  // The export owns a static DOM clone. It never reads or changes App state.
  const MM = 96 / 25.4;
  const PAGE = {
    width: 210,
    height: 297,
    marginX: 12,
    marginY: 13,
    bodyHeight: 254,
    scale: 3,
  };
  const FONT =
    '"Segoe UI", "Microsoft YaHei", "PingFang SC", Arial, sans-serif';
  let lastDiagnostics = null;
  const CSS = `
    .ringside-pdf-stage{position:fixed!important;left:-20000px!important;top:0!important;width:210mm!important;z-index:-100!important;pointer-events:none!important;background:#fff!important;}
    .ringside-pdf-document{--ink:#262a30;--muted:#636b76;--line:#e1e5e9;font:13.333px/1.65 ${FONT}!important;color:#262a30!important;background:#fff!important;box-sizing:border-box!important;overflow-wrap:anywhere!important;}
    .ringside-pdf-document *{box-sizing:border-box;}
    .ringside-pdf-source{width:186mm!important;padding:0!important;margin:0!important;max-width:none!important;display:block!important;}
    .ringside-pdf-source .details-group,.ringside-pdf-source .quality-group,.ringside-pdf-source .test-block,.ringside-pdf-source .lvp-card{padding:0!important;margin:0!important;border:0!important;}
    .ringside-pdf-document h1{font-size:25px!important;font-weight:650!important;line-height:1.4!important;letter-spacing:-.4px!important;margin:0!important;}
    .ringside-pdf-document h2{font-size:21px!important;line-height:1.4!important;font-weight:600!important;}
    .ringside-pdf-document h3{font-size:16px!important;line-height:1.5!important;font-weight:600!important;}
    .ringside-pdf-document h4{font-size:13px!important;line-height:1.5!important;font-weight:650!important;}
    .ringside-pdf-document p{margin:0 0 9px!important;}
    .ringside-pdf-document .hero{display:block!important;margin:0!important;padding:0 0 8px!important;}
    .ringside-pdf-document .hero-sub{display:flex!important;flex-wrap:wrap!important;gap:11px!important;font-size:12px!important;line-height:1.7!important;margin-top:7px!important;}
    .ringside-pdf-document .hero-sub span+span:before{content:'·'!important;margin-right:11px!important;color:#bac2cf!important;}
    .ringside-pdf-document .section-heading{padding:8px 0!important;margin:0!important;border-bottom:1px solid #e1e5e9!important;display:block!important;background:none!important;}
    .ringside-pdf-document .section-title{display:flex!important;align-items:flex-start!important;gap:10px!important;}
    .ringside-pdf-document .section-title>div{min-width:0!important;}
    .ringside-pdf-document .section-number{display:flex!important;align-items:center!important;justify-content:center!important;flex:0 0 28px!important;width:28px!important;height:28px!important;font-size:12px!important;line-height:1!important;color:#365b7a!important;background:#e8eef3!important;border-radius:7px!important;margin-top:2px!important;}
    .ringside-pdf-document .section-heading p,.ringside-pdf-document .test-title p{font-size:12px!important;line-height:1.65!important;margin:4px 0 0!important;color:#636b76!important;}
    .ringside-pdf-document .quality-heading,.ringside-pdf-document .pdf-group-heading{display:block!important;padding:8px 10px!important;margin:0!important;border-left:3px solid #365b7a!important;background:#f3f5f7!important;font-size:17px!important;font-weight:600!important;}
    .ringside-pdf-document .quality-heading p,.ringside-pdf-document .pdf-group-heading span{font-size:12px!important;color:#636b76!important;font-weight:400!important;}
    .ringside-pdf-document .pdf-group-heading span{display:block!important;margin-top:4px!important;}
    .ringside-pdf-document .test-title{display:block!important;padding:4px 0!important;margin:0!important;}
    .ringside-pdf-document .card{background:#fff!important;border:1px solid #e1e5e9!important;box-shadow:none!important;border-radius:8px!important;overflow:visible!important;}
    .ringside-pdf-document .micro-cards{display:flex!important;gap:9px!important;margin:0!important;}
    .ringside-pdf-document .micro-card{border:1px solid #e1e5e9!important;flex:1!important;min-width:0!important;min-height:102px!important;padding:11px!important;border-radius:8px!important;background:#f8f9fb!important;box-shadow:none!important;}
    .ringside-pdf-document .micro-head{display:block!important;margin:0 0 6px!important;}
    .ringside-pdf-document .micro-head h3{font-size:12px!important;}
    .ringside-pdf-document .micro-value{font-size:26px!important;line-height:1.35!important;}
    .ringside-pdf-document .micro-value.text{font-size:14px!important;}
    .ringside-pdf-document .micro-card p,.ringside-pdf-document .micro-card a{font-size:11px!important;line-height:1.65!important;color:#636b76!important;}
    .ringside-pdf-document .athlete-summary .micro-value{font-size:16px!important;line-height:1.4!important;overflow-wrap:anywhere!important;}
    .ringside-pdf-document .athlete-summary dl{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:5px 7px!important;margin:7px 0 0!important;}
    .ringside-pdf-document .athlete-summary dt{font-size:9px!important;color:#636b76!important;line-height:1.4!important;}
    .ringside-pdf-document .athlete-summary dd{font-size:11px!important;line-height:1.45!important;margin:0!important;overflow-wrap:anywhere!important;}
    .ringside-pdf-document .stat-side,.ringside-pdf-document .stat-load{min-height:32px;}
    .ringside-pdf-document .with-repeat-columns td{padding-block:6px!important;}
    .ringside-pdf-document .imtp-results{table-layout:fixed!important;width:100%!important;}
    .ringside-pdf-document .imtp-results .metric-meta{font-size:9px!important;line-height:1.45!important;}
    .ringside-pdf-document .speed-reference-table td{font-size:10px!important;line-height:1.5!important;}
    .ringside-pdf-document .speed-reference-table .speed-goal{margin-bottom:6px!important;}
    .ringside-pdf-document .speed-reference-table .speed-time{white-space:normal!important;}
    .ringside-pdf-document .speed-reference-table .speed-personal>span,.ringside-pdf-document .speed-reference-table .speed-work-rest>span{font-size:9px!important;}
    .ringside-pdf-document .summary-grid{display:flex!important;gap:12px!important;align-items:stretch!important;}
    .ringside-pdf-document .summary-grid>.card{width:calc(50% - 6px)!important;flex:1!important;min-width:0!important;}
    .ringside-pdf-document .card-head{display:block!important;padding:12px 12px 6px!important;}
    .ringside-pdf-document .card-head h3{font-size:14px!important;}
    .ringside-pdf-document .card-head p{font-size:11px!important;line-height:1.6!important;}
    .ringside-pdf-document .screen-layout{display:flex!important;align-items:center!important;gap:6px!important;min-height:0!important;height:auto!important;padding:5px 9px 8px!important;}
    .ringside-pdf-document .body-art{width:53%!important;flex:0 0 53%!important;min-width:0!important;}
    .ringside-pdf-document .body-art svg,.ringside-pdf-document .body-art img{width:100%!important;height:315px!important;max-height:none!important;object-fit:contain!important;}
    .ringside-pdf-document .body-art img{width:auto!important;max-width:100%!important;margin:0 auto!important;}
    .ringside-pdf-document .screen-items{width:47%!important;flex:1!important;padding:0!important;gap:7px!important;}
    .ringside-pdf-document .screen-item{padding:0 0 7px!important;}
    .ringside-pdf-document .screen-item h4{font-size:12px!important;line-height:1.5!important;margin:3px 0!important;}
    .ringside-pdf-document .screen-item p{font-size:11px!important;line-height:1.6!important;margin:0!important;}
    .ringside-pdf-document .performance-layout{display:block!important;min-height:0!important;height:auto!important;padding:5px 9px 8px!important;}
    .ringside-pdf-document .radar svg,.ringside-pdf-document .radar img{width:100%!important;height:auto!important;max-height:none!important;}
    .ringside-pdf-document .aux-metrics{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:10px 14px!important;padding-top:0!important;margin:8px 0 0!important;}
    .ringside-pdf-document .aux-metric{flex:1!important;min-width:0!important;font-size:10px!important;padding-left:6px!important;}
    .ringside-pdf-document .aux-metric strong{font-size:16px!important;}
    .ringside-pdf-document .aux-metric .aux-judgment{font-size:10px!important;line-height:1.65!important;}
    .ringside-pdf-document .aux-metric .aux-data{font-size:9px!important;line-height:1.5!important;margin-top:5px!important;}
    .ringside-pdf-document .card-foot{padding:8px 9px!important;font-size:10px!important;line-height:1.6!important;}
    .ringside-pdf-document .legend{gap:6px!important;font-size:10px!important;}
    .ringside-pdf-document .pill{font-size:11px!important;line-height:1.5!important;padding:2px 5px!important;white-space:normal!important;}
    .ringside-pdf-document .iso-status{max-width:100%!important;white-space:nowrap!important;}
    .ringside-pdf-document .chart-wrap{display:block!important;padding:7px 0!important;margin:0!important;max-width:none!important;min-width:0!important;}
    .ringside-pdf-document svg{max-width:100%!important;max-height:none!important;width:100%!important;height:auto!important;}
    .ringside-pdf-document .chart-wrap>img,.ringside-pdf-document .iso-charts>img{display:block!important;margin:0 auto!important;max-width:100%!important;height:auto!important;}
    .ringside-pdf-document [data-pdf-pair]{display:grid!important;grid-template-columns:minmax(0,44fr) minmax(0,56fr)!important;gap:16px!important;align-items:start!important;}
    .ringside-pdf-document [data-pdf-pair].wide-results{grid-template-columns:minmax(0,1fr)!important;}
    .ringside-pdf-source .fvp-analysis-stack{display:block!important;margin:0!important;}
    .ringside-pdf-source .fvp-analysis-card{padding:0!important;margin:0!important;border:0!important;box-shadow:none!important;container-type:normal!important;}
    .ringside-pdf-document .fvp-analysis-heading{margin:0!important;}
    .ringside-pdf-document .fvp-result-table,.ringside-pdf-document .fvp-scenario-table{width:100%!important;min-width:0!important;font-size:10px!important;table-layout:fixed!important;}
    .ringside-pdf-document .fvp-result-table th,.ringside-pdf-document .fvp-result-table td,.ringside-pdf-document .fvp-scenario-table th,.ringside-pdf-document .fvp-scenario-table td{padding:7px 5px!important;line-height:1.55!important;}
    .ringside-pdf-document .fvp-result-table .fvp-unit{font-size:9px!important;}
    .ringside-pdf-document .fvp-core-judgment{padding-top:8px!important;}
    .ringside-pdf-document .fvp-core-judgment p{font-size:11px!important;margin:0 0 5px!important;}
    .ringside-pdf-document .fvp-core-judgment strong{font-size:19px!important;}
    .ringside-pdf-document .fvp-method,.ringside-pdf-document .fvp-table-note{font-size:10px!important;line-height:1.6!important;}
    .ringside-pdf-document .fvp-load-table,.ringside-pdf-document .fvp-raw-trials table{min-width:0!important;width:100%!important;font-size:10px!important;}
    .ringside-pdf-document .jump-detail table{table-layout:auto!important;}
    .ringside-pdf-document .capability-row{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:14px!important;align-items:stretch!important;}
    .ringside-pdf-document .capability-card{width:100%!important;min-width:0!important;padding:16px!important;border:1px solid #e1e5e9!important;border-radius:10px!important;background:#fff!important;box-shadow:none!important;}
    .ringside-pdf-document .capability-title{font-size:15px!important;margin:0 0 15px!important;line-height:1.5!important;}
    .ringside-pdf-document .capability-metric{margin:0!important;padding:11px 0!important;}
    .ringside-pdf-document .capability-metric:first-child{padding-top:0!important;}
    .ringside-pdf-document .capability-metric:last-child{padding-bottom:0!important;}
    .ringside-pdf-document .capability-metric-head{gap:10px!important;}
    .ringside-pdf-document .capability-metric-head h4{font-size:11px!important;font-weight:500!important;line-height:1.6!important;}
    .ringside-pdf-document .capability-value{font-size:20px!important;line-height:1.35!important;margin:0!important;}
    .ringside-pdf-document .capability-value small{font-size:9px!important;}
    .ringside-pdf-document .capability-judgment{font-size:11px!important;line-height:1.7!important;margin:6px 0 0!important;}
    .ringside-pdf-document .capability-components{font-size:10px!important;margin-top:7px!important;}
    .ringside-pdf-document .capability-components>summary{font-size:10px!important;}
    .ringside-pdf-document .capability-components>summary::after{content:none!important;}
    .ringside-pdf-document .capability-components dd small{font-size:9px!important;}
    .ringside-pdf-document .capability-targets{margin:8px 0 0!important;font-size:10px!important;line-height:1.7!important;}
    .ringside-pdf-document .capability-targets p{margin:3px 0 0!important;}
    .ringside-pdf-document .capability-conclusion-text{margin:0!important;}
    .ringside-pdf-document .capability-conclusion{font-size:12px!important;margin:0 0 14px!important;padding:10px 12px!important;}
    .ringside-pdf-document .capability-progress{font-size:9px!important;margin-top:6px!important;line-height:1.6!important;}
    .ringside-pdf-document .capability-progress-track{height:3px!important;margin-top:4px!important;}
    .ringside-pdf-document .capability-primary .capability-value{font-size:23px!important;}
    .ringside-pdf-document .capability-secondary .capability-value{font-size:17px!important;}
    .ringside-pdf-document .idsi-window{font-size:10px!important;margin-top:7px!important;}
    .ringside-pdf-document .idsi-print-window{display:inline!important;}
    .ringside-pdf-document .hop-summary-table th,.ringside-pdf-document .hop-summary-table td{font-size:10px!important;padding:6px 4px!important;}
    .ringside-pdf-document .hop-summary-table th:first-child{width:7%!important;}
    .ringside-pdf-document .hop-summary-table th:last-child{width:16%!important;}
    .ringside-pdf-document [data-pdf-primary-layout="stacked"]:is(.iso-detail,.imtp-detail){display:block!important;}
    .ringside-pdf-document [data-pdf-primary-layout="stacked"]:is(.iso-detail,.imtp-detail)>.chart-wrap{margin-bottom:12px!important;}
    .ringside-pdf-document .iso-results.with-repeat-columns{table-layout:fixed!important;min-width:0!important;}
    .ringside-pdf-document .iso-results.with-repeat-columns th{width:auto!important;}
    .ringside-pdf-document .iso-results.with-repeat-columns th:nth-child(4){width:auto!important;min-width:0!important;}
    .ringside-pdf-document .iso-results.with-repeat-columns th,.ringside-pdf-document .iso-results.with-repeat-columns td{padding-inline:4px!important;overflow-wrap:normal!important;word-break:normal!important;}
    .ringside-pdf-document .iso-results.with-repeat-columns td:first-child{overflow-wrap:anywhere!important;}
    .ringside-pdf-document .iso-results.with-repeat-columns .repeat-stat-value>span:last-of-type{white-space:normal!important;}
    .ringside-pdf-document .iso-results .iso-reference-evaluation{font-size:9px!important;line-height:1.65!important;}
    .ringside-pdf-document .iso-results .pill{max-width:100%!important;font-size:9px!important;padding:2px 1px!important;}
    .ringside-pdf-document .iso-results .asym-value,.ringside-pdf-document .iso-results .asym-side{max-width:100%!important;white-space:normal!important;overflow-wrap:anywhere!important;}
    .ringside-pdf-document .iso-results .iso-status-value,.ringside-pdf-document .iso-results .iso-status-label{white-space:nowrap!important;overflow-wrap:normal!important;}
    .ringside-pdf-document .iso-results .pill .dot{margin-right:2px!important;}
    .ringside-pdf-document .iso-results .repeat-stat-cv{font-size:9px!important;}
    .ringside-pdf-document .iso-results .repeat-stat-cv>span{white-space:normal!important;overflow-wrap:anywhere!important;}
    .ringside-pdf-document .imtp-results{table-layout:auto!important;min-width:0!important;}
    .ringside-pdf-document .imtp-results th{width:auto!important;}
    .ringside-pdf-document .imtp-results th,.ringside-pdf-document .imtp-results td{padding-inline:3px!important;overflow-wrap:normal!important;word-break:normal!important;}
    .ringside-pdf-document .imtp-results td[data-label="评价"]{min-width:48px!important;}
    .ringside-pdf-document .imtp-results td[data-label="评价"] .pill{white-space:nowrap!important;}
    .ringside-pdf-document [data-pdf-pair]>*{min-width:0!important;}
    .ringside-pdf-document [data-pdf-pair] .chart-wrap{width:100%!important;padding:0!important;}
    .ringside-pdf-document [data-pdf-pair] svg{max-height:340px!important;}
    .ringside-pdf-document [data-pdf-pair] .adaptive-chart svg{max-height:none!important;}
    .ringside-pdf-document .fms-detail table th:nth-child(1){width:25%!important;}
    .ringside-pdf-document .fms-detail table th:nth-child(2){width:18%!important;}
    .ringside-pdf-document .fms-detail table th:nth-child(3){width:15%!important;}
    .ringside-pdf-document .fms-detail table th:nth-child(4){width:24%!important;}
    .ringside-pdf-document .fms-detail table th:nth-child(5){width:18%!important;}
    .ringside-pdf-document .detail-data .subheading{margin:10px 0 5px!important;}
    .ringside-pdf-document .metric-meta{display:block!important;font-size:11px!important;color:#636b76!important;}
    .ringside-pdf-document .comparison-results{display:block!important;}
    .ringside-pdf-document .comparison-result{padding:8px!important;margin-bottom:8px!important;}
    .ringside-pdf-document .comparison-heading{display:flex!important;justify-content:space-between!important;gap:8px!important;font-size:12px!important;}
    .ringside-pdf-document .comparison-note{font-size:12px!important;}
    .ringside-pdf-document .inline-asym{width:100%!important;min-width:0!important;max-width:100%!important;}
    .ringside-pdf-document .inline-asym img{width:100%!important;max-width:100%!important;height:auto!important;}
    .ringside-pdf-document .iso-charts>img+img{margin-top:10px!important;}
    .ringside-pdf-document table{width:100%!important;table-layout:fixed!important;border-collapse:collapse!important;font-size:12px!important;text-align:left!important;margin:0!important;}
    .ringside-pdf-document th,.ringside-pdf-document td{font-size:12px!important;line-height:1.55!important;padding:7px 6px!important;white-space:normal!important;overflow-wrap:anywhere!important;word-break:normal!important;vertical-align:top!important;border-bottom:1px solid #e1e5e9!important;}
    .ringside-pdf-document th{font-weight:600!important;color:#636b76!important;background:#f3f5f7!important;}
    .ringside-pdf-document .table-wrap{overflow:visible!important;max-width:100%!important;}
    .ringside-pdf-document tbody tr,.ringside-pdf-document tbody td,.ringside-pdf-document .selected-result{background:#fff!important;}
    .ringside-pdf-document .stat-row{display:flex!important;gap:8px!important;flex-wrap:wrap!important;margin:0!important;}
    .ringside-pdf-document .stat-chip{font-size:12px!important;padding:5px 8px!important;background:#f8f9fb!important;}
    .ringside-pdf-document .note{font-size:11px!important;line-height:1.75!important;color:#636b76!important;margin:0!important;}
    .ringside-pdf-document .empty{font-size:12px!important;padding:16px!important;}
    .ringside-pdf-document .editor,.ringside-pdf-document .narrative-view,.ringside-pdf-document .narrative{font-size:13.333px!important;line-height:1.85!important;border:0!important;padding:0!important;min-height:0!important;background:#fff!important;}
    .ringside-pdf-document ul,.ringside-pdf-document ol{padding-left:22px!important;margin:0!important;}
    .ringside-pdf-document li{margin:0!important;padding:0!important;line-height:1.8!important;}
    .ringside-pdf-page{width:210mm!important;height:297mm!important;padding:13mm 12mm!important;margin:0!important;position:relative!important;overflow:hidden!important;background:#fff!important;}
    .ringside-pdf-page-head{height:9mm!important;display:flex!important;align-items:flex-start!important;justify-content:space-between!important;gap:12px!important;font-size:11px!important;color:#636b76!important;line-height:1.5!important;border-bottom:1px solid #e1e5e9!important;padding-bottom:5px!important;}
    .ringside-pdf-page-head>span:last-child{max-width:100mm!important;overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important;}
    .ringside-pdf-content{height:254mm!important;padding-top:8px!important;overflow:hidden!important;display:flow-root!important;}
    .ringside-pdf-page-foot{position:absolute!important;left:12mm!important;right:12mm!important;bottom:10mm!important;display:flex!important;justify-content:space-between!important;font-size:10px!important;color:#636b76!important;border-top:1px solid #e1e5e9!important;padding-top:5px!important;line-height:1.5!important;}
    .ringside-pdf-content>.ringside-pdf-block{margin:0 0 12px!important;max-width:100%!important;}
    .ringside-pdf-test-group{display:flow-root!important;max-width:100%!important;}
    .ringside-pdf-test-group>.ringside-pdf-block{margin:0 0 10px!important;max-width:100%!important;}
    .ringside-pdf-test-group>.ringside-pdf-block:last-child{margin-bottom:0!important;}
    .ringside-pdf-content>table.ringside-pdf-block{margin-bottom:12px!important;}
    .ringside-pdf-document a{color:inherit!important;text-decoration:none!important;}
    .ringside-pdf-document [data-pdf-continuation]{border-top:1px dashed #cbd4de!important;}
  `;

  function progress(callback, phase, current, total, percent) {
    if (typeof callback === "function")
      callback({ phase, current, total, percent });
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function cleanClone(reportElement,snapshot) {
    const clone = reportElement.cloneNode(true);
    if(snapshot)root.RingsideReport.prepareFVPPrint?.(clone,snapshot);
    clone.className = "ringside-pdf-document ringside-pdf-source";
    clone.removeAttribute("style");
    clone.removeAttribute("hidden");
    // The live application listens for toggles inside #reportView. Its id
    // must never reach the document on the export clone, or opening cloned
    // details could be mistaken for user edits to the real report.
    clone.removeAttribute("id");
    clone
      .querySelectorAll(
        ".no-print,.sidebar,.app-sidebar,.modal-backdrop,.editor-toolbar,.editor-meta,.selector-bar,.section-nav,.hero-actions,.footer,.btn,.lvp-controls,.multi-select,.ai-menu,button,input,select,textarea,script,iframe,object,embed,template,[data-pdf-ignore]",
      )
      .forEach((node) => node.remove());
    // Empty report sections have no results to paginate. Keep all test blocks
    // and the separate LVP cards, including partial measurements.
    clone.querySelectorAll(".details-group").forEach((node) => {
      if (node.querySelector(".empty") && !node.querySelector(".test-block,.lvp-card,.fvp-analysis-card")) node.remove();
    });
    // Capability parameters alone follow the screen's disclosure state. Flatten
    // open disclosures before row annotation; closed rows never enter the PDF
    // paginator or its expected-row diagnostics.
    clone.querySelectorAll("details[data-capability-parameters]").forEach((node) => {
      if (!node.open) { node.remove(); return; }
      const content = document.createElement("div");
      content.className = "capability-parameters-static";
      content.dataset.capabilityParameters = node.dataset.capabilityParameters;
      [...node.childNodes].filter(child => child.tagName !== "SUMMARY").forEach(child => content.append(child));
      node.replaceWith(content);
    });
    clone.querySelectorAll(".capability-direction-grid").forEach(grid => {
      if (!grid.querySelector(".capability-parameters-static")) {
        grid.dataset.pdfAtomic = "";
        return;
      }
      grid.classList.add("capability-direction-grid-expanded-pdf");
      for (const card of grid.querySelectorAll(":scope > .capability-direction-card")) {
        const summary = document.createElement("div");
        summary.className = "capability-direction-print-summary";
        summary.dataset.pdfAtomic = "";
        [...card.children].filter(child => !child.matches(".capability-parameters-static")).forEach(child => summary.append(child));
        card.prepend(summary);
      }
    });
    const rawTrials = [...clone.querySelectorAll("[data-raw-trials]")];
    if (rawTrials.length) {
      const appendix = document.createElement("section");
      appendix.className = "repeat-appendix";
      const heading = document.createElement("div");
      heading.className = "section-heading";
      const title = document.createElement("h2");
      title.textContent = "附录 · 原始试次";
      heading.append(title); appendix.append(heading);
      rawTrials.forEach((node) => {
        const group = document.createElement("div");
        group.className = "pdf-group-heading";
        const title = document.createElement("h3");
        title.textContent = node.dataset.trialTitle;
        group.append(title); appendix.append(group);
        node.querySelector(":scope > summary")?.remove();
        appendix.append(node);
      });
      clone.append(appendix);
    }
    clone.querySelectorAll("details").forEach((node) => {
      node.open = true;
    });
    clone.querySelectorAll('a[href^="#"]').forEach((node) => {
      if (/^(查看|编辑)/.test(node.textContent.trim())) node.remove();
      else {
        node.removeAttribute("href");
        node.textContent = node.textContent.replace(/\s*[↗↘⌄]\s*$/, "");
      }
    });
    [clone, ...clone.querySelectorAll("*")].forEach((node) => {
      node.removeAttribute("contenteditable");
      node.removeAttribute("tabindex");
      node.removeAttribute("autofocus");
      for (const attr of [...node.attributes])
        if (/^on/i.test(attr.name)) node.removeAttribute(attr.name);
    });
    clone.querySelectorAll("img,image").forEach((node) => {
      const url =
        node.getAttribute("src") ||
        node.getAttribute("href") ||
        node.getAttribute("xlink:href") ||
        "";
      if (url && !/^(data:|blob:)/i.test(url))
        throw new Error("PDF 中包含未内嵌图片，请先将图片保存到报告中。");
    });
    return clone;
  }

  function backgroundFields(snapshot) {
    const athlete = snapshot.athlete || {};
    return [
      ["sport", "专项", athlete.sport],
      ["dominantHand", "惯用手", athlete.dominantHand],
    ]
      .filter(
        ([, , value]) =>
          value != null && String(value).trim() && value !== "未注明",
      )
      .map(([key, label, value]) => ({
        key,
        text: label + "：" + String(value).trim(),
      }));
  }

  function syncBackground(source, snapshot) {
    const metadata = source.querySelector(".hero-sub");
    if (!metadata) return;
    for (const field of backgroundFields(snapshot)) {
      const existing =
        metadata.querySelector('[data-athlete-field="' + field.key + '"]') ||
        [...metadata.querySelectorAll("span")].find(
          (node) => node.textContent.trim() === field.text,
        );
      const node = existing || element("span");
      node.dataset.athleteField = field.key;
      node.textContent = field.text;
      if (!existing) metadata.append(node);
    }
  }

  async function readyImages(container) {
    await Promise.all(
      [...container.querySelectorAll("img")].map(async (image) => {
        if (typeof image.decode === "function") await image.decode();
        else if (!image.complete)
          await new Promise((resolve, reject) => {
            image.onload = resolve;
            image.onerror = () => reject(new Error("报告图片加载失败。"));
          });
        if (!image.naturalWidth) throw new Error("报告图片无法解码。");
      }),
    );
  }

  async function freezeCharts(source) {
    const charts = [...source.querySelectorAll("svg")];
    for (let index = 0; index < charts.length; index++) {
      const original = charts[index];
      const rect = original.getBoundingClientRect();
      const svg = original.cloneNode(true);
      // A serialized SVG has its own viewport. Its screen media query must not
      // unexpectedly select the mobile typography when loaded as an image.
      svg.querySelectorAll("style").forEach((node) => node.remove());
      const viewBox = original.viewBox && original.viewBox.baseVal;
      const naturalWidth = (viewBox && viewBox.width) || rect.width || 620;
      const naturalHeight = (viewBox && viewBox.height) || rect.height || 300;
      const inSummary = !!original.closest(".summary-grid"), adaptive = original.hasAttribute("data-pixel-layout");
      const printWidth = inSummary || adaptive
        ? rect.width || naturalWidth
        : Math.min(
            rect.width || naturalWidth,
            (340 * naturalWidth) / naturalHeight,
          );
      svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      svg.setAttribute("width", naturalWidth);
      svg.setAttribute("height", naturalHeight);
      svg.removeAttribute("style");
      const originalTexts = [...original.querySelectorAll("text")];
      [...svg.querySelectorAll("text")].forEach((node, index) => {
        const computed = root.getComputedStyle(originalTexts[index]);
        node.style.fontFamily = FONT;
        const fontSize = parseFloat(
          node.getAttribute("font-size") || computed.fontSize,
        );
        node.style.fontSize =
          (inSummary || adaptive
            ? fontSize
            : Math.max(fontSize, (10 * naturalWidth) / printWidth)) + "px";
        node.style.fontWeight =
          node.getAttribute("font-weight") || computed.fontWeight;
      });
      const image = new Image();
      image.src =
        "data:image/svg+xml;charset=utf-8," +
        encodeURIComponent(new XMLSerializer().serializeToString(svg));
      try {
        await image.decode();
      } catch (_) {
        throw new Error("报告图表无法转换为 PDF 图片。");
      }
      // Freeze at the actual print-column width. Pagination preserves the pair.
      const width = Math.max(1, printWidth);
      const height = Math.max(
        1,
        inSummary
          ? rect.height || (width * naturalHeight) / naturalWidth
          : (width * naturalHeight) / naturalWidth,
      );
      const reduction = Math.min(
        1,
        ((PAGE.width - 2 * PAGE.marginX) * MM) / width,
        (PAGE.bodyHeight * MM - 30) / height,
      );
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(width * reduction * PAGE.scale));
      canvas.height = Math.max(1, Math.round(height * reduction * PAGE.scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("浏览器无法创建 PDF 图表画布。");
      const fit = Math.min(
        canvas.width / naturalWidth,
        canvas.height / naturalHeight,
      );
      const drawnWidth = naturalWidth * fit,
        drawnHeight = naturalHeight * fit;
      context.drawImage(
        image,
        (canvas.width - drawnWidth) / 2,
        (canvas.height - drawnHeight) / 2,
        drawnWidth,
        drawnHeight,
      );
      const output = element("img");
      output.src = canvas.toDataURL("image/png");
      output.alt = original.querySelector("title")?.textContent || "测试图表";
      output.dataset.pdfChart = "true";
      output.dataset.pdfChartIndex = String(index);
      output.width = Math.round(width * reduction);
      output.height = Math.round(height * reduction);
      output.style.width = width * reduction + "px";
      output.style.height = height * reduction + "px";
      output.style.display = "block";
      output.style.margin = "0 auto";
      original.replaceWith(output);
      canvas.width = canvas.height = 1;
    }
    await readyImages(source);
    // DOM ids would duplicate the live report. SVG references no longer need
    // their ids now that the charts have been frozen into local image data.
    [source, ...source.querySelectorAll("[id]")].forEach((node) =>
      node.removeAttribute("id"),
    );
  }

  // Decide one layout for each complete primary test on a fresh print page.
  // Raw trials have already moved to the appendix; the live report is untouched.
  function layoutPrimaryPairs(source, stage) {
    const layouts = [];
    const leading = [];
    let pending = [];
    for (const block of collectBlocks(source)) {
      if (block.keepWithNext) pending.push(block.element);
      else {
        if (block.element.matches(".iso-detail,.imtp-detail"))
          leading.push(pending.filter(node => !node.matches(".test-title")));
        pending = [];
      }
    }
    const page = element("div", "ringside-pdf-document ringside-pdf-page");
    const body = element("div", "ringside-pdf-content");
    page.append(body);
    stage.append(page);
    try {
      const capacity = body.getBoundingClientRect().height -
        parseFloat(root.getComputedStyle(body).paddingTop) - 2;
      for (const pair of source.querySelectorAll(".iso-detail[data-pdf-pair],.imtp-detail[data-pdf-pair]")) {
        // Section headings that have not yet accompanied any content must fit
        // on this page too, just as makePaginator's pending headings do.
        const headings = leading[layouts.length] || [];
        headings.forEach(node => body.append(node.cloneNode(true)));
        const probe = element("div", "ringside-pdf-test-group");
        const test = pair.closest(".test-block");
        collectBlocks(test).forEach(block => probe.append(block.element));
        body.append(probe);
        root.RingsideReport.layoutCharts(probe, { print: true });
        const mainHeight = probe.getBoundingClientRect().height;
        const height = probe.getBoundingClientRect().bottom - body.firstElementChild.getBoundingClientRect().top;
        const mode = height <= capacity ? "side-by-side" : "stacked";
        const testId = pair.matches(".iso-detail") ? "iso" : "imtp";
        for (const node of [pair, pair.querySelector(".chart-wrap"), pair.querySelector(".iso-results,.imtp-results")].filter(Boolean)) {
          node.dataset.pdfPrimaryLayout = mode;
          node.dataset[testId === "iso" ? "pdfIsoLayout" : "pdfImtpLayout"] = mode;
        }
        // A long result uses independent chart/table blocks and normal table
        // continuation, rather than the side-by-side pair's split-column path.
        if (mode === "stacked") pair.removeAttribute("data-pdf-pair");
        layouts.push({ testId, mode, sideBySideHeight: height, mainHeight, leadingHeadings: headings.length, capacity });
        body.replaceChildren();
      }
    } finally {
      page.remove();
    }
    return layouts;
  }

  function freezePrimaryColumns(source) {
    for (const table of source.querySelectorAll(".iso-results.with-repeat-columns,.imtp-results,.fvp-result-table,.fvp-scenario-table,.fvp-load-table,.capability-parameter-table")) {
      const widths = [...table.tHead.rows[0].cells].map(cell => cell.getBoundingClientRect().width);
      const columns = element("colgroup");
      widths.forEach(width => {
        const col = element("col");
        col.style.width = width + "px";
        columns.append(col);
      });
      table.querySelectorAll(":scope > colgroup").forEach(group => group.remove());
      table.prepend(columns);
      // Preserve the content-driven widths on every continuation page. Otherwise
      // each page's subset of rows would size its columns independently.
      table.style.setProperty("table-layout", "fixed", "important");
    }
  }

  function collectBlocks(source) {
    const blocks = [];
    const headingSelectors =
      ".section-heading,.quality-heading,.test-title,.pdf-group-heading,.capability-parameter-heading";
    const atomicSelectors =
      ".hero,.micro-cards,.summary-grid,.stat-row,.empty,.aux-metrics,.card-foot,[data-pdf-atomic]";
    function push(node, kind, keepWithNext) {
      if (
        !node.textContent.trim() &&
        !node.querySelector("img") &&
        node.tagName !== "IMG"
      )
        return;
      const copy = node.cloneNode(true);
      const narrative = !!node.closest('#interpretation,[data-pdf-narrative-section]');
      if (narrative) copy.dataset.pdfNarrative = "true";
      copy.classList.add("ringside-pdf-block");
      copy.dataset.pdfBlockIndex = String(blocks.length);
      if (kind === "pair")
        copy.dataset.pdfTitle =
          node.dataset.pdfTitle || node.closest(".test-block,.lvp-card,.fvp-analysis-card")?.querySelector("h3")
            ?.textContent || "测试结果";
      blocks.push({
        element: copy,
        kind,
        keepWithNext: !!keepWithNext,
        startsNarrative: narrative && node.matches(".section-heading"),
        group:
          node.closest(".test-block,.lvp-card,.fvp-analysis-card")?.dataset.pdfTestGroup ?? null,
      });
    }
    function walk(node) {
      if (node.nodeType !== 1) {
        if (node.nodeType === 3 && node.textContent.trim())
          push(element("p", "", node.textContent), "text");
        return;
      }
      if (node.hidden || node.classList.contains("hidden")) return;
      if (node.matches(headingSelectors) || /^H[1-6]$/.test(node.tagName))
        return push(node, "text", true);
      if (node.tagName === "SUMMARY") {
        const heading = element("div", "pdf-group-heading");
        heading.innerHTML = node.innerHTML;
        if (node.dataset.pdfPairText !== undefined)
          heading.dataset.pdfPairText = node.dataset.pdfPairText;
        return push(heading, "text", true);
      }
      if (node.matches(atomicSelectors)) return push(node, "atomic");
      if (node.matches("[data-pdf-pair]")) return push(node, "pair");
      if (node.tagName === "TABLE") return push(node, "table");
      if (node.matches(".chart-wrap,.iso-charts")) {
        const images = [...node.querySelectorAll("img[data-pdf-chart]")];
        if (images.length > 1) {
          [...node.childNodes].forEach((child) => {
            if (child.nodeType === 1 && child.matches("img[data-pdf-chart]")) {
              const wrapper = element("div", "chart-wrap");
              wrapper.append(child.cloneNode(true));
              push(wrapper, "atomic");
            } else walk(child);
          });
        } else push(node, "atomic");
        return;
      }
      if (node.tagName === "IMG") return push(node, "atomic");
      if (node.tagName === "P" || node.tagName === "BLOCKQUOTE")
        return push(node, "text");
      if (node.tagName === "UL" || node.tagName === "OL") {
        let number = Number(node.getAttribute("start")) || 1;
        [...node.children].forEach((child) => {
          if (child.tagName !== "LI") return;
          const list = node.cloneNode(false);
          if (node.tagName === "OL") list.setAttribute("start", number++);
          list.append(child.cloneNode(true));
          push(list, "text");
        });
        return;
      }
      const children = [...node.childNodes];
      if (!children.some((child) => child.nodeType === 1))
        return push(node, "text");
      // Inline formatting belongs to one block; structural wrappers are
      // traversed so table rows and long narrative paragraphs can paginate.
      if (
        [...node.children].every((child) =>
          /^(SPAN|STRONG|EM|B|I|A|SMALL|BR)$/.test(child.tagName),
        )
      )
        return push(node, "text");
      children.forEach(walk);
    }
    [...source.childNodes].forEach(walk);
    return blocks;
  }

  function annotateRows(source) {
    const rows = [];
    [...source.querySelectorAll("table")].forEach((table, tableIndex) => {
      table.dataset.pdfTableIndex = String(tableIndex);
      let bodyRows = [...table.querySelectorAll("tbody>tr")];
      if (!bodyRows.length)
        bodyRows = [...table.children].filter(
          (child) => child.tagName === "TR",
        );
      bodyRows.forEach((row, rowIndex) => {
        row.dataset.pdfRowIndex = tableIndex + ":" + rowIndex;
        rows.push({
          key: row.dataset.pdfRowIndex,
          tableIndex,
          rowIndex,
          cells: [...row.cells].map((cell) => cell.textContent),
        });
      });
    });
    return rows;
  }

  function diagnose(
    blocks,
    pages,
    rows,
    snapshot,
    sourceChartCount,
    pairTexts = [],
  ) {
    const renderedRows = new Map(),
      renderedCharts = new Map(),
      textParts = new Map();
    const pageManifest = pages.map((page, index) => {
      const body = page.querySelector(".ringside-pdf-content");
      const rowKeys = [...body.querySelectorAll("[data-pdf-row-index]")].map(
        (row) => {
          const key = row.dataset.pdfRowIndex;
          const entries = renderedRows.get(key) || [];
          entries.push({
            page: index + 1,
            cells: [...row.cells].map((cell) => cell.textContent),
          });
          renderedRows.set(key, entries);
          return key;
        },
      );
      const chartIndices = [
        ...body.querySelectorAll("img[data-pdf-chart-index]"),
      ].map((image) => {
        const chartIndex = Number(image.dataset.pdfChartIndex);
        renderedCharts.set(
          chartIndex,
          (renderedCharts.get(chartIndex) || 0) + 1,
        );
        return chartIndex;
      });
      [...body.querySelectorAll("[data-pdf-block-index]")].forEach((node) => {
        const blockIndex = Number(node.dataset.pdfBlockIndex);
        textParts.set(
          blockIndex,
          (textParts.get(blockIndex) || "") + node.textContent,
        );
      });
      return {
        page: index + 1,
        rows: rowKeys,
        charts: chartIndices,
        tableIndices: [...body.querySelectorAll("[data-pdf-table-index]")].map(
          (table) => Number(table.dataset.pdfTableIndex),
        ),
      };
    });
    const missingRows = rows
      .filter((row) => !renderedRows.has(row.key))
      .map((row) => row.key);
    const duplicateRows = [...renderedRows]
      .filter(([, values]) => values.length !== 1)
      .map(([key]) => key);
    const changedRows = rows
      .filter(
        (row) =>
          renderedRows.has(row.key) &&
          JSON.stringify(renderedRows.get(row.key)[0].cells) !==
            JSON.stringify(row.cells),
      )
      .map((row) => row.key);
    const textChecks = blocks
      .filter((block) => block.kind === "text")
      .map((block) => ({
        block: Number(block.element.dataset.pdfBlockIndex),
        sourceCharacters: block.element.textContent.length,
        renderedCharacters: (
          textParts.get(Number(block.element.dataset.pdfBlockIndex)) || ""
        ).length,
        keepWithNext: block.keepWithNext,
        exact:
          block.element.textContent ===
          (textParts.get(Number(block.element.dataset.pdfBlockIndex)) || ""),
      }));
    for (const [index, text] of pairTexts.entries()) {
      const rendered = pages
        .flatMap((page) => [
          ...page.querySelectorAll('[data-pdf-pair-text="' + index + '"]'),
        ])
        .map((node) => node.textContent)
        .join("");
      textChecks.push({
        block: "pair:" + index,
        sourceCharacters: text.length,
        renderedCharacters: rendered.length,
        keepWithNext: false,
        exact: text === rendered,
      });
    }
    // This manifest is diagnostic data, never reader-facing report content.
    return {
      status: "prepared",
      recordId: snapshot.recordId || "",
      pageCount: pages.length,
      sourceRows: rows,
      pages: pageManifest,
      rowCount: rows.length,
      renderedRowCount: renderedRows.size,
      missingRows,
      duplicateRows,
      changedRows,
      textChecks,
      sourceChartCount,
      chartCount: renderedCharts.size,
      missingCharts: Array.from(
        { length: sourceChartCount },
        (_, index) => index,
      ).filter((index) => !renderedCharts.has(index)),
      duplicateCharts: [...renderedCharts]
        .filter(([, count]) => count !== 1)
        .map(([index]) => index),
    };
  }

  function textPart(node, start, end) {
    const result = node.cloneNode(false);
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    const texts = [];
    let current;
    while ((current = walker.nextNode())) texts.push(current);
    if (!texts.length) return result;
    function boundary(offset) {
      let rest = offset;
      for (const text of texts) {
        if (rest <= text.length) return { node: text, offset: rest };
        rest -= text.length;
      }
      return {
        node: texts[texts.length - 1],
        offset: texts[texts.length - 1].length,
      };
    }
    const range = document.createRange();
    const first = boundary(start),
      last = boundary(end);
    range.setStart(first.node, first.offset);
    range.setEnd(last.node, last.offset);
    result.append(range.cloneContents());
    return result;
  }

  function makePaginator(stage, snapshot) {
    const pages = [];
    const headings = [];
    let content;
    function newPage() {
      const page = element("div", "ringside-pdf-document ringside-pdf-page");
      const header = element("div", "ringside-pdf-page-head");
      header.append(
        element("span", "", "MotionBench · 运动表现评估"),
        element(
          "span",
          "",
          [snapshot.athlete?.name, snapshot.athlete?.date]
            .filter(Boolean)
            .join(" · "),
        ),
      );
      content = element("div", "ringside-pdf-content");
      const footer = element("div", "ringside-pdf-page-foot");
      footer.append(
        element("span", "", "运动表现与损伤风险筛查报告"),
        element("span", "ringside-pdf-page-number"),
      );
      page.append(header, content, footer);
      stage.append(page);
      pages.push(page);
      return content;
    }
    function fits() {
      const rect = content.getBoundingClientRect();
      const last = content.lastElementChild;
      return !last || last.getBoundingClientRect().bottom <= rect.bottom - 2;
    }
    function appendHeadings() {
      const copies = headings.map((node) => node.cloneNode(true));
      copies.forEach((node) => content.append(node));
      return copies;
    }
    function moveIfNeeded(node, pendingHeadings) {
      const prior = content.childElementCount;
      const attached = pendingHeadings ? appendHeadings() : [];
      content.append(node);
      if (fits()) {
        if (pendingHeadings) headings.length = 0;
        return true;
      }
      node.remove();
      attached.forEach((heading) => heading.remove());
      if (prior) {
        newPage();
        const moved = pendingHeadings ? appendHeadings() : [];
        content.append(node);
        if (fits()) {
          if (pendingHeadings) headings.length = 0;
          return true;
        }
        node.remove();
        moved.forEach((heading) => heading.remove());
      }
      return false;
    }
    function binaryPrefix(node) {
      const length = node.textContent.length;
      let low = 0,
        high = length;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        const candidate = textPart(node, 0, middle);
        content.append(candidate);
        const ok = fits();
        candidate.remove();
        if (ok) low = middle;
        else high = middle - 1;
      }
      let end = low;
      // Keep a Unicode surrogate pair together. Prefer a nearby punctuation
      // boundary when it does not leave most of a line unused.
      const text = node.textContent;
      if (end > 0 && end < length && /[\uDC00-\uDFFF]/.test(text[end])) end--;
      const tail = text.slice(Math.max(0, end - 60), end);
      const positions = [...tail.matchAll(/[。！？；，、\s]/g)];
      if (positions.length) {
        const boundary =
          Math.max(0, end - 60) + positions[positions.length - 1].index + 1;
        if (boundary > end * 0.85) end = boundary;
      }
      return end;
    }
    function placeText(node) {
      if (moveIfNeeded(node, true)) return;
      appendHeadings();
      headings.length = 0;
      let remainder = node;
      while (remainder.textContent.length) {
        const end = binaryPrefix(remainder);
        if (!end) throw new Error("PDF 中有无法分页的正文块，请检查正文格式。");
        const prefix = textPart(remainder, 0, end);
        content.append(prefix);
        if (end === remainder.textContent.length) break;
        remainder = textPart(remainder, end, remainder.textContent.length);
        remainder.dataset.pdfContinuation = "true";
        newPage();
      }
    }
    function tableFragment(table) {
      const copy = table.cloneNode(false);
      [...table.children]
        .filter((child) => !/^(TBODY|TFOOT|TR)$/.test(child.tagName))
        .forEach((child) => copy.append(child.cloneNode(true)));
      copy.append(document.createElement("tbody"));
      return copy;
    }
    function placeTable(table) {
      const rows = [...table.querySelectorAll("tbody>tr")];
      if (!rows.length)
        rows.push(
          ...[...table.children].filter((child) => child.tagName === "TR"),
        );
      if (!rows.length) return placeAtomic(table);
      // Clinical result tables are usually short. Moving a complete short
      // table is preferable to leaving its last single result on a new page.
      if (table.dataset.pdfIsoLayout !== "stacked" && rows.length <= 12 && moveIfNeeded(table, true)) return;
      let fragment = tableFragment(table);
      fragment.tBodies[0].append(rows[0].cloneNode(true));
      if (!moveIfNeeded(fragment, true))
        throw new Error(
          "PDF 表格有单行超过一页，无法完整导出。请缩短该行的长文本。",
        );
      for (const row of rows.slice(1)) {
        const copy = row.cloneNode(true);
        fragment.tBodies[0].append(copy);
        if (fits()) continue;
        copy.remove();
        newPage();
        fragment = tableFragment(table);
        fragment.tBodies[0].append(copy);
        content.append(fragment);
        if (!fits())
          throw new Error(
            "PDF 表格有单行超过一页，无法完整导出。请缩短该行的长文本。",
          );
      }
      for (const foot of [...table.children].filter(
        (child) => child.tagName === "TFOOT",
      )) {
        const copy = foot.cloneNode(true);
        fragment.append(copy);
        if (!fits()) {
          copy.remove();
          newPage();
          const last = tableFragment(table);
          last.append(copy);
          content.append(last);
          if (!fits())
            throw new Error("PDF 表格的汇总行超过一页，无法完整导出。");
        }
      }
    }
    function placePair(node) {
      // Keep normal pairs intact; split only the data column of an oversized pair.
      content.append(node);
      const tall =
        node.getBoundingClientRect().height >
        content.getBoundingClientRect().height - 12;
      node.remove();
      if (!tall && moveIfNeeded(node, true)) return;
      const data = node.lastElementChild,
        blocks = collectBlocks(data);
      // Local child indices must never collide with global report text indices.
      blocks.forEach((block) =>
        block.element.removeAttribute("data-pdf-block-index"),
      );
      const first = node.cloneNode(false),
        figure = node.firstElementChild.cloneNode(true);
      const column = data.cloneNode(false);
      first.append(figure, column);
      if (!moveIfNeeded(first, true)) throw new Error("PDF 图表无法放入页面。");
      const remainder = [];
      let full = false;
      for (const block of blocks) {
        if (full) {
          remainder.push(block);
          continue;
        }
        if (block.kind !== "table") {
          column.append(block.element);
          if (!fits()) {
            block.element.remove();
            full = true;
            remainder.push(block);
          }
          continue;
        }
        const rows = [...block.element.querySelectorAll("tbody>tr")];
        if (!rows.length) continue;
        const fragment = tableFragment(block.element);
        column.append(fragment);
        let count = 0;
        for (const row of rows) {
          const copy = row.cloneNode(true);
          fragment.tBodies[0].append(copy);
          if (!fits()) {
            copy.remove();
            break;
          }
          count++;
        }
        if (!count) fragment.remove();
        if (count < rows.length) {
          const rest = tableFragment(block.element);
          rows
            .slice(count)
            .forEach((row) => rest.tBodies[0].append(row.cloneNode(true)));
          remainder.push({ ...block, element: rest });
          full = true;
        }
      }
      if (remainder.length) {
        // A subheading without its first data row belongs to the continuation.
        const trailing = column.lastElementChild;
        if (trailing?.matches("h1,h2,h3,h4,h5,.pdf-group-heading,.capability-parameter-heading")) {
          trailing.remove();
          remainder.unshift({
            element: trailing,
            kind: "text",
            keepWithNext: true,
          });
        }
        newPage();
        headings.push(
          element(
            "h4",
            "pdf-group-heading",
            (node.dataset.pdfTitle || "测试结果") + " · 数据续表",
          ),
        );
        if (node.matches(".jump-detail")) {
          const continuation=node.cloneNode(false), blankFigure=node.firstElementChild.cloneNode(false), continuationData=data.cloneNode(false);
          blankFigure.removeAttribute("data-chart-kind");blankFigure.removeAttribute("data-chart-input");
          remainder.forEach(block=>continuationData.append(block.element));
          continuation.append(blankFigure,continuationData);
          placePair(continuation);
        } else remainder.forEach(addBlock);
      }
    }
    function placeAtomic(node) {
      const splittable =
        node.matches(".summary-grid,.micro-cards,.capability-row,.capability-card") ||
        (node.matches(".card") && node.querySelector(".ability-comparison"));
      let tooTall = false;
      if (splittable) {
        // Measure before trying a new page; an oversized summary must split on
        // the current page rather than abandoning otherwise usable space.
        content.append(node);
        tooTall =
          node.getBoundingClientRect().height >
          content.getBoundingClientRect().height -
            parseFloat(root.getComputedStyle(content).paddingTop) -
            2;
        node.remove();
      }
      if (!tooTall && moveIfNeeded(node, true)) return;
      if (node.matches(".summary-grid,.micro-cards,.capability-row")) {
        [...node.children].forEach((child) => {
          child.style.removeProperty("width");
          child.classList.add("ringside-pdf-block");
          child.dataset.pdfBlockIndex = node.dataset.pdfBlockIndex;
          placeAtomic(child);
        });
        return;
      }
      if (node.matches(".capability-card")) {
        const metrics=[...node.querySelectorAll(":scope>.capability-metrics>.capability-metric")];
        const title=node.querySelector(":scope>.capability-title");
        const conclusion=node.querySelector(":scope>.capability-conclusion");
        // Preserve full metric rows and their judgments when a populated card
        // exceeds one page. Repeated titles identify each continuation.
        const chunks=[...(conclusion?[conclusion]:[]),...metrics];
        let fragment=null;
        for(const chunk of chunks){
          if(!fragment){
            fragment=node.cloneNode(false);
            if(title)fragment.append(title.cloneNode(true));
            fragment.append(chunk.cloneNode(true));
            if(!moveIfNeeded(fragment,true))throw new Error("PDF 中单项能力分析超过一页，无法完整导出。");
            continue;
          }
          const copy=chunk.cloneNode(true);
          fragment.append(copy);
          if(fits())continue;
          copy.remove();
          if(fragment.children.length<=(title?1:0)){fragment.remove();throw new Error("PDF 中单项能力分析超过一页，无法完整导出。");}
          newPage();
          fragment=node.cloneNode(false);
          fragment.dataset.pdfContinuation="true";
          if(title)fragment.append(title.cloneNode(true));
          fragment.append(copy);content.append(fragment);
          if(!fits())throw new Error("PDF 中单项能力分析超过一页，无法完整导出。");
        }
        return;
      }
      if (node.matches(".card") && node.querySelector(".ability-comparison")) {
        // Large capability sets remain real tables, including repeated headers.
        // The neighboring screening card can still stay together on its page.
        for (const block of collectBlocks(node)) {
          block.element.dataset.pdfBlockIndex = node.dataset.pdfBlockIndex;
          addBlock(block);
        }
        return;
      }
      const images = [...node.querySelectorAll("img")];
      if (node.tagName === "IMG") images.push(node);
      if (images.length === 1) {
        const image = images[0];
        const available =
          PAGE.bodyHeight * MM -
          headings.reduce((sum, heading) => {
            content.append(heading);
            const height = heading.getBoundingClientRect().height + 12;
            heading.remove();
            return sum + height;
          }, 0) -
          32;
        const ratio = image.naturalWidth / image.naturalHeight;
        const width = Math.min(
          (PAGE.width - 2 * PAGE.marginX) * MM,
          available * ratio,
        );
        image.style.setProperty("width", width + "px", "important");
        image.style.setProperty("height", width / ratio + "px", "important");
        if (moveIfNeeded(node, true)) return;
      }
      // No cropped or silently omitted blocks are accepted.
      throw new Error("PDF 中有超过一页的图表或卡片，无法完整导出。");
    }
    function addBlock(block) {
      if (block.keepWithNext) return headings.push(block.element);
      if (block.kind === "pair") placePair(block.element);
      else if (block.kind === "table") placeTable(block.element);
      else if (block.kind === "text") placeText(block.element);
      else placeAtomic(block.element);
    }
    function addGroup(blocks) {
      const wrapper = element(
        "div",
        "ringside-pdf-test-group ringside-pdf-block",
      );
      wrapper.dataset.pdfTestGroup = blocks[0].group;
      blocks.forEach((block) => wrapper.append(block.element));
      const capacity =
        content.getBoundingClientRect().height -
        parseFloat(root.getComputedStyle(content).paddingTop) -
        2;
      function measurements() {
        const previous = content.lastElementChild;
        const copies = appendHeadings();
        content.append(wrapper);
        const rect = wrapper.getBoundingClientRect();
        const start = copies[0]?.getBoundingClientRect().top ?? rect.top;
        const charts = (node) =>
          [...node.querySelectorAll("img[data-pdf-chart]")].map((image) => ({
            image,
            rect: image.getBoundingClientRect(),
          }));
        const result = {
          groupHeight: rect.height,
          combinedHeight: rect.bottom - start,
          currentOverflow:
            rect.bottom - content.getBoundingClientRect().bottom + 2,
          images: charts(wrapper),
          previousImages: previous?.matches(".ringside-pdf-test-group")
            ? charts(previous)
            : [],
        };
        wrapper.remove();
        copies.forEach((heading) => heading.remove());
        return result;
      }
      function reduceCharts(images, required) {
        const entries = images.map(({ image, rect }) => {
          const originalHeight =
            Number(image.dataset.pdfOriginalHeight) || rect.height;
          return {
            image,
            rect,
            originalHeight,
            budget: Math.max(0, rect.height - originalHeight * 0.85),
          };
        });
        const budget = entries.reduce((sum, entry) => sum + entry.budget, 0);
        if (!budget || required > budget) return false;
        entries.forEach(
          ({ image, rect, originalHeight, budget: available }) => {
            const ratio = 1 - (required * available) / budget / rect.height;
            image.dataset.pdfOriginalHeight = originalHeight;
            image.style.setProperty(
              "width",
              rect.width * ratio + "px",
              "important",
            );
            image.style.setProperty(
              "height",
              rect.height * ratio + "px",
              "important",
            );
          },
        );
        return true;
      }
      let measured = measurements();
      const primaryPair = wrapper.querySelector('[data-pdf-pair][data-pdf-primary-layout="side-by-side"]');
      // Only groups that fit a full page are kept together. Long tables and
      // tall multi-panel tests retain the existing per-block pagination.
      if (measured.groupHeight <= capacity) {
        // A small fit adjustment across two adjacent tests avoids a mostly
        // empty page for a short result. Each chart retains at least 85% of
        // its initial display size; its source pixels and axis text stay intact.
        if (
          !primaryPair && measured.currentOverflow > 0 &&
          measured.previousImages.length &&
          reduceCharts(
            [...measured.previousImages, ...measured.images],
            measured.currentOverflow + 4,
          )
        ) {
          measured = measurements();
        }
        const overflow = measured.combinedHeight - capacity;
        if (!primaryPair && overflow > 0 && reduceCharts(measured.images, overflow + 4))
          measured = measurements();
        if (measured.combinedHeight <= capacity && moveIfNeeded(wrapper, true))
          return;
      }
      blocks.forEach(addBlock);
    }
    newPage();
    return {
      add: addBlock,
      addGroup,
      startSection() { if (content.childElementCount) newPage(); },
      finish() {
        // A section with no reader content must not leave an orphan title at
        // the bottom of the report. Empty-state content is supplied by the UI.
        headings.length = 0;
        // Empty reports still produce a readable one-page document.
        if (pages.length === 1 && !content.childElementCount)
          content.append(
            element("p", "ringside-pdf-block", "尚未录入测试数据。"),
          );
        pages.forEach((page, index) => {
          page.querySelector(".ringside-pdf-page-number").textContent =
            index + 1 + " / " + pages.length;
        });
        return pages;
      },
    };
  }

  async function build(snapshot, reportElement, options = {}) {
    lastDiagnostics = {
      status: "building",
      recordId: snapshot?.recordId || "",
    };
    let source, captured;
    // Capture the DOM before any asynchronous work or user navigation occurs.
    try {
      if (!reportElement || reportElement.nodeType !== 1)
        throw new Error("未找到可导出的报告页面。");
      if (
        typeof root.html2canvas !== "function" ||
        typeof root.jspdf?.jsPDF !== "function"
      )
        throw new Error("离线 PDF 组件未加载，请使用完整报告文件。");
      captured = JSON.parse(JSON.stringify(snapshot || {}));
      source = cleanClone(reportElement,captured);
      syncBackground(source, captured);
    } catch (error) {
      lastDiagnostics = {
        ...lastDiagnostics,
        status: "failed",
        error: error.message || String(error),
      };
      throw error;
    }
    const stage = element("div", "ringside-pdf-stage");
    stage.setAttribute("aria-hidden", "true");
    const style = element("style");
    style.textContent = CSS;
    stage.append(style, source);
    document.body.append(stage);
    try {
      progress(options.onProgress, "prepare", 0, 0, 0);
      await document.fonts.ready;
      await readyImages(source);
      const primaryLayouts = layoutPrimaryPairs(source, stage);
      root.RingsideReport.layoutCharts(source, { print: true });
      freezePrimaryColumns(source);
      await freezeCharts(source);
      const sourceChartCount = source.querySelectorAll(
        "img[data-pdf-chart-index]",
      ).length;
      [...source.querySelectorAll(".test-block,.lvp-card,.fvp-analysis-card")].forEach(
        (group, index) => {
          group.dataset.pdfTestGroup = String(index);
        },
      );
      const rows = annotateRows(source);
      const pairTexts = [
        ...source.querySelectorAll(
          ".detail-data p,.detail-data h3,.detail-data h4,.detail-data summary",
        ),
      ].map((node, index) => {
        node.dataset.pdfPairText = String(index);
        return node.textContent;
      });
      const blocks = collectBlocks(source);
      const paginator = makePaginator(stage, captured);
      for (let index = 0; index < blocks.length;) {
        const block = blocks[index];
        if (block.startsNarrative && captured.narrative?.text) paginator.startSection();
        if (block.group == null) {
          paginator.add(block);
          index++;
          continue;
        }
        const group = [];
        while (index < blocks.length && blocks[index].group === block.group)
          group.push(blocks[index++]);
        paginator.addGroup(group);
      }
      const pages = paginator.finish();
      lastDiagnostics = diagnose(
        blocks,
        pages,
        rows,
        captured,
        sourceChartCount,
        pairTexts,
      );
      lastDiagnostics.isometricLayouts = primaryLayouts.filter(layout => layout.testId === "iso");
      lastDiagnostics.imtpLayouts = primaryLayouts.filter(layout => layout.testId === "imtp");
      lastDiagnostics.narrativePages = pages.flatMap((page, index) => page.querySelector('[data-pdf-narrative]') ? [index + 1] : []);
      if (
        lastDiagnostics.missingRows.length ||
        lastDiagnostics.duplicateRows.length ||
        lastDiagnostics.changedRows.length
      )
        throw new Error("PDF 表格完整性检查失败，未导出不完整文件。");
      if (
        lastDiagnostics.missingCharts.length ||
        lastDiagnostics.duplicateCharts.length
      )
        throw new Error("PDF 图表完整性检查失败，未导出不完整文件。");
      // Empty trailing headings are intentionally omitted by the paginator.
      const textLoss = lastDiagnostics.textChecks.filter(
        (check) =>
          !check.exact &&
          !(check.keepWithNext && check.renderedCharacters === 0),
      );
      if (textLoss.length)
        throw new Error("PDF 正文完整性检查失败，未导出不完整文件。");
      source.remove();
      await readyImages(stage);
      progress(options.onProgress, "render", 0, pages.length, 10);
      const doc = new root.jspdf.jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "a4",
        compress: true,
      });
      doc.setProperties({
        title: [captured.athlete?.name, "运动表现与筛查"]
          .filter(Boolean)
          .join(" · "),
        subject: [
          "选定测试报告",
          ...backgroundFields(captured).map((field) => field.text),
        ].join(" · "),
        creator: "MotionBench",
        author: "MotionBench",
      });
      for (let index = 0; index < pages.length; index++) {
        const page = pages[index];
        const canvas = await root.html2canvas(page, {
          scale: PAGE.scale,
          backgroundColor: "#ffffff",
          logging: false,
          allowTaint: false,
          useCORS: false,
          imageTimeout: 15000,
          scrollX: 0,
          scrollY: 0,
          windowWidth: 1280,
          windowHeight: 1200,
          removeContainer: true,
        });
        if (!canvas.width || !canvas.height)
          throw new Error("PDF 页面渲染失败。");
        if (index) doc.addPage();
        doc.addImage(
          canvas,
          "PNG",
          0,
          0,
          PAGE.width,
          PAGE.height,
          undefined,
          "FAST",
        );
        canvas.width = canvas.height = 1;
        page.remove();
        progress(
          options.onProgress,
          "render",
          index + 1,
          pages.length,
          10 + Math.round((85 * (index + 1)) / pages.length),
        );
        await new Promise((resolve) => root.setTimeout(resolve, 0));
      }
      const blob = doc.output("blob");
      if (!(blob instanceof Blob) || blob.size < 100)
        throw new Error("PDF 文件生成失败。");
      progress(options.onProgress, "complete", pages.length, pages.length, 100);
      lastDiagnostics.status = "complete";
      lastDiagnostics.bytes = blob.size;
      return blob;
    } catch (error) {
      lastDiagnostics = {
        ...(lastDiagnostics || {}),
        status: "failed",
        error: error.message || String(error),
      };
      throw error;
    } finally {
      stage.remove();
    }
  }

  function measureNarrative(html) {
    const stage = element("div", "ringside-pdf-stage"), style = element("style");
    stage.setAttribute("aria-hidden", "true"); style.textContent = CSS;
    const section = document.getElementById("interpretation");
    const source = cleanClone(section);
    source.dataset.pdfNarrativeSection = "true";
    source.querySelector(".narrative").innerHTML = root.RingsideModel.sanitizeHTML(html);
    stage.append(style, source); document.body.append(stage);
    try {
      const paginator = makePaginator(stage, {});
      collectBlocks(source).forEach(block => paginator.add(block));
      return paginator.finish().length;
    } finally { stage.remove(); }
  }
  root.RingsidePDF = { build, measureNarrative };
  Object.defineProperty(root.RingsidePDF, "lastDiagnostics", {
    enumerable: true,
    get: () => lastDiagnostics && JSON.parse(JSON.stringify(lastDiagnostics)),
  });
})(window);
