(function () {
  "use strict";
  const M = window.RingsideModel,
    T = window.RingsideTests,
    V = window.RingsideViz,
    $ = (id) => document.getElementById(id);
  const E = (x) =>
    String(x ?? "").replace(
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
  const N = Calc.num,
    F = (x, d = 1) =>
      N(x) === null
        ? "—"
        : Number(x).toLocaleString("zh-CN", {
            minimumFractionDigits: d,
            maximumFractionDigits: d,
          });
  const uid = () =>
      crypto.randomUUID
        ? crypto.randomUUID()
        : Date.now().toString(36) + Math.random().toString(36).slice(2),
    now = () => new Date().toISOString();
  const copy = (x) => JSON.parse(JSON.stringify(x)),
    today = () =>
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());
  const storageKey = "ringside-library-v2:" + location.pathname,
    legacyKey = "ringside-local-v1:" + location.pathname;
  let library,
    state,
    repository,
    saveSequence = 0,
    pendingSaves = 0,
    libraryTransferActive = false,
    selectionSequence = 0,
    entryReturn = null,
    entryTab = "athlete",
    settingsTab = "definitions",
    selectedDef = "cmj_height",
    isoFilter = "all",
    saveTimer,
    priorFocus,
    pendingAI = null,
    job = null,
    jobSequence = 0,
    key = "",
    apiURL = "https://api.apikey.fan",
    model = "";
  let aiStatus = { kind: "idle" }, aiTicker;
  const ui = {
    mode: "report",
    returnMode: "report",
    activeSection: "summary",
    reportScroll: 0,
    detailOpen: {},
    sidebarCollapsed: false,
    records: {},
  };
  const uiKey = "ringside-ui-v1:" + location.pathname;
  const modalFocus = new Map();
  let sidebarNavKey = "", sidebarRevealFrame;
  const draftStorageKey = "ringside-input-drafts-v1:" + location.pathname;
  let inputDrafts = {},
    creation = null,
    catalogEdit = null,
    unitChange = null,
    recovery = null,
    storageFailed = false,
    lastRestorePayload = null;
  const recordBaselines = new Map(), queuedRecords = new Map(),
    undoDeletes = new Map();
  const rawNumbers = new WeakMap();
  try {
    inputDrafts = JSON.parse(sessionStorage.getItem(draftStorageKey) || "{}");
  } catch {}
  if (
    !inputDrafts ||
    typeof inputDrafts !== "object" ||
    Array.isArray(inputDrafts)
  )
    inputDrafts = {};
  let reportDirty = true,
    reportObserver = null,
    pdfJob = false,
    scrollFrame = null,
    uiSaveTimer;
  const positive = (x) => N(x) !== null && Number(x) > 0;
  const definition = (id) => state?.definitions?.find((d) => d.id === id);
  const thresholdLabel = (id) =>
    definition(id)?.name?.match(/\bLTP?[12]\b/i)?.[0] ||
    (id === "lt1" ? "阈值1" : "阈值2");
  const snapshot = () => ({
    athleteId: state.athleteId,
    recordId: state.recordId,
    basis: recordBasis(),
    revision: state.narrative?.revision || 0,
  });
  function effectiveRecord(record = state) {
    if (!record) return null;
    return window.RingsideEvaluation.resolve(record, library?.evaluationProfiles.find(p => p.id === record.evaluationProfileId));
  }
  function recordBasis() { return state ? M.fingerprint(effectiveRecord()) : ""; }
  async function loadDirectory(preserve = true) {
    const current = preserve ? state?.recordId : null;
    library = await repository.directory();
    const id = current || library.activeRecordId;
    state = id ? await repository.loadRecord(id) : null;
    const owner = state && library.athletes.find(a => a.id === state.athleteId);
    if (state?.deletedAt || owner?.deletedAt) { state = null; library.activeRecordId="";if(owner?.deletedAt)library.activeAthleteId="";await repository.save(library); }
    if (state) {
      library.activeAthleteId = state.athleteId; library.activeRecordId = state.recordId;
      recordBaselines.set(state.recordId, recordContent(state));
    } else { library.activeRecordId = ""; }
    reportDirty = true;
  }
  async function saveLibraryChanges(records = [], removals = {}) {
    await repository.flush();
    library.updated = now();
    await repository.save(library, records, removals);
    await loadDirectory(true);
    if (job && (!currentMatches(job) || job.basis !== recordBasis())) cancelJob();
    renderReport(); renderWorkspace();
  }
  function openManagement(tab = "athletes") {
    if (!library) return;
    if (ui.mode === "report") captureReportUI();
    saveEditor(); persist();
    if (ui.mode !== "management") ui.returnMode = ui.mode;
    ui.mode = "management";
    window.RingsideManagement.open(tab);
    renderWorkspace(); closeMobileSidebar();
  }
  function activeAthlete() {
    return library?.athletes.find((a) => a.id === (state?.athleteId || library.activeAthleteId));
  }
  function currentMatches(s) {
    return (
      !!s && !!state && state.athleteId === s.athleteId && state.recordId === s.recordId
    );
  }
  function sampleRecord() {
    return M.sampleRecord();
  }
  function recordContent(record) {
    const content = copy(record);
    delete content.updated;
    return JSON.stringify(content);
  }
  function draftRecordKey(record = state) {
    return record.athleteId + ":" + record.recordId;
  }
  function stablePath(path, record = state) {
    const parts = path.split(".");
    let current = record;
    parts.forEach((part, index) => {
      const next = current?.[part];
      if (Array.isArray(current) && next && (next.id || next.name)) parts[index] = "@" + (next.id || next.name);
      current = next;
    });
    return parts.join(".");
  }
  function resolveDraftPath(key, record = state) {
    if (key.startsWith("editRanges."))
      return record.definitions.some((d) => d.id === key.slice(11))
        ? key
        : null;
    if (key.startsWith("editBalance."))
      return record.balancePairs.some((d) => d.id === key.slice(12))
        ? key
        : null;
    if (key.startsWith("editZones."))
      return record.lvp[key.slice(10)] ? key : null;
    const parts = key.split(".");
    let current = record;
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].startsWith("@")) {
        if (!Array.isArray(current)) return null;
        const index = current.findIndex((row) => "@" + (row.id || row.name) === parts[i]);
        if (index < 0) return null;
        parts[i] = String(index);
      }
      current = current?.[parts[i]];
    }
    return parts.join(".");
  }
  function draftsFor(record = state) {
    return inputDrafts[draftRecordKey(record)] || {};
  }
  function saveDrafts() {
    try {
      sessionStorage.setItem(draftStorageKey, JSON.stringify(inputDrafts));
    } catch {}
  }
  function rememberInputError(control, message, raw = null) {
    const entries = (inputDrafts[draftRecordKey()] ||= {});
    entries[stablePath(control.dataset.path)] = {
      value: control.value || (control.validity.badInput ? raw || "" : ""),
      message,
      badInput: control.validity.badInput,
      mode: ui.mode,
      tab: ui.mode === "settings" ? settingsTab : entryTab,
      label: control.getAttribute("aria-label") || control.dataset.path,
    };
    saveDrafts();
    inputIssue(control, message);
    refreshEntryChrome();
  }
  function forgetInputError(path) {
    const entries = draftsFor();
    delete entries[stablePath(path)];
    saveDrafts();
  }
  function applyInputDrafts(container) {
    if (!container) return;
    container.querySelectorAll("[data-path]").forEach((control) => {
      const draft = draftsFor()[stablePath(control.dataset.path)];
      if (!draft) return;
      if (draft.badInput && control.type === "number") {
        control.type = "text";
        control.dataset.numberDraft = "true";
        control.inputMode = "decimal";
      }
      control.value = draft.value;
      inputIssue(control, draft.message);
    });
    container.querySelectorAll("[data-edit-draft]").forEach((control) => {
      const draft = draftsFor()[control.dataset.editDraft];
      if (draft) {
        control.value = draft.value;
        inputIssue(control, draft.message);
      }
    });
  }
  function rememberEditDraft(
    control,
    message = "区间修改尚未应用，请点击应用区间",
  ) {
    const entries = (inputDrafts[draftRecordKey()] ||= {});
    entries[control.dataset.editDraft] = {
      value: control.value,
      message,
      mode: "settings",
      tab: settingsTab,
      label: control.getAttribute("aria-label") || "评价区间",
    };
    saveDrafts();
    inputIssue(control, message);
    refreshEntryChrome();
  }
  function allProjects(record = state) {
    const catalog = T.describe(library.catalog),
      byId = new Map(catalog.map((project) => [project.id, project]));
    const list = T.describe(record).map((project) =>
      Array.isArray(record.catalogAppliedTests) &&
      !record.catalogAppliedTests.includes(project.id)
        ? byId.get(project.id) || project
        : project,
    );
    for (const project of catalog)
      if (!list.some((item) => item.id === project.id)) list.push(project);
    return list;
  }
  function projectBlocked(id) {
    return library.catalog.conflicts.some(
      (c) => c.testId === id && !c.resolved,
    );
  }
  function installCatalogProject(id, force = false) {
    const first =
      Array.isArray(state.catalogAppliedTests) &&
      !state.catalogAppliedTests.includes(id);
    if (projectBlocked(id))
      return !first && state.definitions.some((d) => d.testId === id);
    if ((first || force) && catalogScopeConflict(id)) return false;
    const project = library.catalog.tests.find((t) => t.id === id);
    if (!project) return false;
    if (
      !M.TESTS.some((t) => t[0] === id) &&
      !state.customTests.some((t) => t.id === id)
    )
      state.customTests.push(copy(project));
    state.projectSnapshots ||= T.snapshots(state);
    const projectIndex = state.projectSnapshots.findIndex(
      (test) => test.id === id,
    );
    if (projectIndex < 0) state.projectSnapshots.push(copy(project));
    else if (force || first)
      state.projectSnapshots[projectIndex] = copy(project);
    const definitions = library.catalog.definitions.filter(
      (d) => d.testId === id,
    );
    definitions.forEach((d) => {
      const index = state.definitions.findIndex((x) => x.id === d.id);
      if (index < 0) state.definitions.push(copy(d));
      else if (force || first) state.definitions[index] = copy(d);
      if (T.isManualMetric(d))
        state.customValues[d.id] ||= { value: "", notes: "" };
    });
    if (
      (force || first || !state.protocol[id]) &&
      library.catalog.protocol[id] !== undefined
    )
      state.protocol[id] = library.catalog.protocol[id];
    if (
      Array.isArray(state.catalogAppliedTests) &&
      !state.catalogAppliedTests.includes(id)
    )
      state.catalogAppliedTests.push(id);
    state.catalogRevision = library.catalog.revision;
    return true;
  }
  function entryTabs() {
    return [
      ["athlete", "运动员与背景"],
      ["plan", "本次测试计划"],
      ...T.groups(allProjects().filter((t) => state.enabled[t.id])).flatMap(
        (group) => group.projects.map((t) => [t.id, t.name]),
      ),
      ["narrative", "解读与干预建议"],
    ];
  }
  function renderEntryNavigation() {
    const computed = M.stats(effectiveRecord());
    const button = ([id, name], project) => {
      const issues = Object.values(draftsFor()).filter(
        (d) => d.mode === "entry" && d.tab === id,
      ).length;
      const progress = project
        ? M.recordProgressDetail(state, id, computed)
        : null;
      const text = issues
        ? "待核对 " + issues
        : progress?.status === "valid"
          ? "有结果"
          : progress?.status === "review"
            ? "待核对"
            : "";
      const other =
        project?.abilities.filter(
          (ability) => ability !== project.primaryAbility,
        ) || [];
      const statusLabel = text === "有结果" ? "已有有效结果" : text;
      const accessibleLabel = [name, ...other, statusLabel].filter(Boolean).join(" · ");
      return `<button data-entry-tab="${E(id)}" aria-label="${E(accessibleLabel)}" class="${entryTab === id ? "active" : ""}" ${entryTab === id ? 'aria-current="page"' : ""} onclick="App.entry('${E(id)}')"><span>${E(name)}${other.length ? '<small class="ability-tags">' + other.map(E).join(" · ") + "</small>" : ""}</span>${text ? '<small class="entry-status-pill ' + (issues ? "amber" : "") + '" title="' + E(statusLabel) + '">' + E(text) + "</small>" : ""}</button>`;
    };
    $("entryNav").innerHTML =
      button(["athlete", "运动员与背景"]) +
      button(["plan", "本次测试计划"]) +
      T.groups(allProjects().filter((t) => state.enabled[t.id]))
        .map(
          (group) =>
            '<div class="entry-group-label">' +
            E(group.label) +
            "</div>" +
            group.projects
              .map((test) => button([test.id, test.name], test))
              .join(""),
        )
        .join("") +
      button(["narrative", "解读与干预建议"]);
    revealActiveNavigation();
  }
  function refreshEntryChrome() {
    if (!state) return;
    if (!state || !$("entryIdentity")) return;
    const a = activeAthlete(),
      number = a.records.findIndex((r) => r.recordId === state.recordId) + 1;
    const context = `${a.profile.name || a.name || "未命名运动员"} · ${state.athlete.date || "未填日期"} · 第${number}次`;
    $("recordContext").textContent = context;
    $("entryIdentity").textContent = context;
    const tabs = entryTabs(),
      index = tabs.findIndex((t) => t[0] === entryTab);
    $("entryProjectTitle").textContent = tabs[index]?.[1] || "";
    if (ui.mode === "entry")
      $("workspaceLabel").textContent = tabs[index]?.[1] || "录入测试";
    $("entryPrevious").disabled = index <= 0;
    $("entryNext").disabled = index < 0 || index >= tabs.length - 1;
    const drafts = Object.entries(draftsFor()).filter(([key]) =>
      resolveDraftPath(key),
    );
    if (drafts.length)
      $("saveStatus").textContent =
        drafts.length + " 个输入待核对 · 其余有效数据已保留";
    $("entryProblemSummary").hidden = drafts.length === 0;
    $("entryProblemSummary").innerHTML = drafts.length
      ? `<strong>${drafts.length} 个输入待核对</strong>` +
        drafts
          .map(
            ([key, d]) =>
              `<button class="text-btn" data-error-key="${E(key)}" onclick="App.gotoInputError(this.dataset.errorKey)">${E(d.label)}：${E(d.message)}</button>`,
          )
          .join("")
      : "";
    if (storageFailed)
      $("entrySave").textContent = "仅在当前页面保留，浏览器保存失败，请备份";
    else
      $("entrySave").textContent = drafts.length
        ? "部分输入未保存，请核对标红字段"
        : "已保留当前修改";
    $("undoDeleteButton").hidden = !undoDeletes.has(state.recordId);
    $("undoDeleteButton").textContent =
      undoDeletes.get(state.recordId)?.type === "unit"
        ? "撤销单位修改"
        : "撤销删除";
    if (ui.mode === "entry") renderEntryNavigation();
    document
      .querySelectorAll("[data-plan-count]")
      .forEach(
        (el) =>
          (el.textContent =
            allProjects().filter((t) => state.enabled[t.id]).length +
            " 项已选"),
      );
    document.querySelectorAll("[data-plan-status]").forEach((el) => {
      const progress = M.recordProgressDetail(state, el.dataset.planStatus);
      el.textContent = progress?.detail || "未录入";
    });
  }
  function gotoInputError(key) {
    const draft = draftsFor()[key];
    if (!draft) return;
    if (draft.mode === "settings") openSettings(draft.tab);
    else openEntry(draft.tab);
    const path = resolveDraftPath(key);
    document
      .querySelector(
        `[data-path="${CSS.escape(path || "")}"],[data-edit-draft="${CSS.escape(path || "")}"]`,
      )
      ?.focus();
  }
  function ensureExportable(records = [state]) {
    saveEditor();
    const pending = records.filter((r) =>
      Object.keys(draftsFor(r)).some((key) => resolveDraftPath(key, r)),
    );
    if (pending.length) {
      const count = pending.reduce(
        (n, r) => n + Object.keys(draftsFor(r)).length,
        0,
      );
      if (
        !confirm(
          `有 ${count} 个未保存的错误输入。确定放弃这些修改，导出最后有效的数据？\n取消后可返回修正。`,
        )
      ) {
        if (pending.some((r) => r.recordId === state.recordId))
          gotoInputError(Object.keys(draftsFor())[0]);
        throw new Error("请先修正输入，或明确放弃未保存的修改");
      }
      pending.forEach((r) => delete inputDrafts[draftRecordKey(r)]);
      saveDrafts();
      if (ui.mode === "entry") renderEntry();
      else if (ui.mode === "settings") renderSettings();
    }
    records.forEach((r) => M.validateRecord(r));
  }
  async function restore() {
    repository = await window.RingsideStore.Repository.open();
    if (!repository.generation) {
      let input = null;
      const embeddedText = $("embedded-data").textContent.trim();
      if (embeddedText && embeddedText !== "null" && embeddedText !== "{}") input = JSON.parse(embeddedText);
      if (!input) {
        const old = localStorage.getItem(storageKey) || localStorage.getItem(legacyKey);
        if (old) { lastRestorePayload = {rawText:old}; input = JSON.parse(old); }
      }
      lastRestorePayload = input || lastRestorePayload;
      const migrated = window.RingsideEvaluation.migrate(input || M.libraryDefaults());
      await repository.importLibrary(migrated);
    }
    await loadDirectory(false);
  }
  function rememberUI() {
    if (!state) return;
    try {
      sessionStorage.setItem(
        uiKey,
        JSON.stringify({
          recordId: state.recordId,
          mode: ui.mode,
          returnMode: ui.returnMode,
          entryTab,
          settingsTab,
          reportScroll: ui.reportScroll,
          detailOpen: ui.detailOpen,
          sidebarCollapsed: ui.sidebarCollapsed,
          lastViewed: ui.lastViewed || {},
        }),
      );
    } catch {}
  }
  function captureReportUI() {
    if (!state) return;
    if (ui.mode !== "report") return;
    ui.reportScroll = window.scrollY;
    document
      .querySelectorAll("#reportView .details-group,#reportView [data-raw-trials]")
      .forEach((el) => (ui.detailOpen[el.id] = el.open));
    ui.records[state.recordId] = {
      reportScroll: ui.reportScroll,
      detailOpen: { ...ui.detailOpen },
    };
  }
  function renderWorkspace() {
    const management = ui.mode === "management";
    $("managementView").hidden = !management;
    $("emptyReport").hidden = ui.mode !== "report" || !!state;
    document.body.classList.toggle("management-mode", management);
    $("reportControls").hidden = management || ui.mode === "settings";
    $("reportActions").hidden = ui.mode !== "report" || !state;
    $("reportWorkspaceButton").setAttribute("aria-current", ui.mode === "report" ? "page" : "false");
    $("managementWorkspaceButton").setAttribute("aria-current", management ? "page" : "false");
    $("reportView").hidden = ui.mode !== "report" || !state;
    $("entryView").hidden = ui.mode !== "entry";
    $("settingsView").hidden = ui.mode !== "settings";
    $("entryNav").hidden = ui.mode !== "entry";
    $("reportNav").hidden = ui.mode === "entry";
    $("directoryLabel").textContent =
      ui.mode === "entry"
        ? "编辑项目"
        : ui.mode === "settings"
          ? window.RingsideSettings.scopes[
              window.RingsideSettings.scopeFor(settingsTab)
            ].title
          : "报告目录";
    $("workspaceLabel").textContent =
      ui.mode === "entry"
        ? entryTabs().find((t) => t[0] === entryTab)?.[1] || "录入测试"
        : ui.mode === "settings"
          ? window.RingsideSettings.scopes[
              window.RingsideSettings.scopeFor(settingsTab)
            ].title
          : "测试报告";
    $("editButton").hidden = ui.mode !== "report" || !state;
    if (management) { $("workspaceLabel").textContent="管理中心"; $("recordContext").textContent=""; $("directoryLabel").textContent="资料管理"; }

    $("workspaceBack").hidden = ui.mode === "report";
    $("workspaceBack").textContent =
      ui.mode === "settings" && ui.returnMode === "entry"
        ? "返回编辑"
        : "返回报告";
    renderNavigation();
    renderAIStatus();
    rememberUI();
  }
  function renderNavigation() {
    if (ui.mode === "management") { $("entryNav").hidden=true; $("settingsTabs").hidden=true; $("reportNav").hidden=false; $("reportNav").innerHTML=window.RingsideManagement.navigation(); return; }
    const activeScope = ui.mode === "settings"
      ? window.RingsideSettings.scopeFor(settingsTab) : null;
    document.querySelectorAll("[data-settings-open]").forEach(button => {
      const active = button.dataset.settingsOpen === activeScope;
      button.classList.toggle("sidebar-scope-active", active);
      if (active) button.setAttribute("aria-current", "true");
      else button.removeAttribute("aria-current");
    });
    revealActiveNavigation();
    if (ui.mode === "entry") {
      $("settingsTabs").hidden = true;
      return;
    }
    $("settingsTabs").hidden = ui.mode !== "settings";
    if (ui.mode === "settings") {
      const scope = window.RingsideSettings.scopeFor(settingsTab);
      $("settingsTabs").innerHTML = window.RingsideSettings.sections[scope]
        .map(
          ([id, label]) =>
            `<button data-settings-tab="${id}" class="${settingsTab === id ? "active" : ""}" ${settingsTab === id ? 'aria-current="page"' : ""} onclick="App.settings('${id}')">${label}</button>`,
        )
        .join("");
      $("reportNav").innerHTML = "";
      return;
    }
    if (!state) { $("reportNav").innerHTML=""; return; }
    const sections = [
      ["summary", "快速摘要", "01"],
      ["data", "具体数据", "02"],
      ["screenDetail", "损伤风险筛查", ""],
      ...Array.from(
        document.querySelectorAll("#reportView .quality-group[id]"),
      ).map((el) => [el.id, el.querySelector("h3")?.textContent || "", ""]),
      ["interpretation", "解读与干预建议", "03"],
    ].filter(([id]) => $(id));
    $("reportNav").innerHTML = sections
      .map(
        ([id, label, index]) =>
          `<button data-section="${id}" class="${index ? "" : "sub"} ${ui.activeSection === id ? "active" : ""}" onclick="App.navigate('${id}')">${index ? `<span class="nav-index">${index}</span>` : ""}${E(label)}</button>`,
      )
      .join("");
    reportObserver?.disconnect();
    if (window.IntersectionObserver) {
      reportObserver = new IntersectionObserver(updateScrollNav, {
        rootMargin: "-70px 0px -60% 0px",
      });
      sections.forEach(([id]) => reportObserver.observe($(id)));
    }
    updateScrollNav();
  }
  function updateScrollNav() {
    if (ui.mode !== "report") return;
    const buttons = [...$("reportNav").querySelectorAll("[data-section]")];
    let current = buttons[0]?.dataset.section || "summary";
    for (const button of buttons) {
      const el = $(button.dataset.section);
      if (
        el &&
        el.getBoundingClientRect().top <= 130 &&
        el.getClientRects().length
      )
        current = button.dataset.section;
    }
    ui.activeSection = current;
    buttons.forEach((button) => {
      const active = button.dataset.section === current;
      button.classList.toggle("active", active);
      if (active) button.setAttribute("aria-current", "location");
      else button.removeAttribute("aria-current");
    });
    revealActiveNavigation();
  }
  function revealActiveNavigation(force = false) {
    const key = [state?.recordId, ui.mode, ui.mode === "entry" ? entryTab
      : ui.mode === "settings" ? settingsTab : ui.activeSection].join(":");
    if (!force && key === sidebarNavKey) return;
    cancelAnimationFrame(sidebarRevealFrame);
    sidebarRevealFrame = requestAnimationFrame(() => {
      const sidebar = $("sidebar");
      if (sidebar.inert) return;
      const nav = $(ui.mode === "entry" ? "entryNav" : ui.mode === "settings" ? "settingsTabs" : "reportNav");
      const active = nav.querySelector("button.active");
      if (!active?.getClientRects().length) return;
      const wholeSidebar = matchMedia("(max-height:720px)").matches;
      const scroller = wholeSidebar ? sidebar : sidebar.querySelector(".sidebar-directory");
      const viewport = scroller.getBoundingClientRect(), item = active.getBoundingClientRect();
      const top = wholeSidebar ? sidebar.querySelector(".brand").getBoundingClientRect().bottom : viewport.top;
      const delta = item.top < top + 8 ? item.top - top - 8
        : item.bottom > viewport.bottom - 8 ? item.bottom - viewport.bottom + 8 : 0;
      // Never scroll the document or reset a manually scrolled directory on input.
      if (delta) scroller.scrollBy({ top: delta, behavior: "instant" });
      sidebarNavKey = key;
    });
  }
  function focusContentTitle() {
    const heading = ui.mode === "entry" ? $("entryProjectTitle")
      : $("settingsContent").querySelector("h3") || $("settingsTitle");
    heading.setAttribute("tabindex", "-1");
    heading.focus({ preventScroll: true });
  }
  function toggleSidebar(force) {
    const mobile = matchMedia("(max-width:900px)").matches;
    const open =
      force === undefined
        ? mobile
          ? !document.body.classList.contains("sidebar-open")
          : document.body.classList.contains("sidebar-collapsed")
        : !!force;
    document.body.classList.toggle("sidebar-open", mobile && open);
    if (!mobile) {
      ui.sidebarCollapsed = !open;
      document.body.classList.toggle("sidebar-collapsed", !open);
    }
    $("sidebarScrim").hidden = !mobile || !open;
    $("workspace").inert = mobile && open;
    $("sidebar").inert = !open;
    $("sidebarToggle").setAttribute("aria-expanded", String(open));
    if (mobile) {
      document.body.style.overflow = open ? "hidden" : "";
      if (open) $("sidebar").querySelector("button")?.focus({ preventScroll: true });
    }
    if (open) revealActiveNavigation(true);
    else $("sidebarToggle").focus({ preventScroll: true });
    rememberUI();
  }
  function closeMobileSidebar() {
    if (matchMedia("(max-width:900px)").matches) toggleSidebar(false);
  }
  function showReport(restoreScroll = true) {
    entryReturn = null;
    saveEditor();
    persist();
    ui.mode = "report";
    ui.returnMode = "report";
    renderWorkspace();
    renderReport(false);
    closeMobileSidebar();
    if (restoreScroll)
      requestAnimationFrame(() =>
        window.scrollTo({ top: ui.reportScroll, behavior: "instant" }),
      );
    return ui.mode;
  }
  async function back() {
    if (ui.mode === "entry" && entryReturn?.mode === "management") {
      const backTo = entryReturn; entryReturn = null; saveEditor(); if (!await persist()) return;
      if (backTo.recordId) { const a = library.athletes.find(a=>a.id===backTo.athleteId); const r = a?.records.find(r=>r.recordId===backTo.recordId); if (r) await switchRecord(a,r); }
      else { state=null;library.activeAthleteId=backTo.athleteId||"";library.activeRecordId="";await persist(); }
      openManagement(backTo.tab);ui.returnMode="report";renderWorkspace();return;
    }
    if (ui.mode === "management") { if (ui.returnMode === "entry" && state) { ui.mode="entry"; renderEntry();renderWorkspace();return; } return showReport(); }
    if (ui.mode === "settings" && ui.returnMode === "entry") {
      ui.mode = "entry";
      renderEntry();
      renderWorkspace();
      window.scrollTo({ top: 0, behavior: "instant" });
      closeMobileSidebar();
      focusContentTitle();
    } else showReport();
  }
  function navigate(id) {
    if (ui.mode !== "report") showReport(false);
    const el = $(id);
    if (!el) return;
    if (el.matches("details")) el.open = true;
    const parent = el.closest("details");
    if (parent) parent.open = true;
    closeMobileSidebar();
    el.scrollIntoView({
      behavior: matchMedia("(prefers-reduced-motion:reduce)").matches
        ? "instant"
        : "smooth",
      block: "start",
    });
    const heading = el.querySelector("h2,h3,summary");
    if (heading) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
    ui.activeSection = id;
    rememberUI();
  }
  function updateForceWarnings() {
    const issues = M.forceTime(state).issues;
    document.querySelectorAll("[data-force-warnings]").forEach((el) => {
      const index = Number(el.dataset.forceWarnings);
      el.innerHTML = issues
        .filter((x) => x.trialIndex === index)
        .map((x) => `<div class="inline-issue">${E(x.message)}</div>`)
        .join("");
    });
  }
  function addForcePoint(trialIndex) {
    const row = state.data.imtp[trialIndex];
    if (!row) return;
    row.timePoints ||= [];
    const times = row.timePoints
        .map((x) => N(x.timeMs))
        .filter((x) => x !== null),
      next = times.length ? Math.max(...times) + 100 : 100;
    row.timePoints.push({ id: uid(), timeMs: next, force: "", rfd: "" });
    M.syncIMTPLegacy(row);
    persist();
    renderEntry();
    reportDirty = true;
    document
      .querySelector(
        `[data-path="data.imtp.${trialIndex}.timePoints.${row.timePoints.length - 1}.force"]`,
      )
      ?.focus();
  }
  function removeForcePoint(trialIndex, pointIndex) {
    const row = state.data.imtp[trialIndex];
    if (!row) return;
    rememberDeletion("point", trialIndex, pointIndex);
    row.timePoints.splice(pointIndex, 1);
    M.syncIMTPLegacy(row);
    persist();
    renderEntry();
    reportDirty = true;
    rowFocus(
      `data.imtp.${trialIndex}.timePoints.${Math.max(0, pointIndex - 1)}.force`,
    );
  }
  function imtpForm() {
    const forceInput = (path, value, opts = {}) =>
      input(path, value, { ...opts, allowNegative: true });
    let h =
      '<p class="intro">逐次填写峰值与已知时间点。只录入 RFD 时，须填写发力起点力；起点未知请留空。</p>';
    h += field(
      "协议 / 设备",
      input("protocol.imtp", state.protocol.imtp, { type: "text" }),
    );
    h += '<button type="button" class="btn small" onclick="App.addRow(\'imtp\')">＋ 新增试次</button>';
    h += state.data.imtp
      .map((row, i) => {
        const points = row.timePoints || [];
        return `<article class="imtp-attempt"><div class="imtp-attempt-head"><h4>试次 ${i + 1}</h4><button class="remove" aria-label="删除试次 ${i + 1}" onclick="App.removeRow('imtp',${i})">删除试次</button></div><div class="form-grid">${field("峰值力 N", forceInput("data.imtp." + i + ".peakForce", row.peakForce, { label: "试次" + (i + 1) + " 峰值力 N" }))}${field("发力起点力 F0 · N", forceInput("data.imtp." + i + ".baselineForce", row.baselineForce, { label: "试次" + (i + 1) + " 发力起点力 N", placeholder: "未知留空；已知零填写0" }))}${field("峰值发生时间 ms", input("data.imtp." + i + ".peakTimeMs", row.peakTimeMs, { label: "试次" + (i + 1) + " 峰值时间 ms", min: 0.000001, placeholder: "未知留空" }))}</div><p class="force-help">RFD 固定采用发力起点至该时间的平均值；力值和 RFD 同时填写时，以力值绘图。</p>${
          points.length
            ? table(
                ["时间 ms", "实测力 N", "0–t 平均 RFD N/s", ""],
                points.map((point, j) => [
                  input(`data.imtp.${i}.timePoints.${j}.timeMs`, point.timeMs, {
                    min: 0.000001,
                    label: "时间 ms",
                  }),
                  forceInput(
                    `data.imtp.${i}.timePoints.${j}.force`,
                    point.force,
                    {
                      label: point.timeMs + " ms 实测力 N",
                    },
                  ),
                  forceInput(`data.imtp.${i}.timePoints.${j}.rfd`, point.rfd, {
                    label: "0–" + point.timeMs + " ms 平均 RFD N/s",
                  }),
                  `<button class="remove" aria-label="删除 ${point.timeMs} ms 时间点" onclick="App.removeForcePoint(${i},${j})"><svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18"/></svg></button>`,
                ]),
              )
            : '<div class="empty">尚未录入时间点；只有峰值时，报告显示峰值参考线。</div>'
        }<button class="btn small" style="margin-top:12px" onclick="App.addForcePoint(${i})">＋ 时间点</button><div class="form-grid">${T.repeatPolicy(state, "imtp").fields.map((d) => field(d.name + " " + d.unit, forceInput(`data.imtp.${i}.metrics.${d.id}`, row.metrics?.[d.id] ?? ""))).join("")}${field("试次备注", input(`data.imtp.${i}.notes`, row.notes || "", { type: "text" }))}</div><div data-force-warnings="${i}"></div></article>`;
      })
      .join("");
    return (
      h +
      '<button class="btn small" onclick="App.addRow(\'imtp\')">＋ 新增试次</button>'
    );
  }
  function persist() {
    if (!library || !repository) return Promise.resolve(false);
    clearTimeout(saveTimer); saveTimer = null;
    const record = state, content = record ? recordContent(record) : "";
    const modified = record && (queuedRecords.get(record.recordId)?.content ?? recordBaselines.get(record.recordId)) !== content;
    if (modified) record.updated = now();
    if (record) {
      const a = library.athletes.find(a => a.id === record.athleteId);
      if (!a) return Promise.resolve(false);
      a.name = a.profile?.name || a.name;
      const index = a.records.findIndex(r => r.recordId === record.recordId), item = window.RingsideStore.summary(record);
      if (index < 0) a.records.push(item); else a.records[index] = item;
    }
    if (modified) library.updated = now();
    const sequence = ++saveSequence;
    if (modified) queuedRecords.set(record.recordId,{sequence,content});
    $("saveStatus").textContent = "正在保存…";
    pendingSaves++;
    let saving;
    try { saving=repository.save(library, modified ? [record] : []); } catch(error) { saving=Promise.reject(error); }
    return saving.then(() => {
      if (record) recordBaselines.set(record.recordId, content);
      if (sequence === saveSequence) { storageFailed = false; $("saveStatus").textContent = "已保存到本机"; if (state) refreshEntryChrome(); }
      return true;
    }).catch(error => {
      storageFailed = true; $("saveStatus").textContent = "保存失败 · " + error.message;
      if (state) refreshEntryChrome(); return false;
    }).finally(() => { pendingSaves--; if(record&&queuedRecords.get(record.recordId)?.sequence===sequence)queuedRecords.delete(record.recordId); });
  }
  function changed(render = true) {
    clearTimeout(saveTimer);
    reportDirty = true;
    const id = state.recordId;
    saveTimer = setTimeout(() => {
      if (state.recordId !== id) return;
      persist();
      if (ui.mode === "report" && render) renderReport();
      else renderNarrativeStatus();
      if (ui.mode === "entry" && entryTab === "imtp") updateForceWarnings();
      refreshEntryChrome();
    }, 180);
  }
  function toast(t, scope = "") {
    if (scope === "ai" && !isAIView()) return;
    $("toast").dataset.scope = scope;
    $("toast").textContent = t;
    $("toast").style.display = "block";
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => ($("toast").style.display = "none"), 3800);
  }
  function modal(id) {
    closeMobileSidebar();
    modalFocus.set(id, document.activeElement);
    document
      .querySelectorAll(".modal-backdrop.show")
      .forEach((el) => el.classList.remove("show"));
    $(id).classList.add("show");
    $("workspace").inert = true;
    $("sidebar").inert = true;
    document.body.style.overflow = "hidden";
    (
      [
        ...$(id).querySelectorAll(
          '[data-initial-focus],input:not([type="hidden"]),select,textarea',
        ),
      ].find((el) => el.offsetParent && !el.disabled && !el.readOnly) ||
      $(id).querySelector("button")
    )?.focus();
  }
  function close(id) {
    const returnToCatalog =
      id === "unitModal" && unitChange?.kind === "catalog";
    if (id === "recoveryModal" && recovery?.mode === "startup")
      return toast("请先修正并恢复数据，原始内容可下载保留");
    if (id === "entryModal" || id === "settingsModal") return back();
    $(id)?.classList.remove("show");
    if (id === "newAthleteModal") creation = null;
    if (id === "unitModal") unitChange = null;
    if (id === "catalogModal") catalogEdit = null;
    document.body.style.overflow = "";
    $("workspace").inert = false;
    $("sidebar").inert =
      matchMedia("(max-width:900px)").matches || ui.sidebarCollapsed;
    modalFocus.get(id)?.focus({ preventScroll: true });
    modalFocus.delete(id);
    if (returnToCatalog && catalogEdit) {
      modal("catalogModal");
      $("catalogUnit").focus();
    }
    persist();
  }
  function cancelJob() {
    if (job) job.controller.abort();
    job = null;
    jobSequence++;
    pendingAI = null;
    setAIStatus("idle");
    document
      .querySelectorAll(".modal-backdrop")
      .forEach((el) => el.classList.remove("show"));
    document.body.style.overflow = "";
    $("workspace").inert = false;
    $("sidebar").inert =
      matchMedia("(max-width:900px)").matches || ui.sidebarCollapsed;
    $("tooltip").style.display = "none";
    renderNarrativeStatus();
  }
  async function switchRecord(a, r, options = {}) {
    const sequence = ++selectionSequence;
    if (state) { captureReportUI(); saveEditor(); }
    if (!await persist()) return;
    const loaded = r ? await repository.loadRecord(r.recordId) : null;
    if (sequence !== selectionSequence) return;
    cancelJob();
    state = loaded; library.activeAthleteId = a?.id || ""; library.activeRecordId = loaded?.recordId || "";
    if (loaded) { recordBaselines.set(loaded.recordId, recordContent(loaded)); ui.lastViewed ||= {}; ui.lastViewed[a.id] = loaded.recordId; }
    entryTab = "athlete"; isoFilter = "all"; reportDirty = true;
    const saved = loaded && ui.records[loaded.recordId];
    ui.reportScroll = saved?.reportScroll || 0; ui.detailOpen = {...saved?.detailOpen};
    ui.mode = options.edit && loaded ? "entry" : "report";
    await persist(); renderReport(false);
    if (ui.mode === "entry") renderEntry();
    renderWorkspace(); closeMobileSidebar(); window.scrollTo({top:ui.mode === "report" ? ui.reportScroll:0,behavior:"instant"});
  }
  async function selectAthlete(id) {
    const a = library.athletes.find(a => a.id === id && !a.deletedAt);
    if (!a) return;
    const records = a.records.filter(r => !r.deletedAt && !r.archived);
    const r = records.find(r => r.recordId === ui.lastViewed?.[id]) || M.latestRecord({records});
    return switchRecord(a,r);
  }
  async function selectRecord(id) {
    const a = activeAthlete(), r = a?.records.find(r => r.recordId === id && !r.deletedAt);
    if (r) return switchRecord(a,r);
  }
  async function openManagedRecord(athleteId, recordId, edit = false) {
    const a = library.athletes.find(a => a.id === athleteId), r = a?.records.find(r => r.recordId === recordId);
    if (!a || !r) return;
    close("managementModal");
    if (edit) entryReturn = { mode:"management", tab:window.RingsideManagement.tab(), athleteId:library.activeAthleteId, recordId:library.activeRecordId };
    return switchRecord(a,r,{edit});
  }
  function openNewAthlete() {
    openManagement("athletes"); window.RingsideManagement.editAthlete();
  }
  function inheritConfiguration(r, source) {
    for (const k of [
      "enabled",
      "definitions",
      "customTests",
      "axes",
      "rules",
      "lvp",
      "protocol",
      "views",
      "imtpConfig",
      "cmjConfig",
      "trainingContext",
    ])
      if (source[k]) r[k] = copy(source[k]);
    r.dsi = { ...copy(source.dsi), force: "", confirmed: false };
    r.thresholds = { ...copy(source.thresholds), lt1: "", lt2: "" };
    r.data.iso = copy(source.data.iso).map((x) => ({
      ...x,
      left: "",
      right: "",
      center: "",
      painLeft: false,
      painRight: false,
      painCenter: false,
      notes: "",
    }));
    r.balancePairs = copy(source.balancePairs);
    r.customValues = Object.fromEntries(
      r.definitions
        .filter((d) => T.isManualMetric(d))
        .map((d) => [d.id, { value: "", notes: "" }]),
    );
    return r;
  }
  async function createAthlete(name) {
    if (!String(name||"").trim()) return;
    const id=uid(), profile={name:String(name).trim(),sex:"未注明",sport:"",dominantHand:"未注明",sportLevel:""};
    library.athletes.push({id,name:profile.name,profile,records:[],groupId:"",archived:false,deletedAt:null,sample:false});
    await saveLibraryChanges();return id;
  }
  async function newTest(athleteId) {
    const owner=library.athletes.find(a=>a.id===athleteId)||activeAthlete();
    if(!owner)return openNewAthlete();
    return openCreation("record",owner);
  }
  function pathLabel(path) {
    const p = path.split("."),
      names = {
        name: "姓名 / 编号",
        age: "年龄",
        sex: "性别",
        mass: "体重 kg",
        height: "高度 cm",
        sport: "专项",
        dominantHand: "惯用手",
        sportLevel: "水平 / 级别",
        date: "测试日期",
        cycle: "训练周期",
        injury: "既往损伤与当前症状",
        notes: "补充说明",
        left: "左侧",
        right: "右侧",
        center: "中线",
        score: "动作评分",
        pain: "疼痛／清除阳性",
        painLeft: "左侧疼痛",
        painRight: "右侧疼痛",
        painCenter: "中线疼痛",
        unit: "单位",
        target: "评价目标",
        load: "负荷 kg",
        velocity: "速度 m/s",
        speed: "速度 m/s",
        force: "力 N",
        reps: "有效次数",
        distance: "距离 m",
        lactate: "乳酸 mmol/L",
        hr: "心率 bpm",
        side: "侧别",
        method: "测量方法",
        partial: "末级未完成秒数",
        location: "身体部位",
        referenceEnabled: "启用匹配评价标准",
        ability: "能力分类",
        direction: "评价方向",
        category: "报告分类",
        source: "参考来源",
        protocol: "测试协议",
        region: "人体区域",
        mvt: "MVT m/s",
        metric: "速度口径",
        definition: "力定义",
        confirmed: "协议可比确认",
        lt1: thresholdLabel("lt1") + " m/s",
        lt2: thresholdLabel("lt2") + " m/s",
        asymAmber: "双侧差异关注阈值 %",
        asymRed: "双侧差异重点关注阈值 %",
        absoluteAmber: "绝对力量关注比例 %",
        scoreAmber: "能力关注阈值",
        scoreGreen: "能力达成阈值",
        cmjUnit: "CMJ 力单位",
        cmjDefinition: "CMJ 力定义",
        showPoints: "显示实测点",
        showBand: "显示95%置信带",
        showEstimate: "显示估计点",
      };
    const suffix = names[p.at(-1)] || p.at(-1);
    if (p[0] === "athlete") return p[1] === "height" ? "身高 cm" : suffix;
    if (p[0] === "customValues")
      return (
        (definition(p[1])?.name || "自定义指标") +
        " · " +
        (p[2] === "value" ? "结果 " + (definition(p[1])?.unit || "") : suffix)
      );
    if (p[0] === "definitions")
      return (state.definitions[Number(p[1])]?.name || "指标") + " · " + suffix;
    if (p[0] === "data") {
      const test = M.TESTS.find((t) => t[0] === p[1])?.[1] || p[1],
        row = state.data[p[1]]?.[Number(p[2])];
      const detail =
        p[1] === "iso" && row
          ? M.REG[row.region] + " · " + row.direction
          : p[1] === "fms" && row
            ? row.name
            : row
              ? "尝试 " + (Number(p[2]) + 1)
              : "";
      return [test, detail, suffix].filter(Boolean).join(" · ");
    }
    return suffix;
  }
  function projectPicker(enabled, forCreation = false) {
    const projects = (forCreation ? T.describe(library.catalog) : allProjects()).filter(t=>!library.catalog.tests.find(x=>x.id===t.id)?.disabled || (!forCreation && state.enabled[t.id]));
    let html =
      '<div class="plan-tools"><button type="button" class="btn small" onclick="App.selectProjects(\'all\',true,' +
      forCreation +
      ')">全选</button><button type="button" class="btn small" onclick="App.selectProjects(\'all\',false,' +
      forCreation +
      ')">清空</button><span class="plan-count" ' +
      (forCreation ? "data-creation-count" : "data-plan-count") +
      ">" +
      projects.filter((t) => enabled[t.id]).length +
      " 项已选</span></div>";
    const computed = forCreation ? null : M.stats(effectiveRecord());
    for (const group of T.groups(projects)) {
      html += `<section class="plan-group" data-plan-group="${E(group.id)}"><div class="plan-group-heading"><h4>${E(group.label)}</h4><button type="button" class="text-btn" onclick="App.selectProjects('${E(group.id)}',true,${forCreation})">选择本组</button><button type="button" class="text-btn" onclick="App.selectProjects('${E(group.id)}',false,${forCreation})">清空本组</button></div><div class="check-grid">`;
      html +=
        group.projects
          .map((test) => {
            const blocked =
              projectBlocked(test.id) &&
              (forCreation ||
                (Array.isArray(state.catalogAppliedTests) &&
                  !state.catalogAppliedTests.includes(test.id)) ||
                !state.definitions.some((d) => d.testId === test.id));
            const other = test.abilities.filter(
              (ability) => ability !== test.primaryAbility,
            );
            return `<label class="check-tile"><input type="checkbox" value="${E(test.id)}" data-project-group="${E(group.id)}" ${forCreation ? `data-creation-project="${E(test.id)}"` : `data-path="enabled.${E(test.id)}"`} aria-label="${E(test.name)}" ${enabled[test.id] ? "checked" : ""} ${blocked ? "disabled" : ""}><span>${E(test.name)}${other.length ? '<small class="ability-tags">' + other.map(E).join(" · ") + "</small>" : ""}<small class="plan-state" ${forCreation ? "" : `data-plan-status="${E(test.id)}"`}>${blocked ? "目录定义待确认" : forCreation ? "" : E(M.recordProgressDetail(state, test.id, computed)?.detail || "未录入")}</small></span></label>`;
          })
          .join("") + "</div></section>";
    }
    return html;
  }
  function selectProjects(group, checked, forCreation = false) {
    const container = forCreation ? $("creationProjects") : $("entryContent");
    container
      .querySelectorAll('input[type="checkbox"][data-project-group]')
      .forEach((control) => {
        const id = control.value;
        if (
          control.disabled ||
          (group !== "all" && control.dataset.projectGroup !== group)
        )
          return;
        if (!forCreation && checked && !installCatalogProject(id)) return;
        control.checked = checked;
        if (forCreation) creation.enabled[id] = checked;
        else state.enabled[id] = checked;
      });
    if (forCreation) refreshCreationCount();
    else {
      changed(false);
      refreshEntryChrome();
    }
  }
  function refreshCreationCount() {
    if (!creation) return;
    const count = Object.values(creation.enabled).filter(Boolean).length;
    $("creationCount").textContent = count + " 项已选";
    document
      .querySelectorAll("[data-creation-count]")
      .forEach((el) => (el.textContent = count + " 项已选"));
    $("creationSubmit").disabled = creation.submitting || count === 0;
  }
  async function openCreation(kind, owner = activeAthlete()) {
    saveEditor();
    persist();
    const latestSummary = kind === "record" ? M.latestRecord({records:owner.records.filter(r => !r.deletedAt)}) : null;
    const latest = latestSummary ? await repository.loadRecord(latestSummary.recordId) : null;
    creation = {
      kind,
      ownerId: owner?.id,
      evaluationProfileId: library.evaluationProfiles.find(p=>p.id===latest?.evaluationProfileId&&!p.disabled)?.id || library.defaultEvaluationProfileId,
      returnMode: ui.mode,
      returnAthleteId: library.activeAthleteId,
      returnRecordId: library.activeRecordId,
      step: kind === "athlete" ? "profile" : "test",
      enabled: Object.fromEntries(
        library.catalog.tests.map((t) => [
          t.id,
          !!latest?.enabled[t.id] && !projectBlocked(t.id) && !t.disabled,
        ]),
      ),
      profile:
        kind === "record"
          ? copy(owner.profile)
          : {
              name: "",
              sex: "未注明",
              sport: "",
              dominantHand: "未注明",
              sportLevel: "",
            },
      submitting: false,
    };
    $("newAthleteTitle").textContent =
      kind === "athlete" ? "新建运动员与首测" : "新建测试记录";
    $("newAthleteName").value = creation.profile.name;
    $("newAthleteSex").value = creation.profile.sex;
    $("newAthleteSport").value = creation.profile.sport;
    $("newAthleteHand").value = creation.profile.dominantHand;
    $("newAthleteLevel").value = creation.profile.sportLevel;
    $("creationDate").value = today();
    $("creationEvaluationProfile").innerHTML = library.evaluationProfiles.filter(p=>!p.disabled).map(p=>`<option value="${E(p.id)}" ${p.id===creation.evaluationProfileId?"selected":""}>${E(p.name)}</option>`).join("");
    $("creationSource").textContent = latest
      ? `${owner.name} · 沿用 ${latest.athlete.date || "未填日期"} 所选项目，结果重新录入。`
      : "首次测试，请选择本次要进行的项目。";
    $("creationProjects").innerHTML = projectPicker(creation.enabled, true);
    $("creationError").hidden = true;
    renderCreationStep();
    modal("newAthleteModal");
    $(kind === "athlete" ? "newAthleteName" : "creationDate")?.focus();
    return copy(creation);
  }
  function renderCreationStep() {
    const profile = creation.step === "profile";
    $("creationProfileStep").hidden = !profile;
    $("creationTestStep").hidden = profile;
    $("creationTestStep").querySelector(".creation-step-label").textContent =
      creation.kind === "athlete" ? "2 / 2 · 本次测试" : "本次测试";
    $("creationBack").hidden =
      (!profile && creation.kind !== "athlete") || profile;
    $("creationNext").hidden = !profile;
    $("creationSubmit").hidden = profile;
    $("creationSubmit").textContent =
      creation.kind === "athlete" ? "创建并开始录入" : "创建测试并开始录入";
    refreshCreationCount();
  }
  function creationError(message) {
    $("creationError").textContent = message;
    $("creationError").hidden = false;
  }
  function creationNext() {
    if (!creation) return;
    const name = $("newAthleteName").value.trim();
    if (!name) {
      creationError("请填写姓名或编号");
      $("newAthleteName").focus();
      return;
    }
    creation.profile = {
      name,
      sex: $("newAthleteSex").value,
      sport: $("newAthleteSport").value.trim(),
      dominantHand: $("newAthleteHand").value,
      sportLevel: $("newAthleteLevel").value.trim(),
    };
    creation.step = "test";
    $("creationError").hidden = true;
    renderCreationStep();
    $("creationDate").focus();
  }
  function creationBack() {
    if (creation) {
      creation.step = "profile";
      renderCreationStep();
      $("newAthleteName").focus();
    }
  }
  async function submitCreation() {
    if (!creation || creation.submitting) return;
    if (creation.step === "profile") return creationNext();
    if (!$("creationDate").value || !$("creationDate").validity.valid)
      return creationError("请填写有效的测试日期");
    if (!Object.values(creation.enabled).some(Boolean))
      return creationError("至少选择一个本次测试项目");
    creation.submitting = true;
    refreshCreationCount();
    try {
      captureReportUI();
      saveEditor();
      if (!await persist()) throw Error("当前修改尚未保存");
      const next = copy(library),
        draft = M.recordFromCatalog(
          next.catalog,
          creation.profile,
          creation.enabled,
          $("creationDate").value,
        );
      let athlete;
      if (creation.kind === "athlete") {
        draft.athleteId = uid();
        draft.recordId = uid();
        athlete = {
          id: draft.athleteId,
          name: creation.profile.name,
          profile: copy(creation.profile),
          sample: false,
          records: [],
        };
        next.athletes.push(athlete);
      } else {
        athlete = next.athletes.find((a) => a.id === creation.ownerId);
        draft.athleteId = athlete.id;
        draft.recordId = uid();
        const priorSummary = M.latestRecord({records:athlete.records.filter(r=>!r.deletedAt)});
        const prior = priorSummary && await repository.loadRecord(priorSummary.recordId);
        draft.trainingContext = copy(prior?.trainingContext || draft.trainingContext);
      }
      draft.evaluationProfileId = $("creationEvaluationProfile")?.value || creation.evaluationProfileId;
      athlete.records.push(window.RingsideStore.summary(draft));
      next.activeAthleteId = athlete.id;
      next.activeRecordId = draft.recordId;
      next.updated = now();
      await repository.save(next, [draft]);
      library = next;
      state = draft;
      storageFailed = false;
      recordBaselines.set(state.recordId, recordContent(state));
      cancelJob();
      if (creation.returnMode === "management") entryReturn = {mode:"management",tab:window.RingsideManagement.tab(),athleteId:creation.returnAthleteId,recordId:creation.returnRecordId};
      creation = null;
      close("newAthleteModal");
      ui.mode = "entry";
      ui.returnMode = "report";
      ui.reportScroll = 0;
      ui.detailOpen = {};
      entryTab = entryTabs().find(([id]) => state.enabled[id])?.[0] || "plan";
      renderReport(false);
      renderEntry();
      renderWorkspace();
      closeMobileSidebar();
      window.scrollTo({ top: 0, behavior: "instant" });
      toast("已创建本次测试，请逐项录入");
      $("entryContent")
        .querySelector("input,select,textarea")
        ?.focus({ preventScroll: true });
      return state.recordId;
    } catch (error) {
      if (creation) {
        creation.submitting = false;
        refreshCreationCount();
      }
      creationError(
        error.name === "QuotaExceededError" || error.name === "SecurityError"
          ? "浏览器保存失败，尚未创建记录。请释放存储空间后重试。"
          : error.message,
      );
    }
  }
  function input(path, value, opts = {}) {
    const type = opts.type || "number";
    const required = path.startsWith("rules.") ? "required" : "";
    const step = path === "data.pushup.reps" ? 1 : "any";
    return `<input type="${type}" ${type === "number" ? `${opts.allowNegative ? "" : `min="${opts.min ?? 0}"`} step="${step}" inputmode="decimal"` : ""} ${required} ${opts.max !== undefined ? `max="${opts.max}"` : ""} value="${E(value)}" data-path="${E(path)}" aria-label="${E(opts.label || pathLabel(path))}" ${opts.placeholder ? `placeholder="${E(opts.placeholder)}"` : ""}>`;
  }
  function select(path, value, options) {
    return `<select data-path="${E(path)}" aria-label="${E(pathLabel(path))}">${options
      .map((x) => {
        const [v, n] = Array.isArray(x) ? x : [x, x];
        return `<option value="${E(v)}" ${String(v) === String(value) ? "selected" : ""}>${E(n)}</option>`;
      })
      .join("")}</select>`;
  }
  function check(path, value, label) {
    return `<label class="row"><input type="checkbox" data-path="${E(path)}" aria-label="${E(label || pathLabel(path))}" ${value ? "checked" : ""}>${E(label)}</label>`;
  }
  function field(label, control, wide = false) {
    return `<label class="field ${wide ? "wide" : ""}"><span>${E(label)}</span>${control}</label>`;
  }
  function pill(label, status = "gray") {
    return `<span class="pill ${E(status)}"><i class="dot"></i>${E(label)}</span>`;
  }
  function table(headers, rows) {
    return `<div class="table-wrap"><table><thead><tr>${headers.map((h) => `<th scope="col">${h}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((v, i) => `<td data-label="${E(headers[i] || "操作")}">${v}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  }
  function supplement(path, value, label) {
    return `<details class="supplement"><summary>${E(label)}</summary><textarea data-path="${E(path)}" rows="2">${E(value)}</textarea></details>`;
  }
  function setPath(path, value) {
    const undo = undoDeletes.get(state.recordId),
      rowIndex = path.match(/^data\.iso\.(\d+)\./);
    if (
      undo?.type === "unit" &&
      rowIndex &&
      state.data.iso[Number(rowIndex[1])]?.id === undo.item.id
    )
      undoDeletes.delete(state.recordId);
    const ps = path.split(".");
    if (ps.some((p) => ["__proto__", "prototype", "constructor"].includes(p)))
      return;
    let obj = state;
    for (const part of ps.slice(0, -1)) {
      if (!obj[part] || typeof obj[part] !== "object") obj[part] = {};
      obj = obj[part];
    }
    obj[ps.at(-1)] = value;
    if (/^definitions\.\d+\.category$/.test(path)) {
      const testId = state.definitions[Number(ps[1])].testId;
      state.definitions
        .filter((d) => d.testId === testId)
        .forEach((d) => (d.category = value));
      const snapshot = state.projectSnapshots?.find((t) => t.id === testId),
        custom = state.customTests.find((t) => t.id === testId);
      if (snapshot) snapshot.category = value;
      if (custom) custom.category = value;
    }
    if (/^athlete\.(name|sex|sport|dominantHand|sportLevel)$/.test(path)) {
      renderSelectors();
    }
    if (/^data\.imtp\.\d+\.timePoints\./.test(path))
      M.syncIMTPLegacy(state.data.imtp[Number(ps[2])]);
    changed();
  }
  function athleteTag(a) {
    let length = 6;
    while (
      library.athletes.some(
        (b) =>
          b.id !== a.id &&
          b.name === a.name &&
          b.id.slice(-length) === a.id.slice(-length),
      )
    )
      length++;
    return a.id.slice(-length);
  }
  function screeningSummary(x) {
    const reasons = x.reasons?.length
      ? x.reasons
      : [x.detail || ""].filter(Boolean);
    return (
      reasons.slice(0, 2).join("；") +
      (reasons.length > 2
        ? `；另有 ${reasons.length - 2} 条结果，见具体数据`
        : "")
    );
  }
  function renderSelectors() {
    if (!library) return;
    const a = activeAthlete(), q = ($("reportAthleteSearch")?.value || "").trim().toLocaleLowerCase(), group = $("reportGroupFilter")?.value || "";
    const groups = $("reportGroupFilter");
    if (groups) groups.innerHTML = '<option value="">全部队伍</option>' + library.groups.map(g=>`<option value="${E(g.id)}" ${g.id===group?"selected":""}>${E(g.name)}</option>`).join("");
    const athletes = library.athletes.filter(x=>!x.deletedAt&&!x.archived&&(!group||x.groupId===group)&&(!q||[x.name,x.profile?.sport].join(" ").toLocaleLowerCase().includes(q)));
    $("athleteSelect").innerHTML = '<option value="">选择运动员</option>' + athletes.map(x=>`<option value="${E(x.id)}" ${x.id===a?.id?"selected":""}>${E(x.name)} · ${E(library.groups.find(g=>g.id===x.groupId)?.name||x.profile?.sport||"未分组")} · ${E(x.id.slice(-6))}</option>`).join("");
    $("recordSelect").innerHTML = '<option value="">选择测试记录</option>' + [...(a?.records||[])].filter(r=>!r.deletedAt&&!r.archived).sort((x,y)=>(y.athlete.date||"").localeCompare(x.athlete.date||"")||y.recordId.localeCompare(x.recordId)).map(r=>`<option value="${E(r.recordId)}" ${r.recordId===state?.recordId?"selected":""}>${E(r.athlete.date||"未填日期")} · ${E(r.title||Object.values(r.enabled).filter(Boolean).length+"个项目 · "+r.recordId.slice(-4))}</option>`).join("");
    $("sampleLabel").classList.toggle("hidden", !state?.demo);
    $("recordContext").textContent = state ? `${a?.name || state.athlete.name} · ${state.athlete.date}` : a ? a.name + " · 暂无测试" : "选择一条测试记录";
    if ($("reportEvaluationLabel")) { const profile=library.evaluationProfiles.find(p=>p.id===state?.evaluationProfileId); $("reportEvaluationLabel").textContent=state ? "评价方案："+(profile?.name||"未关联")+(profile?" · v"+profile.revision:"") : ""; }
  }
  function renderReport(preserveUI = true) {
    if (!state) { renderSelectors(); $("reportNav").innerHTML = ""; renderWorkspace(); return; }
    const visible =
      preserveUI && ui.mode === "report" && !$("reportView").hidden;
    const previousScroll = visible ? window.scrollY : null;
    if (visible) captureReportUI();
    renderSelectors();
    const report = window.RingsideReport.build(effectiveRecord()),
      s = report.stats,
      a = state.athlete;
    $("athleteMeta").innerHTML = [
      a.name || "未命名运动员",
      a.age !== "" && a.age != null ? F(a.age, 0) + " 岁" : null,
      a.sex && a.sex !== "未注明" ? a.sex : null,
      positive(a.mass) ? F(a.mass) + " kg" : null,
      a.sport ? "专项：" + a.sport : null,
      a.dominantHand && a.dominantHand !== "未注明"
        ? "惯用手：" + a.dominantHand
        : null,
      a.stance ? "历史站架：" + a.stance : null,
      a.date,
      a.sportLevel,
      state.demo ? "示例" : null,
    ]
      .filter(Boolean)
      .map((x) => `<span>${E(x)}</span>`)
      .join("");
    $("aggMode").value = state.mode;
    const migrationReasons = [
      ...(state.unitMigration?.reasons || []),
      ...(state.narrative.migrationReview?.reasons || []),
    ];
    $("migrationReviewNotice").hidden = !migrationReasons.length;
    $("migrationReviewNotice").textContent = migrationReasons.length
      ? "旧速度文字待复核：" +
        [...new Set(migrationReasons)].join("；") +
        "。无法可靠换算的人工文字已保留原文，请核对后编辑。"
      : "";
    $("dataCount").textContent =
      s.progress.recorded + " / " + s.progress.planned + " 项已录入";
    $("microCards").innerHTML = window.RingsideReport.summary(report);
    refreshEntryChrome();
    $("bodyChart").innerHTML = V.body(
      s.signals.regions,
      window.RingsideBodyImage,
    );
    const sig = s.signals.signals;
    $("screenPill").className =
      "pill " +
      (sig.some((x) => x.status === "red")
        ? "red"
        : sig.length
          ? "amber"
          : "gray");
    $("screenPill").textContent = sig.length
      ? sig.length + " 项关注"
      : s.validTests.has("iso") || s.validTests.has("fms")
        ? "已录入"
        : "待录入";
    $("screenItems").innerHTML = sig.length
      ? sig
          .slice(0, 3)
          .map(
            (x) =>
              `<div class="screen-item">${pill(x.status === "red" ? "重点关注" : "关注", x.status)}<h4>${E(x.title || x.label)}</h4><p>${E(screeningSummary(x))}</p></div>`,
          )
          .join("") +
        (sig.length > 3
          ? `<a style="font-size:11px" href="#screenDetail">另有 ${sig.length - 3} 项 ↗</a>`
          : "")
      : '<div class="screen-item"><h4>' +
        (s.validTests.has("iso") || s.validTests.has("fms")
          ? "已测项目未触发提示"
          : "等待筛查数据") +
        "</h4><p>查看详细结果与本次测试计划。</p></div>";
    $("radarChart").innerHTML = s.axes.length
      ? V.radar(s.axes)
      : '<div class="empty"><strong>能力结构等待评价</strong>录入结果并配置适用评价目标。</div>';
    $("referenceLabel").textContent = s.axes.length
      ? s.axes.length + " 个能力维度"
      : "待评价";
    $("radarLegend").innerHTML =
      '<span class="red">重点关注</span> · <span class="amber">关注</span> · <span class="green">良好／优秀</span>';
    $("directionMetrics").innerHTML = [
      ["EUR", s.raw.eur, "CMJ / SJ"],
      ["DSI", s.raw.dsi, "CMJ / 等长峰值力"],
      ["ASR", s.raw.asr, "m/s"],
    ]
      .map(
        ([l, v, u]) =>
          `<div class="aux-metric">${l}<strong>${F(v, 2)}</strong>${u}</div>`,
      )
      .join("");
    renderDetails(report);
    renderNarrativeStatus();
    reportDirty = false;
    refreshEntryChrome();
    renderNavigation();
    if (previousScroll !== null)
      window.scrollTo({ top: previousScroll, behavior: "instant" });
  }
  function renderDetails(report) {
    const menus = [...document.querySelectorAll(".multi-select[open]")].map(
      (el) => el.id,
    );
    const focused = document.activeElement?.dataset?.lvpId,
      focusedPath = document.activeElement?.dataset?.path;
    $("detailContent").innerHTML = window.RingsideReport.render(report);
    window.RingsideReport.observeCharts($("detailContent"));
    document.querySelectorAll("#reportView .details-group,#reportView [data-raw-trials]").forEach((el) => {
      if (ui.detailOpen[el.id] !== undefined) el.open = ui.detailOpen[el.id];
    });
    menus.forEach((id) => {
      if ($(id)) $(id).open = true;
    });
    if (focusedPath?.startsWith("views."))
      document.querySelector(`[data-path="${CSS.escape(focusedPath)}"]`)?.focus({ preventScroll: true });
    if (focused)
      document
        .querySelector('[data-lvp-id="' + CSS.escape(focused) + '"]')
        ?.focus({ preventScroll: true });
    if (report.stats.qualityIssues.some((x) => x.id === "asr_inconsistent")) {
      const value = $("directionMetrics").children[2];
      value.insertAdjacentHTML(
        "beforeend",
        ' · <span class="red">待复核</span>',
      );
      value.querySelector("strong").style.color = "var(--gray)";
    }
  }
  function renderNarrativeStatus() {
    if (!state) return;
    renderAIStatus();
    const n = state.narrative,
      stale = n.text && n.basis !== recordBasis();
    const label = n.migrationReview?.required
        ? "旧速度文字待复核"
        : !n.text
          ? "尚未填写"
          : stale
            ? "数据已更新 · 待复核"
            : n.origin === "AI"
              ? "AI稿"
              : "已填写";
    $("interpState").textContent = label;
    $("interpState").className = "pill " + (stale ? "amber" : "gray");
    $("editorState").textContent = job ? "AI正在生成" : label;
    $("interpUpdated").textContent = n.updated
      ? new Date(n.updated).toLocaleString("zh-CN", { hour12: false })
      : "";
    if (document.activeElement !== $("interpEditor"))
      $("interpEditor").innerHTML = M.sanitizeHTML(
        n.html || M.textToHTML(n.text || ""),
      );
    $("narrativeView").innerHTML = n.text
      ? M.sanitizeHTML(n.html || M.textToHTML(n.text))
      : '<div class="empty">本次测试尚未填写解读与建议。</div>';
  }
  function saveEditor() {
    const ed = $("interpEditor");
    if (!ed || ui.mode !== "entry" || entryTab !== "narrative") return;
    const html = M.sanitizeHTML(ed.innerHTML);
    if (html !== state.narrative.html) updateEditor();
  }
  function updateEditor() {
    const ed = $("interpEditor"),
      html = M.sanitizeHTML(ed.innerHTML);
    state.narrative = {
      ...state.narrative,
      html,
      text: ed.innerText,
      updated: now(),
      basis: recordBasis(),
      origin: "manual",
      revision: (state.narrative.revision || 0) + 1,
    };
    changed(false);
  }
  function format(command, value) {
    $("interpEditor").focus();
    document.execCommand(command, false, value || null);
    updateEditor();
  }
  function editableRows(t, headers, fn) {
    const repeat = t !== "lactate", lvp = ["landmine", "squat", "bench", "deadlift"].includes(t);
    return (
      table(
        [...headers, ...(repeat ? ["备注"] : []), ""],
        state.data[t].map((r, i) => [
          ...fn(r, i),
          ...(repeat ? [input(`data.${t}.${i}.notes`, r.notes || "", { type: "text", label: "试次 " + (i + 1) + " 备注" })] : []),
          `${lvp ? `<button type="button" class="btn small" onclick="App.addRow('${t}',${i})">＋ 同负荷试次</button>` : ""}<button class="remove" aria-label="删除此尝试" onclick="App.removeRow('${t}',${i})"><svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18"/></svg></button>`,
        ]),
      ) +
      `<button class="btn small" style="margin-top:12px" onclick="App.addRow('${t}')">＋ ${t === "lactate" ? "增加阶段" : lvp ? "新增负荷" : "新增试次"}</button>`
    );
  }
  function repeatArrayPath(t, isoIndex = -1) {
    return t === "iso" ? `data.iso.${isoIndex}.trials` : ["pushup", "mas", "mss", "ift"].includes(t) ? `data.${t}.trials` : `data.${t}`;
  }
  function atPath(path) { return path.split(".").reduce((value, key) => value?.[key], state); }
  function repeatEditor(t, isoIndex = -1) {
    const rows = M.ensureRepeatRows(state, t, isoIndex), base = repeatArrayPath(t, isoIndex);
    const direction = t === "iso" ? state.data.iso[isoIndex] : null;
    const fields = direction ? (direction.paired ? [["left", "左侧 " + direction.unit], ["right", "右侧 " + direction.unit]] : [["center", "力量 " + direction.unit]])
      : t === "pushup" ? [["reps", "60秒有效次数"]]
      : ["mas", "mss", "ift"].includes(t) ? [["speed", (t === "ift" ? "VIFT" : "速度") + " m/s"], ...(t === "ift" ? [["partial", "末级未完成秒数"]] : [])] : [];
    if (!direction) T.repeatPolicy(state, t).fields.forEach((d) => fields.push(["metrics." + d.id, d.name + " " + d.unit]));
    return `<div class="repeat-entry" data-repeat-entry="${E(t)}">` + table(["试次", ...fields.map((f) => f[1]), ...(direction ? ["疼痛"] : []), "备注", ""], rows.map((row, i) => [
      i + 1,
      ...fields.map(([key, label]) => input(base + "." + i + "." + key, key.startsWith("metrics.") ? row.metrics?.[key.slice(8)] ?? "" : row[key] ?? "", { label: "试次 " + (i + 1) + " " + label, ...(key.startsWith("metrics.") ? { allowNegative: true } : {}) })),
      ...(direction ? [(direction.paired ? ["Left", "Right"] : ["Center"]).map((side) => check(base + "." + i + ".pain" + side, row["pain" + side], side === "Left" ? "左" : side === "Right" ? "右" : "疼痛")).join("")] : []),
      input(base + "." + i + ".notes", row.notes || "", { type: "text", label: "试次 " + (i + 1) + " 备注" }),
      `<button type="button" class="remove" aria-label="删除试次 ${i + 1}" onclick="App.removeRepeat('${E(t)}',${i},${isoIndex})">删除</button>`,
    ])) + `<button type="button" class="btn small" onclick="App.addRepeat('${E(t)}',${isoIndex})">＋ 新增试次</button></div>`;
  }
  function addRepeat(t, isoIndex = -1) {
    const rows = M.ensureRepeatRows(state, t, isoIndex);
    if (rows.length >= 1000) return toast("每组最多保留 1000 次试次");
    rows.push({ id: uid(), metrics: {}, notes: "" });
    changed(false); renderEntry();
    const path = repeatArrayPath(t, isoIndex) + "." + (rows.length - 1);
    $("entryContent").querySelector(`[data-path^="${CSS.escape(path)}."]`)?.focus();
  }
  function removeRepeat(t, index, isoIndex = -1) {
    const arrayPath = repeatArrayPath(t, isoIndex), rows = atPath(arrayPath);
    if (!rows?.[index]) return;
    const prefix = stablePath(arrayPath + "." + index + ".id").replace(/\.id$/, ".");
    undoDeletes.set(state.recordId, { type: "repeat", arrayPath: stablePath(arrayPath), index, item: copy(rows[index]), drafts: copy(Object.fromEntries(Object.entries(draftsFor()).filter(([key]) => key.startsWith(prefix)))) });
    Object.keys(draftsFor()).filter((key) => key.startsWith(prefix)).forEach((key) => delete draftsFor()[key]);
    rows.splice(index, 1); saveDrafts(); changed(false); renderEntry(); toast("已删除，可在底部撤销");
  }
  function speedInput(path, value) {
    return input(path, value ?? "");
  }
  function speedUnitControl() {
    return '<p class="note">速度统一使用 m/s。</p>';
  }
  function openEntry(tab = "athlete") {
    if (!state) return openManagement("records");
    if (ui.mode === "report") captureReportUI();
    saveEditor();
    persist();
    entryTab = tab || "athlete";
    ui.mode = "entry";
    ui.returnMode = "report";
    renderEntry();
    renderWorkspace();
    closeMobileSidebar();
    window.scrollTo({ top: 0, behavior: "instant" });
    focusContentTitle();
  }
  function renderEntry() {
    if (!state) return showReport();
    const all = entryTabs();
    if (!all.some((t) => t[0] === entryTab)) entryTab = "plan";
    renderAIStatus();
    renderEntryNavigation();
    $("narrativeEditorPanel").hidden = entryTab !== "narrative";
    $("entryContent").hidden = entryTab === "narrative";
    rememberUI();
    if (entryTab === "narrative") {
      renderNarrativeStatus();
      refreshEntryChrome();
      return;
    }
    let h = "";
    if (entryTab === "athlete" || entryTab === "plan") h += `<div class="record-evaluation"><label class="field"><span>共用评价方案</span><select id="recordEvaluationSelect" onchange="App.assignRecordProfile(this.value)">${library.evaluationProfiles.filter(p=>!p.disabled||p.id===state.evaluationProfileId).map(p=>`<option value="${E(p.id)}" ${p.id===state.evaluationProfileId?"selected":""}>${E(p.name)}</option>`).join("")}</select></label><button class="btn small" onclick="App.viewEvaluation()">查看生效标准</button></div>`;
    if (entryTab === "athlete") {
      const a = state.athlete;
      h +=
        '<div class="form-grid">' +
        field("姓名 / 编号", input("athlete.name", a.name, { type: "text" })) +
        field("年龄", input("athlete.age", a.age, { max: 100 })) +
        field("性别", select("athlete.sex", a.sex, ["未注明", "男", "女"])) +
        field("体重 kg", input("athlete.mass", a.mass)) +
        field("身高 cm", input("athlete.height", a.height)) +
        field("测试日期", input("athlete.date", a.date, { type: "date" })) +
        field(
          "专项",
          input("athlete.sport", a.sport, { type: "text" }).replace(
            "<input ",
            '<input list="sportOptions" ',
          ),
        ) +
        field(
          "惯用手",
          select("athlete.dominantHand", a.dominantHand, [
            "未注明",
            "右手",
            "左手",
            "双手",
          ]),
        ) +
        field(
          "水平 / 级别",
          input("athlete.sportLevel", a.sportLevel, { type: "text" }),
        ) +
        field("训练周期", input("athlete.cycle", a.cycle, { type: "text" })) +
        field(
          "既往损伤与当前症状",
          `<textarea data-path="athlete.injury">${E(a.injury)}</textarea>`,
          true,
        ) +
        field(
          "补充说明",
          `<textarea data-path="athlete.notes">${E(a.notes)}</textarea>`,
          true,
        ) +
        "</div>" +
        (state.athlete.stance
          ? `<p class="note">历史拳击站架：${E(state.athlete.stance)}。惯用手需单独填写。</p>`
          : "") +
        previousBackground() +
        '<h4 class="subheading">训练背景</h4><div class="form-grid">' +
        field(
          "抗阻训练年限",
          input(
            "trainingContext.experienceYears",
            state.trainingContext.experienceYears,
          ),
        ) +
        field(
          "每周体能训练次数",
          input(
            "trainingContext.weeklySessions",
            state.trainingContext.weeklySessions,
            { max: 14, step: 1 },
          ),
        ) +
        field(
          "可用器械",
          input("trainingContext.equipment", state.trainingContext.equipment, {
            type: "text",
            placeholder: "如：自重、弹力带、哑铃、杠铃、药球、跑道",
          }),
          true,
        ) +
        field(
          "现有周训练安排",
          `<textarea data-path="trainingContext.weeklySchedule">${E(state.trainingContext.weeklySchedule)}</textarea>`,
          true,
        ) +
        "</div>";
    } else if (entryTab === "plan")
      h +=
        '<p class="intro">选择本次项目。停用保留已有数据，当前报告只计算已选项目。</p>' +
        projectPicker(state.enabled) +
        '<button class="btn primary" onclick="App.startEntry()">开始录入</button>';
    else if (entryTab === "fms") {
      h +=
        '<p class="intro">0疼痛、1无法完成、2有代偿完成、3按标准完成。</p>' +
        table(
          ["动作", "L／单项", "R", "疼痛／清除阳性", "部位"],
          state.data.fms.map((x, i) => [
            E(x.name),
            select(
              "data.fms." + i + "." + (x.bilateral ? "left" : "score"),
              x.bilateral ? x.left : x.score,
              [
                ["", "未测"],
                ["0", "0"],
                ["1", "1"],
                ["2", "2"],
                ["3", "3"],
              ],
            ),
            x.bilateral
              ? select("data.fms." + i + ".right", x.right, [
                  ["", "未测"],
                  ["0", "0"],
                  ["1", "1"],
                  ["2", "2"],
                  ["3", "3"],
                ])
              : "—",
            check("data.fms." + i + ".pain", x.pain, ""),
            select("data.fms." + i + ".location", x.location, regionOptions()),
          ]),
        ) +
        state.data.fms
          .map((x, i) =>
            supplement(
              "data.fms." + i + ".notes",
              x.notes,
              x.name + " · 补充观察",
            ),
          )
          .join("");
    } else if (entryTab === "iso") {
      const isoValues = M.stats(effectiveRecord()).isoAnalyses;
      h +=
        '<div class="row"><select id="isoFilter" aria-label="等长力量区域筛选" onchange="App.isoFilter(this.value)"><option value="all">全部区域</option>' +
        Object.entries(M.REG)
          .map(
            ([k, v]) =>
              `<option value="${k}" ${isoFilter === k ? "selected" : ""}>${v}</option>`,
          )
          .join("") +
        '</select><button class="btn small" onclick="App.addIso()">＋ 新增方向</button></div>' +
        table(
          ["部位／方向", "左侧／单项", "右侧", "单位", "评价标准", "疼痛"],
          state.data.iso
            .map((x, i) => ({ x, i }))
            .filter(({ x }) => isoFilter === "all" || x.region === isoFilter)
            .map(({ x, i }) => [
              E(M.REG[x.region] + " · " + x.direction.replace(/[（(]中线[）)]/g, "")) + `<small class="metric-meta">${M.repeatRows(state, "iso", i).length} 次试次</small><button type="button" class="btn small" aria-label="${E(M.REG[x.region] + ' ' + x.direction.replace(/[（(]中线[）)]/g, ''))} 新增试次" onclick="App.addRepeat('iso',${i})">＋ 新增试次</button>`,
              Array.isArray(x.trials) ? F(isoValues[i]?.[x.paired ? "left" : "center"]) : input(
                "data.iso." + i + "." + (x.paired ? "left" : "center"),
                x.paired ? x.left : x.center,
              ),
              x.paired ? Array.isArray(x.trials) ? F(isoValues[i]?.right) : input("data.iso." + i + ".right", x.right) : "—",
              select("data.iso." + i + ".unit", x.unit, ["N", "kgf", "Nm"]),
              `<span class="note">${E(effectiveRecord().data.iso[i].target || "未设目标")} ${E(x.unit)}</span>`,
              Array.isArray(x.trials) ? isoValues[i]?.sides.map((s) => (s.side || "") + (s.pain ? " 疼痛" : " —")).join(" / ") : `<div class="row">${check("data.iso." + i + "." + (x.paired ? "painLeft" : "painCenter"), x.paired ? x.painLeft : x.painCenter, "")}${x.paired ? check("data.iso." + i + ".painRight", x.painRight, "") : ""}</div>`,
            ]),
        ) +
        state.data.iso
          .map((x, i) => ({ x, i }))
          .filter(({ x }) => isoFilter === "all" || x.region === isoFilter)
          .map(({ x, i }) =>
            (Array.isArray(x.trials) ? `<section class="iso-repeat-entry"><h4>${E(M.REG[x.region] + " · " + x.direction.replace(/[（(]中线[）)]/g, ""))}</h4>${repeatEditor("iso", i)}</section>` : "") + supplement(
              "data.iso." + i + ".notes",
              x.notes,
              M.REG[x.region] + " · " + x.direction.replace(/[（(]中线[）)]/g, "") + " · 姿势、固定与补充说明",
            ),
          )
          .join("");
    } else if (["cmj", "sj"].includes(entryTab)) {
      const t = entryTab,
        fields = T.attemptFields(state, t);
      h +=
        '<p class="intro">按最高跳高选择同一次试跳，或按有效试次均值汇总；缺测留空。</p>' +
        field(
          "协议 / 设备",
          input("protocol." + t, state.protocol[t], { type: "text" }),
        ) +
        editableRows(
          t,
          ["尝试", ...fields.map((f) => f.label + " " + f.unit)],
          (row, i) => [
            i + 1,
            ...fields.map((f) =>
              input(
                `data.${t}.${i}.${f.key || "metrics." + f.id}`,
                f.key ? row[f.key] : (row.metrics?.[f.id] ?? ""),
              ),
            ),
          ],
        );
      if (t === "cmj")
        h +=
          '<div class="subheading">DSI数据来源</div><div class="form-grid">' +
          field(
            "等长来源",
            select("dsi.source", state.dsi.source, [
              ["imtp", "IMTP汇总结果"],
              ["manual", "其他全身等长测试"],
            ]),
          ) +
          "</div>" +
          (state.dsi.source === "manual"
            ? '<div class="form-grid">' +
              field("全身等长峰值力 N", input("dsi.force", state.dsi.force)) +
              field(
                "测试名称",
                input("dsi.protocol", state.dsi.protocol, { type: "text" }),
              ) +
              "</div>"
            : '<p class="note">IMTP在独立测试中录入。</p>');
    } else if (entryTab === "imtp") h += imtpForm();
    else if (["landmine", "squat", "bench", "deadlift"].includes(entryTab)) {
      const t = entryTab;
      h +=
        field(
          "协议 / 设备",
          input("protocol." + t, state.protocol[t], { type: "text" }),
        ) +
        editableRows(
          t,
          ["负荷 kg", ...(t === "landmine" ? ["侧别"] : []), "速度 m/s"],
          (x, i) => [
            input("data." + t + "." + i + ".load", x.load),
            ...(t === "landmine"
              ? [
                  select("data.landmine." + i + ".side", x.side, [
                    ["R", "右侧"],
                    ["L", "左侧"],
                  ]),
                ]
              : []),
            input("data." + t + "." + i + ".velocity", x.velocity),
          ],
        );
    } else if (["pushup", "mas", "mss", "ift"].includes(entryTab) && Array.isArray(state.data[entryTab].trials)) {
      h += repeatEditor(entryTab);
      if (entryTab === "ift") h += field("协议", select("data.ift.protocol", state.data.ift.protocol, [["shuttle", "折返协议"], ["treadmill", "跑台改良协议"]]));
      else h += field(entryTab === "pushup" ? "动作标准 / 补充说明" : "方法 / 计时距离 / 设备", input(`data.${entryTab}.${entryTab === "pushup" ? "notes" : "method"}`, state.data[entryTab][entryTab === "pushup" ? "notes" : "method"], { type: "text" }));
    } else if (entryTab === "pushup")
      h +=
        '<div class="form-grid">' +
        field(
          "60秒有效次数",
          input("data.pushup.reps", state.data.pushup.reps),
        ) +
        field(
          "动作标准 / 补充说明",
          input("data.pushup.notes", state.data.pushup.notes, { type: "text" }),
          true,
        ) +
        "</div>";
    else if (entryTab === "mb")
      h +=
        field(
          "协议 / 药球重量",
          input("protocol.mb", state.protocol.mb, { type: "text" }),
        ) +
        editableRows("mb", ["侧别", "距离 m"], (x, i) => [
          select("data.mb." + i + ".side", x.side, [
            ["D", "优势侧"],
            ["ND", "非优势侧"],
          ]),
          input("data.mb." + i + ".distance", x.distance),
        ]);
    else if (entryTab === "lactate")
      h +=
        field(
          "测试协议",
          input("protocol.lactate", state.protocol.lactate, { type: "text" }),
        ) +
        speedUnitControl() +
        editableRows(
          "lactate",
          ["速度 m/s", "乳酸 mmol/L", "心率 bpm"],
          (x, i) => [
            speedInput("data.lactate." + i + ".speed", x.speed),
            input("data.lactate." + i + ".lactate", x.lactate),
            input("data.lactate." + i + ".hr", x.hr),
          ],
        ) +
        '<div class="subheading">个人阈值</div><div class="form-grid">' +
        field(
          thresholdLabel("lt1") + " m/s",
          speedInput("thresholds.lt1", state.thresholds.lt1),
        ) +
        field(
          thresholdLabel("lt2") + " m/s",
          speedInput("thresholds.lt2", state.thresholds.lt2),
        ) +
        field(
          "识别方法",
          input("thresholds.method", state.thresholds.method, { type: "text" }),
        ) +
        "</div>";
    else if (entryTab === "ift")
      h +=
        speedUnitControl() +
        '<div class="form-grid">' +
        field(
          "协议",
          select("data.ift.protocol", state.data.ift.protocol, [
            ["shuttle", "折返协议"],
            ["treadmill", "跑台改良协议"],
          ]),
        ) +
        field("VIFT m/s", speedInput("data.ift.speed", state.data.ift.speed)) +
        field(
          "末级未完成秒数",
          input("data.ift.partial", state.data.ift.partial, { max: 30 }),
        ) +
        "</div>";
    else if (["mas", "mss"].includes(entryTab)) {
      const t = entryTab;
      h +=
        speedUnitControl() +
        '<div class="form-grid">' +
        field(
          M.TESTS.find((x) => x[0] === t)[1] + " m/s",
          speedInput("data." + t + ".speed", state.data[t].speed),
        ) +
        field(
          "方法 / 计时距离 / 设备",
          input("data." + t + ".method", state.data[t].method, {
            type: "text",
          }),
          true,
        ) +
        "</div>";
    }
    else if (!T.registry.has(entryTab) && T.repeatPolicy(state, entryTab).fields.length) h += repeatEditor(entryTab);
    if (["pushup", "mas", "mss", "ift"].includes(entryTab) && !Array.isArray(state.data[entryTab].trials)) {
      h += T.repeatPolicy(state, entryTab).fields.map((d) => field(d.name + " " + d.unit, input(`data.${entryTab}.metrics.${d.id}`, state.data[entryTab].metrics?.[d.id] ?? "", { allowNegative: true }))).join("");
      h += `<button type="button" class="btn small" onclick="App.addRepeat('${entryTab}')">＋ 新增试次</button>`;
    }
    const extras = state.definitions.filter(
      (d) =>
        T.isManualMetric(d) && !T.isAttemptMetric(d) && d.testId === entryTab,
    );
    if (extras.length)
      h +=
        '<div class="subheading">自定义指标</div>' +
        table(
          ["指标", "结果", "单位"],
          extras.map((d) => [
            E(d.name),
            input(
              "customValues." + d.id + ".value",
              state.customValues[d.id]?.value ?? "",
            ),
            E(d.unit),
          ]),
        ) +
        extras
          .map((d) =>
            supplement(
              "customValues." + d.id + ".notes",
              state.customValues[d.id]?.notes || "",
              d.name + " · 补充说明",
            ),
          )
          .join("");
    if (["cmj","imtp"].includes(entryTab)) {
      const key=entryTab==="cmj"?"cmjConfig":"imtpConfig";
      h='<div class="form-grid">'+field("设备输出力定义",select(key+".definition",state[key].definition,[["gross","总力"],["net","净力"]]))+'</div>'+h;
      if(entryTab==="cmj")h+=check("dsi.confirmed",state.dsi.confirmed,"确认 CMJ 与等长测试的力定义、单位及协议可比较")+(state.dsi.source==="manual"?field("其他等长力定义",select("dsi.definition",state.dsi.definition,[["gross","总力"],["net","净力"]])):"");
    }
    if (["landmine","squat","bench","deadlift"].includes(entryTab)) {
      const keys=entryTab==="landmine"?["landmineL","landmineR"]:[entryTab];
      h='<div class="form-grid">'+keys.map(id=>field((id==="landmineL"?"左侧 ":id==="landmineR"?"右侧 ":"")+"设备速度口径",select("lvp."+id+".metric",state.lvp[id].metric,[["MV","平均速度 MV"],["MPV","平均推进速度 MPV"],["PV","峰值速度 PV"]]))).join("")+'</div>'+h;
    }
    if(entryTab==="iso")h+='<details class="supplement"><summary>关节配对测量确认</summary>'+state.balancePairs.map((p,i)=>check("balancePairs."+i+".confirmed",p.confirmed,E(p.label)+" · 测量口径、单位与协议可比较")).join("")+'</details>';
    $("entryContent").innerHTML = h;
    $("entryContent")
      .querySelectorAll("table")
      .forEach((t) => t.classList.add("entry-table"));
    if (entryTab === "imtp") updateForceWarnings();
    applyInputDrafts($("entryContent"));
    $("entryContent")
      .querySelectorAll("textarea[data-path]")
      .forEach((el) =>
        el.setAttribute("aria-label", pathLabel(el.dataset.path)),
      );
    refreshEntryChrome();
  }
  function regionOptions() {
    return [
      ["", "未指定"],
      ["neck", "颈"],
      ...["shoulder", "hip", "knee", "ankle"].flatMap((k) => [
        [k + "_l", "左" + M.REG[k]],
        [k + "_r", "右" + M.REG[k]],
      ]),
    ];
  }
  function previousBackground() {
    const a = activeAthlete(),
      records = a.records.filter(
        (r) =>
          r.recordId !== state.recordId &&
          (r.athlete.date || "") <= (state.athlete.date || ""),
      );
    const prior = M.latestRecord({ records });
    if (!prior) return "";
    return `<details class="supplement"><summary>查看上次背景 · ${E(prior.athlete.date)}</summary><p class="note">${
      [
        ["年龄", prior.athlete.age],
        ["体重 kg", prior.athlete.mass],
        ["身高 cm", prior.athlete.height],
        ["周期", prior.athlete.cycle],
        ["症状", prior.athlete.injury],
      ]
        .filter(([, v]) => v !== "" && v != null)
        .map(([k, v]) => E(k + "：" + v))
        .join("；") || "上次未填写背景"
    }</p></details>`;
  }
  function startEntry() {
    const first = allProjects().find((t) => state.enabled[t.id]);
    if (!first) return toast("至少选择一个本次测试项目");
    window.App.entry(first.id);
    $("entryContent")
      .querySelector("input,select,textarea")
      ?.focus({ preventScroll: true });
  }
  function moveEntry(direction) {
    const tabs = entryTabs(),
      index = tabs.findIndex((t) => t[0] === entryTab),
      next = tabs[index + direction];
    if (next) window.App.entry(next[0]);
  }
  function rowFocus(path) {
    const control =
      document.querySelector(`[data-path="${CSS.escape(path)}"]`) ||
      $("entryContent").querySelector("input,select,button");
    control?.focus({ preventScroll: true });
    control?.scrollIntoView({ block: "nearest" });
  }
  function rememberDeletion(type, test, index) {
    const array =
      type === "point" ? state.data.imtp[test].timePoints : state.data[test];
    const prefix =
      type === "point"
        ? stablePath(`data.imtp.${test}.timePoints.${index}.force`).replace(
            /\.force$/,
            ".",
          )
        : stablePath(`data.${test}.${index}.id`).replace(/\.id$/, ".");
    undoDeletes.set(state.recordId, {
      type,
      test,
      index,
      item: copy(array[index]),
      drafts: copy(
        Object.fromEntries(
          Object.entries(draftsFor()).filter(([k]) => k.startsWith(prefix)),
        ),
      ),
    });
    Object.keys(draftsFor())
      .filter((k) => k.startsWith(prefix))
      .forEach((k) => delete draftsFor()[k]);
    saveDrafts();
  }
  function removeRow(t, i) {
    if (!state.data[t]?.[i]) return;
    rememberDeletion("row", t, i);
    state.data[t].splice(i, 1);
    persist();
    renderEntry();
    reportDirty = true;
    rowFocus(
      `data.${t}.${Math.min(i, state.data[t].length - 1)}.${t === "cmj" || t === "sj" ? "height" : "load"}`,
    );
    toast("已删除，可在底部撤销");
  }
  function undoDelete() {
    const undo = undoDeletes.get(state.recordId);
    if (!undo) return;
    if (undo.type === "unit") {
      const row = state.data.iso.find((r) => r.id === undo.item.id);
      if (row) Object.assign(row, undo.item);
      (undo.pairStates || []).forEach((prior) => {
        const pair = state.balancePairs.find((p) => p.id === prior.id);
        if (pair && pair.confirmed === false) pair.confirmed = prior.confirmed;
      });
    } else {
      const array =
        undo.type === "repeat" ? atPath(resolveDraftPath(undo.arrayPath) || "") : undo.type === "point"
          ? state.data.imtp[undo.test]?.timePoints
          : state.data[undo.test];
      if (!array) return;
      array.splice(Math.min(undo.index, array.length), 0, undo.item);
      if (undo.type === "point") M.syncIMTPLegacy(state.data.imtp[undo.test]);
    }
    inputDrafts[draftRecordKey()] = { ...draftsFor(), ...undo.drafts };
    saveDrafts();
    undoDeletes.delete(state.recordId);
    persist();
    renderEntry();
    reportDirty = true;
    const first = Object.keys(undo.drafts)[0];
    if (first) rowFocus(resolveDraftPath(first) || "");
    else if (undo.type === "unit")
      rowFocus(
        `data.iso.${state.data.iso.findIndex((r) => r.id === undo.item.id)}.left`,
      );
    else if (undo.type === "repeat")
      rowFocus((resolveDraftPath(undo.arrayPath) || "") + "." + undo.index + "." + (Object.keys(undo.item).find((key) => !["id", "metrics", "notes"].includes(key)) || "notes"));
    else if (undo.type === "point")
      rowFocus(`data.imtp.${undo.test}.timePoints.${undo.index}.force`);
    else
      rowFocus(
        `data.${undo.test}.${undo.index}.${Object.keys(undo.item).find((k) => k !== "id") || "id"}`,
      );
    toast(undo.type === "unit" ? "已撤销单位修改" : "已撤销删除");
  }
  function requestMetricUnit(control, id) {
    const metric = definition(id),
      next = control.value.trim();
    control.value = metric.unit;
    if (next === metric.unit) return;
    if (!next || /km\s*\/?\s*h|kmph|kph|公里|千米/i.test(next))
      return toast("请填写有效单位；速度统一使用 m/s");
    if (hasMetricDraft(id)) return toast("请先处理此指标尚未保存的修改");
    const convertible = M.unitFactor(metric.unit, next) !== null;
    unitChange = {
      kind: "metric",
      id,
      recordId: state.recordId,
      from: metric.unit,
      to: next,
      convertible,
    };
    $("unitConvertButton").hidden = !convertible;
    $("unitChangeMessage").textContent =
      metric.name +
      "：" +
      metric.unit +
      " → " +
      next +
      "。" +
      (convertible
        ? "换算将同步处理结果、评价目标与等级区间。"
        : "无法可靠换算，需要清空结果、评价目标与等级区间后重新录入。");
    modal("unitModal");
  }
  function hasMetricDraft(id) {
    return Object.keys(draftsFor()).some(
      (key) =>
        key.startsWith("customValues." + id + ".") ||
        key.startsWith("definitions.@" + id + ".") ||
        key.endsWith(".metrics." + id) ||
        key === "editRanges." + id,
    );
  }
  function requestCatalogUnit() {
    if (!catalogEdit?.unit) return;
    const control = $("catalogUnit"),
      next = control.value.trim(),
      from = catalogEdit.unit;
    control.value = from;
    if (next === from) return;
    try {
      if (!next || /km\s*\/?\s*h|kmph|kph|公里|千米/i.test(next))
        throw Error("请填写有效单位；速度统一使用 m/s");
      const target = $("catalogTarget").value,
        error = M.validateField(state, "definitions.0.target", target);
      if (error) throw Error("请先修正评价目标：" + error);
      const existing = library.catalog.definitions.find(
        (d) => d.id === catalogEdit.definitionId,
      );
      const metric = {
        ...copy(existing),
        unit: from,
        target: target === "" ? null : Number(target),
        ranges: Def.parseRanges($("catalogRanges").value),
      };
      unitChange = {
        kind: "catalog",
        id: metric.id,
        from,
        to: next,
        convertible: M.unitFactor(from, next) !== null,
        metric,
      };
      $("unitConvertButton").hidden = !unitChange.convertible;
      $("unitChangeMessage").textContent =
        metric.name +
        "：" +
        from +
        " → " +
        next +
        "。" +
        (unitChange.convertible
          ? "将换算表单中的评价目标和区间；已有测试记录保持各自的定义。"
          : "无法可靠换算，需要清空表单中的评价目标和区间后重录；已有测试记录保持各自的定义。");
      modal("unitModal");
    } catch (error) {
      $("catalogError").textContent = error.message;
      $("catalogError").hidden = false;
    }
  }
  function requestUnitChange(control, index) {
    const row = state.data.iso[index],
      next = control.value;
    control.value = row.unit;
    if (next === row.unit) return;
    const prefix = stablePath(`data.iso.${index}.left`).replace(/\.left$/, ".");
    if (Object.keys(draftsFor()).some((k) => k.startsWith(prefix)))
      return toast("请先修正此方向的错误输入，再修改单位");
    const convertible =
      ["N", "kgf"].includes(row.unit) && ["N", "kgf"].includes(next);
    unitChange = { id: row.id, from: row.unit, to: next, convertible };
    $("unitConvertButton").hidden = !convertible;
    $("unitChangeMessage").textContent = convertible
      ? `${row.direction}：${row.unit} → ${next}。换算将同步处理左侧、右侧、中线与目标（1 kgf = 9.80665 N）；也可清空后重录。`
      : `${row.direction}：${row.unit} → ${next}。力与力矩无法直接换算，必须清空该方向结果与目标后重新录入。`;
    modal("unitModal");
  }
  function confirmUnitChange(action) {
    if (!unitChange || (action === "convert" && !unitChange.convertible))
      return;
    if (unitChange.kind === "catalog") {
      if (!catalogEdit) return close("unitModal");
      let updated;
      try {
        updated = M.changeMetricUnit(
          { definitions: [unitChange.metric], customValues: {} },
          unitChange.id,
          unitChange.to,
          action,
        ).definitions[0];
      } catch (error) {
        return toast(error.message);
      }
      catalogEdit.unit = updated.unit;
      catalogEdit.unitReferenceEnabled = updated.referenceEnabled;
      $("catalogUnit").value = updated.unit;
      $("catalogTarget").value = updated.target ?? "";
      $("catalogRanges").value = Def.rangeText(updated.ranges);
      close("unitModal");
      return;
    }
    if (unitChange.kind === "metric") {
      if (unitChange.recordId !== state.recordId) return close("unitModal");
      let updated;
      try {
        updated = M.changeMetricUnit(
          state,
          unitChange.id,
          unitChange.to,
          action,
        );
      } catch (error) {
        return toast(error.message);
      }
      state.definitions = updated.definitions;
      state.customValues = updated.customValues;
      if (updated.data) state.data = updated.data;
      close("unitModal");
      unitChange = null;
      changed(false);
      renderSettings();
      toast(
        action === "convert"
          ? "已换算结果与评价标准"
          : "已清空，请按新单位重新录入",
      );
      return;
    }

    const row = state.data.iso.find((r) => r.id === unitChange.id);
    if (!row) return close("unitModal");
    undoDeletes.set(state.recordId, {
      type: "unit",
      item: copy(row),
      pairStates:
        action === "convert"
          ? []
          : state.balancePairs
              .filter(
                (p) => p.numeratorId === row.id || p.denominatorId === row.id,
              )
              .map((p) => ({ id: p.id, confirmed: p.confirmed })),
      drafts: {},
    });
    const factor = unitChange.from === "N" ? 1 / 9.80665 : 9.80665;
    ["left", "right", "center", "target"].forEach((k) => {
      if (row[k] !== "" && row[k] != null)
        row[k] = action === "convert" ? Number(row[k]) * factor : "";
    });
    (row.trials || []).forEach((trial) => ["left", "right", "center"].forEach((key) => {
      if (N(trial[key]) !== null) trial[key] = action === "convert" ? N(trial[key]) * factor : "";
    }));
    row.unit = unitChange.to;
    if (action !== "convert")
      state.balancePairs
        .filter((p) => p.numeratorId === row.id || p.denominatorId === row.id)
        .forEach((p) => (p.confirmed = false));
    close("unitModal");
    persist();
    renderEntry();
    reportDirty = true;
    toast(
      action === "convert"
        ? "数值与目标已换算，可撤销"
        : "对应测量已清空，请重新录入；可撤销",
    );
  }
  function addRow(t, groupIndex = -1) {
    const templates = {
      cmj: {
        height: "",
        force: "",
        rsiModified: "",
        landingPeakForce: "",
        metrics: {},
      },
      sj: {
        height: "",
        force: "",
        rsiModified: "",
        landingPeakForce: "",
        metrics: {},
      },
      imtp: {
        peakForce: "",
        f100: "",
        f200: "",
        rfd100: "",
        rfd200: "",
        baselineForce: "",
        peakTimeMs: "",
        timePoints: [],
      },
      landmine: { load: "", side: "R", velocity: "" },
      squat: { load: "", velocity: "" },
      bench: { load: "", velocity: "" },
      deadlift: { load: "", velocity: "" },
      mb: { side: "D", distance: "" },
      lactate: { speed: "", lactate: "", hr: "" },
    };
    const group = state.data[t][groupIndex];
    state.data[t].push({ id: uid(), ...templates[t], ...(group && ["landmine", "squat", "bench", "deadlift"].includes(t) ? { load: group.load, ...(t === "landmine" ? { side: group.side } : {}) } : {}) });
    persist();
    renderEntry();
    renderReport();
    rowFocus(
      `data.${t}.${state.data[t].length - 1}.${Object.keys(templates[t])[0]}`,
    );
  }
  function addIso() {
    const region = prompt(
      "区域：neck / shoulder / hip / knee / ankle",
      isoFilter === "all" ? "shoulder" : isoFilter,
    );
    if (!M.REG[region]) return;
    const direction = prompt("测试方向或姿势名称");
    if (!direction?.trim()) return;
    state.data.iso.push({
      id: uid(),
      region,
      direction: direction.trim(),
      directionCode: "custom_" + uid(),
      paired: true,
      left: "",
      right: "",
      center: "",
      unit: "N",
      target: "",
      painLeft: false,
      painRight: false,
      notes: "",
    });
    persist();
    renderEntry();
    renderReport();
  }
  function openSettings(tab = "ai") {
    if (tab === "catalog") return openManagement("catalog");
    if (!["ai", "references"].includes(tab)) return openManagement("profiles");
    if (ui.mode === "report") captureReportUI();
    saveEditor();
    persist();
    if (ui.mode !== "settings") ui.returnMode = ui.mode;
    ui.mode = "settings";
    settingsTab = tab;
    renderSettings();
    renderWorkspace();
    closeMobileSidebar();
    window.scrollTo({ top: 0, behavior: "instant" });
    focusContentTitle();
  }
  function renderSettings() {
    if (ui.mode === "management") { window.RingsideManagement.render(); return; }
    const component = window.RingsideSettings.render({
      state: state || M.defaults(),
      library,
      settingsTab,
      selectedDef,
      apiURL,
      key,
      model,
      controls: { E, input, select, field, check, table, regionOptions },
    });
    selectedDef = component.selectedDef;
    const scope =
      window.RingsideSettings.scopes[
        window.RingsideSettings.scopeFor(settingsTab)
      ];
    $("settingsTitle").textContent = scope.title;
    $("settingsIntro").textContent = scope.note;
    $("settingsContent").innerHTML = component.html;
    const ranges = $("rangesText");
    if (ranges) {
      ranges.dataset.editDraft = "editRanges." + selectedDef;
      ranges.setAttribute("aria-label", "本次指标评价区间");
    }
    document.querySelectorAll('[id^="balanceRanges-"]').forEach((el) => {
      el.dataset.editDraft =
        "editBalance." + state.balancePairs[Number(el.id.split("-")[1])].id;
      el.setAttribute("aria-label", "关节平衡评价区间");
    });
    document.querySelectorAll('[id^="zones-"]').forEach((el) => {
      el.dataset.editDraft = "editZones." + el.id.slice(6);
      el.setAttribute("aria-label", "LVP素质区间 m/s");
    });
    applyInputDrafts($("settingsContent"));
    refreshEntryChrome();
    renderNavigation();
    renderAIStatus();
    rememberUI();
  }
  function saveRanges() {
    try {
      const d = definition(selectedDef),
        old = d.ranges;
      d.ranges = Def.parseRanges($("rangesText").value).map((r) => ({
        ...r,
        advantage: old.some((o) => o.label === r.label && o.advantage),
      }));
      forgetInputError($("rangesText").dataset.editDraft);
      persist();
      renderReport();
      renderSettings();
      toast("评价区间已保存");
    } catch (e) {
      rememberEditDraft($("rangesText"), e.message);
      toast(e.message);
    }
  }
  function saveBalanceRanges(i) {
    try {
      state.balancePairs[i].ranges = Def.parseRanges(
        $("balanceRanges-" + i).value,
      );
      forgetInputError($("balanceRanges-" + i).dataset.editDraft);
      inputIssue($("balanceRanges-" + i));
      persist();
      renderReport();
      toast("关节比值评价已保存");
    } catch (e) {
      toast(e.message);
    }
  }
  function addBalance() {
    const rows = state.data.iso;
    if (rows.length < 2) return;
    state.balancePairs.push({
      id: uid(),
      label: "自定义关节平衡",
      region: rows[0].region,
      numeratorId: rows[0].id,
      denominatorId: rows[1].id,
      confirmed: false,
      referenceEnabled: false,
      ranges: [],
      source: "",
    });
    persist();
    renderSettings();
  }
  function saveZones(id) {
    try {
      const zones = $("zones-" + id)
        .value.split("\n")
        .filter((l) => l.trim())
        .map((l) => {
          const [range, ...label] = l.split("|"),
            m = range.trim().match(/^(\d+(?:\.\d+)?)\.\.(\d+(?:\.\d+)?)$/);
          if (!m || Number(m[1]) >= Number(m[2]) || !label.join("|").trim())
            throw Error("请使用：速度下限..上限 | 素质名称");
          return {
            min: Number(m[1]),
            max: Number(m[2]),
            label: label.join("|").trim(),
          };
        });
      for (let i = 0; i < zones.length; i++)
        for (let j = i + 1; j < zones.length; j++)
          if (
            Math.max(zones[i].min, zones[j].min) <
            Math.min(zones[i].max, zones[j].max)
          )
            throw Error("素质区间不能重叠");
      state.lvp[id].zones = zones;
      forgetInputError($("zones-" + id).dataset.editDraft);
      inputIssue($("zones-" + id));
      persist();
      renderReport();
      toast("素质区间已保存");
    } catch (e) {
      rememberEditDraft($("balanceRanges-" + i), e.message);
      rememberEditDraft($("zones-" + id), e.message);
      toast(e.message);
    }
  }
  function addTest() {
    openSettings("catalog");
    openCatalogItem("new-test");
  }
  function addDefinition(testId, name) {
    openSettings("catalog");
    openCatalogItem("new-metric", testId || definition(selectedDef)?.testId);
  }
  // Insert inside the App closure; expose the five public handlers on App.
  function openCatalogItem(mode = "new-test", testId = "", definitionId = "") {
    const projectOnlyRequested = mode === "edit-project", metricOnly = mode === "edit" && !!definitionId;
    if (projectOnlyRequested) mode = "edit";
    mode =
      mode === "test" ? "new-test" : mode === "metric" ? "new-metric" : mode;
    if (!["new-test", "new-metric", "edit"].includes(mode)) return false;
    const catalog = library.catalog;
    if (
      testId &&
      catalog.conflicts.some(
        (conflict) => conflict.testId === testId && !conflict.resolved,
      )
    )
      return false;
    const test = catalog.tests.find((item) => item.id === testId);
    if (mode === "edit" && !test) return false;
    const definition =
      mode === "edit" && !projectOnlyRequested
        ? catalog.definitions.find((d) =>
            definitionId
              ? d.id === definitionId && d.testId === testId
              : d.testId === testId,
          )
        : null;
    const projectOnly = mode === "edit" && !definition;
    const selectedTest =
      test ||
      catalog.tests.find(
        (item) =>
          !catalog.conflicts.some(
            (conflict) => conflict.testId === item.id && !conflict.resolved,
          ),
      );
    const initialProtocol = (mode === "new-metric" ? selectedTest : test)
      ? catalog.protocol[(mode === "new-metric" ? selectedTest : test).id] || ""
      : "";
    catalogEdit = {
      mode,
      testId: test?.id || "",
      definitionId: definition?.id || "",
      initialProtocol,
      projectOnly,
      submitting: false,
      unit: definition && T.isManualMetric(definition) ? definition.unit : null,
    };
    const category = definition?.category || test?.category || "performance";
    const builtIn = !!definition && !T.isManualMetric(definition);
    const label = (name, control, wide = false) =>
      `<label class="field${wide ? " wide" : ""}"><span>${name}</span>${control}</label>`;
    let fields = '<div class="form-grid">';
    if (mode === "new-metric") {
      fields += label(
        "所属测试项目",
        `<select id="catalogTestId" aria-label="所属测试项目" required>${catalog.tests
          .filter(
            (item) =>
              !catalog.conflicts.some(
                (conflict) => conflict.testId === item.id && !conflict.resolved,
              ),
          )
          .map(
            (item) =>
              `<option value="${E(item.id)}" ${item.id === selectedTest?.id ? "selected" : ""}>${E(item.name)}</option>`,
          )
          .join("")}</select>`,
      );
      fields += `<input id="catalogTestName" type="hidden" value="${E(selectedTest?.name || "")}">`;
    } else {
      fields += `<input id="catalogTestId" type="hidden" value="${E(test?.id || "")}">`;
      fields += label(
        "测试项目名称",
        `<input id="catalogTestName" value="${E(test?.name || "")}" aria-label="测试项目名称" required maxlength="120" ${test && M.TESTS.some((t) => t[0] === test.id) ? "readonly" : ""} data-initial-focus>`,
      );
    }
    if (!projectOnly) {
      fields += label(
        "指标名称",
        `<input id="catalogMetricName" value="${E(definition?.name || "")}" aria-label="指标名称" required maxlength="120" ${mode === "new-metric" ? "data-initial-focus" : ""}>`,
      );
      fields += label(
        "单位",
        `<input id="catalogUnit" value="${E(definition?.unit || "")}" aria-label="单位" list="catalogUnits" ${builtIn ? "" : "required"} maxlength="30" ${builtIn ? "readonly" : ""}><datalist id="catalogUnits">${["m/s", "N", "Nm", "kgf", "N/kg", "N/s", "kg", "kg/kg", "cm", "m", "次", "比值", "分", "mmol/L", "bpm", "s"].map((unit) => `<option value="${unit}"></option>`).join("")}</datalist>`,
      );
      fields += label(
        "能力分类（可留空）",
        `<input id="catalogAbility" value="${E(definition?.ability || "")}" aria-label="能力分类" maxlength="120" placeholder="留空归入未分类">`,
      );
    }
    fields += label(
      projectOnly ? "项目分组" : "报告分类",
      `<select id="catalogCategory" aria-label="${projectOnly ? "项目分组" : "报告分类"}" required><option value="performance" ${category === "performance" ? "selected" : ""}>运动表现</option><option value="screen" ${category === "screen" ? "selected" : ""}>筛查</option></select>`,
    );
    if (!projectOnly) {
      fields += label(
        "评价方向",
        `<select id="catalogDirection" aria-label="评价方向" required><option value="higher" ${definition?.direction !== "lower" ? "selected" : ""}>数值越高越好</option><option value="lower" ${definition?.direction === "lower" ? "selected" : ""}>数值越低越好</option></select>`,
      );
      fields += label(
        "评价目标（可留空）",
        `<input id="catalogTarget" type="number" step="any" min="0" value="${E(definition?.target ?? "")}" aria-label="评价目标">`,
      );
    }
    if (!projectOnly)
      fields += label(
        "录入层级",
        `<select id="catalogEntryScope" aria-label="录入层级" ${definition ? "disabled" : ""}><option value="record">本次测试汇总</option><option value="attempt" ${definition?.entryScope === "attempt" || mode === "new-test" || (mode === "new-metric" && !T.registry.has(selectedTest?.id)) ? "selected" : ""}>每次试次</option></select>`,
      );
    if (!projectOnly && !builtIn) fields += label("变异系数 CV", `<label class="row"><input id="catalogCVEligible" type="checkbox" ${definition?.cvEligible === true ? "checked" : ""}>该指标有真实零点，适合计算 CV</label>`);
    if (mode !== "new-metric" && !T.registry.has(test?.id || "")) {
      const candidates = catalog.definitions.filter((d) => d.testId === test?.id && T.isAttemptMetric(d));
      fields += label("最佳试次主指标", `<select id="catalogPrimaryMetric" aria-label="最佳试次主指标"><option value="">首个试次指标</option>${candidates.map((d) => `<option value="${E(d.id)}" ${test?.primaryMetricId === d.id ? "selected" : ""}>${E(d.name)}</option>`).join("")}</select>`);
    }
    const primary =
      T.describe(catalog).find((item) => item.id === test?.id)
        ?.primaryAbility || "";
    const abilities = [
      ...new Set(
        catalog.definitions
          .filter((d) => d.testId === test?.id)
          .map((d) => T.abilityName(d.ability))
          .filter(Boolean),
      ),
    ];
    if (mode !== "new-metric")
      fields += label(
        "主能力（项目分组）",
        `<select id="catalogPrimaryAbility" aria-label="主能力"><option value="">自动采用首个能力</option>${abilities.map((ability) => `<option value="${E(ability)}" ${primary === ability ? "selected" : ""}>${E(ability)}</option>`).join("")}</select>`,
      );
    fields += label(
      "项目测试协议／设备",
      `<textarea id="catalogProtocol" rows="3" aria-label="项目测试协议／设备">${E(initialProtocol)}</textarea>`,
      true,
    );
    if (!projectOnly)
      fields += label(
        "评价区间（可留空）：范围 | 等级 | red / amber / green",
        `<textarea id="catalogRanges" rows="5" aria-label="评价区间" placeholder="例如：&lt;40 | 待提升 | red">${E(Def.rangeText(definition?.ranges || []))}</textarea>`,
        true,
      );
    fields +=
      '</div><p class="note">速度统一使用 m/s。保存后可在本次测试计划中选择该项目。</p>';
    $("catalogFields").innerHTML = fields;
    for (const id of ["catalogTarget","catalogRanges","catalogDirection", ...(metricOnly ? ["catalogTestName","catalogCategory","catalogProtocol","catalogPrimaryAbility","catalogPrimaryMetric"] : [])]) { const el=$(id);if(el) el.closest(".field").hidden=true; }
    $("catalogTitle").textContent =
      mode === "new-test"
        ? "新建测试项目"
        : mode === "new-metric"
          ? "新增指标"
          : projectOnly
            ? "编辑项目设置"
            : "编辑项目与指标";
    $("catalogError").hidden = true;
    $("catalogError").textContent = "";
    $("catalogForm").querySelector('[type="submit"]').disabled = false;
    if (catalogEdit.unit)
      $("catalogUnit").addEventListener("change", requestCatalogUnit);
    const updateScope = () => {
      const control = $("catalogEntryScope");
      if (!control) return;
      const supported = T.supportsAttemptMetrics($("catalogTestId").value);
      control.querySelector('[value="attempt"]').disabled = !supported;
      if (!supported) control.value = "record";
    };
    updateScope();
    if (mode === "new-metric")
      $("catalogTestId").addEventListener("change", updateScope);
    if (mode === "new-metric")
      $("catalogTestId").addEventListener("change", (event) => {
        const item = catalog.tests.find(
          (candidate) => candidate.id === event.target.value,
        );
        if (!item) return;
        $("catalogTestName").value = item.name;
        if ($("catalogProtocol").value === catalogEdit.initialProtocol)
          $("catalogProtocol").value = catalog.protocol[item.id] || "";
        catalogEdit.initialProtocol = catalog.protocol[item.id] || "";
        $("catalogCategory").value = item.category;
      });
    modal("catalogModal");
    const firstField =
      mode === "new-metric" ||
      (mode === "edit" && definition && M.TESTS.some((t) => t[0] === testId))
        ? "catalogMetricName"
        : projectOnly && M.TESTS.some((t) => t[0] === testId)
          ? "catalogCategory"
          : "catalogTestName";
    $(firstField)?.focus();
    return true;
  }

  async function submitCatalogItem() {
    if (!catalogEdit || catalogEdit.submitting) return false;
    if (
      catalogEdit.unit &&
      $("catalogUnit").value.trim() !== catalogEdit.unit
    ) {
      requestCatalogUnit();
      return false;
    }
    const form = $("catalogForm");
    if (!form.reportValidity()) return false;
    const edit = catalogEdit,
      catalog = copy(library.catalog);
    try {
      const value = (id) => ($(id)?.value || "").trim();
      const testId =
        edit.mode === "new-test" ? "custom_" + uid() : value("catalogTestId");
      let test = catalog.tests.find((item) => item.id === testId);
      if (
        edit.mode !== "new-test" &&
        (!test ||
          catalog.conflicts.some(
            (conflict) => conflict.testId === testId && !conflict.resolved,
          ))
      )
        throw Error("请选择已确认定义的测试项目");
      const testName =
        edit.mode === "new-metric" ? test.name : value("catalogTestName");
      const category = value("catalogCategory"),
        protocol = value("catalogProtocol");
      if (!testName) throw Error("请填写测试项目名称");
      if (!["screen", "performance"].includes(category))
        throw Error("请选择报告分类");
      if (edit.mode === "new-test") {
        test = { id: testId, name: testName, category };
        catalog.tests.push(test);
      } else if (edit.mode === "edit") {
        test.name = testName;
        test.category = category;
      }
      if (!edit.projectOnly) {
        const name = value("catalogMetricName"),
          ability = value("catalogAbility"),
          direction = value("catalogDirection");
        const existing = catalog.definitions.find(
          (d) => d.id === edit.definitionId,
        );
        let unit = value("catalogUnit");
        if (!name || (!unit && !(existing && !T.isManualMetric(existing))))
          throw Error("请填写指标名称和单位");
        const normalizedUnit = unit
          .replace(/\s+/g, "")
          .replace(/／/g, "/")
          .toLowerCase();
        if (
          [
            "km/h",
            "kmh",
            "kmph",
            "kph",
            "千米/时",
            "公里/小时",
            "公里/时",
          ].includes(normalizedUnit)
        )
          throw Error("速度请使用 m/s，并填写对应数值和评价区间");
        if (normalizedUnit === "m/s") unit = "m/s";
        if (!["higher", "lower"].includes(direction))
          throw Error("请选择评价方向");
        if (existing && !T.isManualMetric(existing) && unit !== existing.unit)
          throw Error("内置指标单位须与原测试测量表一致");
        const targetText = value("catalogTarget"),
          error = M.validateField(state, "definitions.0.target", targetText);
        if (error) throw Error("评价目标：" + error);
        const ranges = Def.parseRanges(value("catalogRanges")).map((range) => ({
          ...range,
          advantage: !!existing?.ranges.some(
            (old) => old.label === range.label && old.advantage,
          ),
        }));
        const definition = {
          ...(existing || {}),
          id: existing?.id || "metric_" + uid(),
          testId,
          name,
          unit,
          ability,
          category,
          direction,
          entryScope: value("catalogEntryScope") || "record",
          ...(!(existing && !T.isManualMetric(existing)) ? { cvEligible: $("catalogCVEligible")?.checked === true } : {}),
          target: targetText === "" ? null : Number(targetText),
          ranges,
          referenceEnabled: existing
            ? (edit.unitReferenceEnabled ?? !!existing.referenceEnabled)
            : ranges.length > 0,
          source: existing?.source || "用户配置评价标准",
          protocol:
            existing && protocol === edit.initialProtocol
              ? existing.protocol || ""
              : protocol,
        };
        const index = catalog.definitions.findIndex(
          (d) => d.id === definition.id,
        );
        if (index < 0) catalog.definitions.push(definition);
        else catalog.definitions[index] = definition;
      }
      if (edit.mode !== "new-metric")
        test.primaryAbility = value("catalogPrimaryAbility");
      if (edit.mode !== "new-metric" && !T.registry.has(testId)) test.primaryMetricId = value("catalogPrimaryMetric") || catalog.definitions.find((d) => d.testId === testId && T.isAttemptMetric(d))?.id || "";
      catalog.definitions
        .filter((d) => d.testId === testId)
        .forEach((d) => (d.category = test.category));
      catalog.protocol[testId] = protocol;
      const canonical = M.normalizeCatalog(catalog);
      M.validateCatalog(canonical);
      edit.submitting = true;
      form.querySelector('[type="submit"]').disabled = true;
      canonical.tests.forEach(t=>{ const prior=catalog.tests.find(p=>p.id===t.id); if(prior?.disabled)t.disabled=true; });
      canonical.revision = (Number(catalog.revision) || 1) + 1;
      library.catalog = canonical;
      library.updated = new Date().toISOString();
      if (!await persist()) throw Error("目录保存失败，请重试");
      close("catalogModal");
      renderSettings();
      const message = $("catalogMessage");
      if (message)
        message.textContent =
          "项目目录已保存，后续测试可选择。评价标准在共用方案中维护。";
      return true;
    } catch (error) {
      edit.submitting = false;
      form.querySelector('[type="submit"]').disabled = false;
      $("catalogError").textContent = error.message;
      $("catalogError").hidden = false;
      return false;
    }
  }

  function catalogScopeConflict(id) {
    const conflict = library.catalog.definitions.find((next) => {
      const old = definition(next.id);
      return (
        next.testId === id &&
        old &&
        T.isManualMetric(old) &&
        T.isAttemptMetric(old) !== T.isAttemptMetric(next)
      );
    });
    if (conflict)
      toast(
        "“" +
          conflict.name +
          "”的录入层级与本次记录不同，请在项目库中新建指标；原数据已保留",
      );
    return !!conflict;
  }
  function applyCatalogProject(id) {
    const project = library.catalog.tests.find((test) => test.id === id);
    if (
      !project ||
      library.catalog.conflicts.some(
        (conflict) => conflict.testId === id && !conflict.resolved,
      )
    )
      return false;
    if (catalogScopeConflict(id)) return false;
    const changedUnits = library.catalog.definitions
      .filter((d) => d.testId === id)
      .flatMap((next) => {
        const old = definition(next.id);
        return old && old.unit !== next.unit
          ? [
              {
                id: next.id,
                name: next.name,
                from: old.unit,
                to: next.unit,
                factor: M.unitFactor(old.unit, next.unit),
              },
            ]
          : [];
      });
    if (changedUnits.some((change) => hasMetricDraft(change.id))) {
      toast("请先处理单位变化指标中尚未保存的修改，再更新本次定义");
      return false;
    }
    const message =
      "将“" +
      project.name +
      "”更新为项目库版本，仅影响本次记录。" +
      (changedUnits.length
        ? "\n单位变化：\n" +
          changedUnits
            .map(
              (change) =>
                change.name +
                "：" +
                change.from +
                " → " +
                change.to +
                "（" +
                (change.factor === null
                  ? "清空原测量值后重录"
                  : "换算原测量值") +
                "）",
            )
            .join("\n")
        : "\n已录入数据保留。") +
      "\n确认更新本次定义？";
    if (!confirm(message)) return false;
    M.validateCatalog(library.catalog);
    let converted = copy(state);
    try {
      for (const change of changedUnits)
        converted = M.changeMetricUnit(
          converted,
          change.id,
          change.to,
          change.factor === null ? "clear" : "convert",
        );
    } catch (error) {
      toast(error.message);
      return false;
    }
    state.customValues = converted.customValues;
    state.data = converted.data;
    if (!installCatalogProject(id, true)) return false;
    const custom = state.customTests.find((test) => test.id === id);
    if (custom) Object.assign(custom, copy(project));
    state.catalogAppliedTests = [
      ...new Set([...(state.catalogAppliedTests || []), id]),
    ];
    changed();
    persist();
    renderReport();
    renderSettings();
    const feedback = $("catalogMessage");
    if (feedback)
      feedback.textContent =
        "已更新“" +
        project.name +
        "”的本次定义。" +
        (changedUnits.some((change) => change.factor === null)
          ? "无法换算的测量值已清空，请重新录入。"
          : changedUnits.length
            ? "测量值已按新单位换算。"
            : "已录入数值保留。");
    return true;
  }

  async function resolveCatalogConflict(index, variantIndex) {
    const catalog = copy(library.catalog),
      conflict = catalog.conflicts[index];
    if (!conflict || conflict.resolved || !conflict.variants[variantIndex])
      return false;
    const variant = conflict.variants[variantIndex];
    if (
      !confirm(
        "采用“" +
          variant.test.name +
          "”的版本 " +
          (variantIndex + 1) +
          "（" +
          (variant.source || "来源未注明") +
          "）作为共用目录定义？已有测试记录保留原定义。",
      )
    )
      return false;
    const testIndex = catalog.tests.findIndex(
      (test) => test.id === conflict.testId,
    );
    if (testIndex < 0) return false;
    catalog.tests[testIndex] = copy(variant.test);
    catalog.definitions = catalog.definitions
      .filter((d) => d.testId !== conflict.testId)
      .concat(copy(variant.definitions));
    catalog.protocol[conflict.testId] = variant.protocol;
    conflict.resolved = true;
    conflict.selectedVariant = variantIndex;
    try {
      M.validateCatalog(catalog);
      catalog.revision = (Number(catalog.revision) || 1) + 1;
      library.catalog = catalog;
      library.updated = new Date().toISOString();
      if (!await persist()) throw Error("保存失败，请重试");
      renderSettings();
      const feedback = $("catalogMessage");
      if (feedback)
        feedback.textContent =
          "已确认“" +
          variant.test.name +
          "”的共用目录版本；已有测试记录保持原定义。";
      return true;
    } catch (error) {
      const feedback = $("catalogMessage");
      if (feedback) feedback.textContent = "版本未采用：" + error.message;
      return false;
    }
  }

  function facts() {
    // Suppress inactive custom targets in AI-derived scores/findings as well as
    // metric rows, without changing the saved record or local report formulas.
    const analysisRecord = effectiveRecord();
    analysisRecord.definitions.forEach((d) => { if (!d.referenceEnabled) { d.target = ""; d.ranges = []; } });
    const report = window.RingsideReport.build(analysisRecord),
      s = report.stats;
    return {
      athlete: {
        age: state.athlete.age,
        sex: state.athlete.sex,
        sport: state.athlete.sport,
        dominantHand: state.athlete.dominantHand,
        mass_kg: state.athlete.mass,
        level: state.athlete.sportLevel,
        cycle: state.athlete.cycle,
        injury: state.athlete.injury,
        notes: state.athlete.notes,
      },
      trainingContext: copy(state.trainingContext),
      evaluationPolicy: "仅 referenceEnabled 为 true 的目标和区间可用于达标判断；未启用评价的测量仍可用于描述、指标间比较和训练安排。",
      fms: s.raw.fms?.items || [],
      jumps: { cmj: s.raw.cmj, sj: s.raw.sj },
      aggregation: state.mode,
      aggregationExplanation: "results、forceTime 和 isometric 是当前代表成绩；repetitions 是逐指标的原始试次统计，不能把其均值、有效次数或推算来源误当成最佳试次本身。正式重复统计在有效次数至少3次时展示，不足3次先描述试次和复测需要。",
      repetitions: s.repetitions.map(({ testId, key, label, primaryMetricId, selectedIds, statistics }) => ({ testId, key, label, primaryMetricId, selectedIds, statistics })),
      results: report.projects
        .flatMap((test) => test.metrics)
        .map((d) => ({
          id: d.id,
          testId: d.testId,
          name: d.name,
          value: d.value,
          unit: d.unit,
          ability: d.ability,
          referenceEnabled: !!d.referenceEnabled,
          grade: d.referenceEnabled ? d.evaluation : null,
          target: d.referenceEnabled && positive(d.target) ? d.target : null,
          ranges: d.referenceEnabled ? copy(d.ranges || []) : [],
        })),
      capabilities: s.axes.map((a) => ({
        ability: a.label,
        score: a.value,
        status: a.status,
      })),
      qualityIssues: s.qualityIssues || [],
      migrationReview: {
        protocol: state.unitMigration || null,
        narrative: state.narrative.migrationReview || null,
      },
      findings: s.findings,
      advantages: s.advantages,
      derived: { EUR: s.raw.eur, DSI: s.raw.dsi, ASR_mps: s.raw.asr },
      forceTime: s.raw.forceTime,
      isometric: s.isoAnalyses.filter((x) =>
        x.sides.some((y) => y.value !== null || y.pain),
      ).map((x) => ({ ...x, referenceEnabled: positive(x.target) })),
      jointBalance: s.balanceResults.filter((x) => x.valid),
      lvp: s.lvpSeries
        .filter((x) => x.points.length)
        .map((x) => ({
          action: x.label,
          metric: x.metric,
          equation: { a: x.fit.a, b: x.fit.b },
          r2: x.fit.r2,
          mvt: x.mvt,
          estimatedLoad: x.est?.valid ? x.est.load : null,
          zones: x.zoneLoads,
        })),
      protocols: state.protocol,
      rawRecordsNote: "原始记录供口径、备注与试次背景核对；含未完成或无效字段，判断以有效 results、汇总值及 qualityIssues 为准。",
      rawRecords: Object.fromEntries(Object.entries(analysisRecord.data)
        .filter(([id]) => state.enabled[id]).map(([id, value]) => [id, copy(value)])),
      customMeasurements: report.projects.flatMap((test) => test.metrics)
        .filter((d) => window.RingsideTests.isManualMetric(d))
        .map((d) => ({ id: d.id, name: d.name, value: d.value, unit: d.unit,
          notes: state.customValues[d.id]?.notes || "" })),
    };
  }
  function preview(text, origin, binding, open = true) {
    pendingAI = { text, html: M.textToHTML(text), origin, ...binding };
    if (open) showAIDraft();
  }
  function showAIDraft() {
    $("previewTitle").textContent = pendingAI.origin + "草稿预览";
    $("aiPreview").innerHTML = M.sanitizeHTML(pendingAI.html);
    $("aiPreview").contentEditable = "true";
    $("aiPreview").setAttribute("role", "textbox");
    $("aiPreview").setAttribute("aria-label", "草稿正文");
    $("applyDraftButton").hidden = false;
    $("aiPreviewNote").textContent = state.narrative.text
      ? "可直接编辑草稿。应用后替换当前正文；上一版将在当前记录中保留。"
      : "可直接编辑草稿，确认后应用。";
    modal("previewModal");
  }
  function localDraft() {
    if (job) return;
    if (!M.stats(effectiveRecord()).validTests.size) return toast("先录入至少一项数据", "ai");
    preview(M.localText(effectiveRecord()), "本地", snapshot());
    setAIStatus("ready", "离线摘要已生成，等待应用", "已在预览中打开，可编辑后应用到正文。这份摘要由本地规则生成。");
  }
  function applyAI() {
    const p = pendingAI;
    if (!p || !currentMatches(p)) return toast("草稿所属测试已切换", "ai");
    if (p.basis !== recordBasis())
      return toast("测试数据已更新，请重新生成", "ai");
    if (
      p.revision !== state.narrative.revision &&
      !confirm("生成后正文已有人工修改。应用草稿将替换当前文字，是否继续？")
    )
      return;
    state.previousNarrative = copy(state.narrative);
    state.narrative = {
      html: M.sanitizeHTML(p.html),
      text: p.text,
      updated: now(),
      basis: p.basis,
      origin: p.origin,
      revision: (state.narrative.revision || 0) + 1,
    };
    pendingAI = null;
    $("previewModal").classList.remove("show");
    document.body.style.overflow = "";
    $("workspace").inert = false;
    $("sidebar").inert =
      matchMedia("(max-width:900px)").matches || ui.sidebarCollapsed;
    persist();
    renderNarrativeStatus();
    setAIStatus("applied", p.origin.startsWith("AI") ? "AI 新建议已应用" : "离线摘要已应用", "正文已更新，上一版保留在当前记录中。");
    focusContentTitle();
  }
  function safeAIError(error) {
    let text = typeof error === "string" ? error : error?.message || "分析失败，请重试";
    if (/failed to fetch|networkerror|load failed/i.test(text))
      text = window.MotionBenchLocal
        ? "未能连接本机服务，请重新运行启动入口，再重试。"
        : "浏览器未能访问 AI 服务，可能是网络或服务的跨域限制。中转服务请通过“启动 MotionBench”入口打开；也可检查网络或换用支持浏览器直连的服务。";
    if (key.trim()) text = text.split(key.trim()).join("[密钥已隐藏]");
    return text.replace(/sk-[A-Za-z0-9_-]+/g, "[密钥已隐藏]").replace(/<[^>]*>/g, "").slice(0, 500);
  }
  function setAIStatus(kind, title = "", detail = "") {
    clearInterval(aiTicker);
    aiStatus = { kind, title, detail, started: Date.now() };
    renderAIStatus();
    if (kind === "running") aiTicker = setInterval(renderAIStatus, 1000);
  }
  function isNarrativeView() {
    return ui.mode === "entry" && entryTab === "narrative";
  }
  function isAIView() {
    return isNarrativeView() || (ui.mode === "settings" && settingsTab === "ai");
  }
  function renderAIStatus() {
    const panel = $("aiProgress");
    if (!panel) return;
    if (job && !isNarrativeView()) job.autoPreview = false;
    panel.hidden = aiStatus.kind === "idle" || !isAIView();
    if (panel.hidden && $("toast").dataset.scope === "ai") $("toast").style.display = "none";
    panel.dataset.state = aiStatus.kind;
    panel.setAttribute("aria-live", aiStatus.kind === "error" ? "assertive" : "polite");
    $("aiProgressTitle").textContent = aiStatus.title || "";
    const seconds = Math.floor((Date.now() - aiStatus.started) / 1000);
    $("aiProgressDetail").textContent = (aiStatus.detail || "") + (job ? " · 已等待 " + seconds + " 秒" : "");
    $("aiCancelButton").hidden = !job;
    $("aiRetryButton").hidden = !["error", "cancelled"].includes(aiStatus.kind);
    $("aiSettingsButton").hidden = aiStatus.kind !== "error";
    $("aiReviewButton").hidden = aiStatus.kind !== "ready" || !pendingAI;
    document.querySelectorAll("[data-ai-generate]").forEach(button => {
      button.disabled = !!job;
      button.textContent = job ? "AI 正在生成…" : "生成 AI 综合建议";
    });
    document.querySelectorAll("[data-local-draft]").forEach(button => { button.disabled = !!job; });
  }
  function cancelAI() {
    if (!job) return;
    const task = job;
    job = null;
    task.controller.abort();
    setAIStatus("cancelled", "已停止等待 AI 结果", "原正文保持完整。服务端可能仍在处理已发送的请求，可以稍后重新生成。");
    renderNarrativeStatus();
  }
  function reviewAIDraft() {
    if (!isAIView() || !pendingAI || !currentMatches(pendingAI)) return;
    if (pendingAI.basis !== recordBasis()) {
      pendingAI = null;
      return setAIStatus("error", "测试数据已更新", "请基于最新数据重新生成建议。");
    }
    showAIDraft();
  }
  function baseURL() {
    const raw = apiURL
      .trim()
      .replace(/\/+$/, "")
      .replace(/\/(?:chat\/completions|models)$/, "");
    const u = new URL(raw);
    if (u.protocol !== "https:" || u.username || u.password || u.search || u.hash) throw Error("请填写不含密钥、参数或账号信息的 HTTPS API 基础地址");
    return raw.endsWith("/v1") ? raw : raw + "/v1";
  }
  async function request(path, payload, controller = new AbortController(), timeoutMs = 60000, connection) {
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    try {
      const base = connection?.base || baseURL(), requestKey = connection?.key ?? key.trim(), bridge = window.MotionBenchLocal;
      const response = await fetch(bridge ? "/api/relay" : base + path, {
        method: bridge || payload ? "POST" : "GET",
        headers: bridge ? { "Content-Type": "application/json", "X-MotionBench-Token": bridge.token } : {
          Authorization: "Bearer " + requestKey,
          ...(payload ? { "Content-Type": "application/json" } : {}),
        },
        body: bridge ? JSON.stringify({ base, path, key: requestKey, payload }) : payload ? JSON.stringify(payload) : undefined,
        signal: controller.signal,
      });
      const body = await response.text();
      let json;
      try { json = JSON.parse(body); } catch {}
      if (!response.ok || json?.error) {
        const detail = String(json?.error?.message || (typeof json?.error === "string" ? json.error : json?.message || "")).split(requestKey).join("[密钥已隐藏]");
        const hint = { 401: "密钥无效或已失效", 403: "服务拒绝访问，请核对密钥权限和模型权限", 404: "接口或模型不存在，请核对地址和模型名称", 429: "额度不足或请求过于频繁，请稍后重试", 502: "上游服务暂时不可用", 504: "上游服务响应超时" }[response.status] || "AI 服务未能完成请求";
        throw Error(hint + "（HTTP " + response.status + "）" + (detail ? "：" + safeAIError(detail) : ""));
      }
      if (!json) throw Error("服务返回的不是有效 JSON，请核对 API 地址是否指向聊天接口");
      return json;
    } catch (error) {
      if (timedOut) throw Error("等待 AI 服务超过 " + (timeoutMs / 1000) + " 秒，已停止等待。可稍后重试或更换模型。");
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  async function models() {
    if (!key.trim()) { $("apiMessage").textContent = "请先填写密钥，再读取可用模型。"; return; }
    $("modelButton").disabled = true;
    $("modelButton").textContent = "正在读取模型…";
    $("apiMessage").textContent = "正在连接服务，请稍候…";
    try {
      const json = await request("/models"),
        ids = (json.data || [])
          .map((x) => x.id)
          .filter((x) => typeof x === "string");
      $("modelList").innerHTML = ids
        .map((x) => `<option value="${E(x)}"></option>`)
        .join("");
      $("apiMessage").textContent = ids.length
        ? "已读取 " + ids.length + " 个模型"
        : "连接成功，请填写模型名称";
      if (!ids.includes(model) && ids.length) {
        model = ids.find(id => !/image|embed|tts|whisper|rerank/i.test(id)) || ids[0];
        $("apiModel").value = model;
        $("apiMessage").textContent += "，已选用 " + model + "。模型列表读取成功不代表每个模型都有调用权限。";
      }
    } catch (e) {
      if ($("apiMessage")) $("apiMessage").textContent = safeAIError(e);
    } finally {
      if ($("modelButton")) $("modelButton").disabled = false;
      if ($("modelButton")) $("modelButton").textContent = "读取可用模型";
    }
  }
  async function ai() {
    if (job) return toast("当前分析正在生成", "ai");
    if (!M.stats(effectiveRecord()).validTests.size) return setAIStatus("error", "还没有可供分析的数据", "请先录入至少一项有效测试结果。");
    if (!key.trim() || !model.trim()) {
      openSettings("ai");
      return setAIStatus("error", "AI 服务尚未配置完整", "填写密钥并读取或填写模型名称，然后重新生成。");
    }
    saveEditor();
    const binding = snapshot(),
      task = {
        ...binding,
        token: ++jobSequence,
        autoPreview: isNarrativeView(),
        controller: new AbortController(),
      };
    job = task;
    pendingAI = null;
    setAIStatus("running", "AI 正在综合分析并撰写训练建议", "使用 " + model + "。可继续查看本次测试，完成后草稿会保留在这里。最多等待 300 秒。");
    renderNarrativeStatus();
    try {
      const messages = [
        { role: "system", content: window.RingsideInterventions.systemPrompt },
        { role: "user", content: "生成解读与干预建议：\n" + JSON.stringify(facts()) },
      ];
      const selectedModel = model;
      const connection = { base: baseURL(), key: key.trim() };
      let validated, pages;
      for (let attempt = 0; attempt < 2; attempt++) {
        const json = await request("/chat/completions", { model: selectedModel, messages, stream: false }, task.controller, 300000, connection);
        if (job !== task || !currentMatches(task)) return;
        if (binding.basis !== recordBasis()) throw Error("生成期间测试数据已更新，请根据最新数据重新生成。");
        const result = json.choices?.[0]?.message?.content,
          text =
          typeof result === "string"
            ? result
            : Array.isArray(result)
              ? result.map((x) => x.text || "").join("\n")
              : "";
        if (!text.trim()) throw Error("服务未返回正文");
        if (json.choices?.[0]?.finish_reason === "length") throw Error("服务返回的正文被长度限制截断，请更换支持较长输出的模型后重试。");
        validated = window.RingsideInterventions.validateAI(text);
        await document.fonts.ready;
        if (job !== task || !currentMatches(task)) return;
        pages = window.RingsidePDF.measureNarrative(M.textToHTML(validated));
        if (pages <= 2) break;
        if (attempt === 0) {
          setAIStatus("running", "AI 正在精简训练重点", "初稿偏长，正在保留执行细节并压缩到两页 A4 内。最多再等待 300 秒。");
          messages.push({ role: "assistant", content: validated }, { role: "user", content: "当前正文实际排版为" + pages + "页。请重写为700–1000个汉字，最多两页A4。只保留最关键的综合判断、2个训练重点及具体剂量、必要的调整条件。不降低字号、不截断内容、不加泛泛免责声明。直接返回精简后的正文。" });
        }
      }
      if (pages > 2) throw Error("模型精简后仍超过两页，请重新生成或更换模型。");
      if (binding.basis !== recordBasis()) throw Error("生成期间测试数据已更新，请根据最新数据重新生成。");
      preview(validated, "AI", binding, task.autoPreview && isNarrativeView()
        && !document.querySelector(".modal-backdrop.show"));
      setAIStatus("ready", "AI 新建议已生成，等待应用", "当前正文约 " + pages + " 页 A4。核对或编辑后点击“应用草稿”，下方正文才会更新。");
    } catch (e) {
      if (job === task && currentMatches(task)) {
        const message = e.name === "AbortError" ? "请求已取消，可以重新生成。" : safeAIError(e);
        setAIStatus("error", "AI 建议生成失败", message);
      }
    } finally {
      if (job === task) {
        job = null;
        renderNarrativeStatus();
      }
    }
  }
  async function copyAIFacts() {
    const text = JSON.stringify(facts(), null, 2);
    try {
      await navigator.clipboard.writeText(text);
      toast("已复制当前测试资料");
    } catch {
      $("previewTitle").textContent = "当前测试分析资料";
      $("aiPreview").textContent = text;
      $("aiPreview").contentEditable = "false";
      $("aiPreviewNote").textContent = "可选中文字复制";
      pendingAI = null;
      $("applyDraftButton").hidden = true;
      modal("previewModal");
    }
  }
  function reportPayload() {
    ensureExportable();
    persist();
    const profile=library.evaluationProfiles.find(p=>p.id===state.evaluationProfileId);
    return {
      schema: 2,
      kind: "report",
      record: { ...effectiveRecord(), evaluationProfileId: undefined, evaluationSnapshot:profile ? {name:profile.name,revision:profile.revision} : {} },
      profile: copy(activeAthlete().profile),
    };
  }
  async function libraryPayload() {
    if (!await persist()) throw Error("请先完成保存");
    return repository.exportLibrary();
  }
  function exportHTMLString() {
    const payload = reportPayload(),
      clone = document.documentElement.cloneNode(true);
    clone.querySelector("#embedded-data").textContent = JSON.stringify(
      payload,
    ).replace(/</g, "\\u003c");
    for (const id of [
      "entryNav",
      "entryContent",
      "settingsContent",
      "managementContent", "managementFields", "managementError", "reportEvaluationLabel",
      "settingsTabs",
      "aiPreview",
      "aiPreviewNote",
      "microCards",
      "bodyChart",
      "radarChart",
      "screenItems",
      "directionMetrics",
      "detailContent",
      "interpEditor",
      "narrativeView",
      "athleteMeta",
      "reportNav",
      "recordContext",
      "editorState",
      "interpUpdated",
      "entryIdentity",
      "entryProjectTitle",
      "entryProblemSummary",
      "creationProjects",
      "creationSource",
      "creationError",
      "catalogFields",
      "catalogError",
      "recoveryFields",
      "recoveryError",
      "unitChangeMessage",
      "migrationReviewNotice",
    ])
      clone.querySelector("#" + id)?.replaceChildren();
    clone.querySelector("#athleteSelect").replaceChildren();
    clone.querySelector("#recordSelect").replaceChildren();
    clone
      .querySelectorAll("#newAthleteModal input,#newAthleteModal select")
      .forEach((el) => {
        el.value = "";
        el.removeAttribute("value");
      });
    clone.querySelector("#reportView").hidden = false;
    clone.querySelector("#entryView").hidden = true;
    clone.querySelector("#settingsView").hidden = true;
    clone.querySelector("#managementView").hidden = true;
    clone.querySelector("#emptyReport").hidden = true;
    clone.querySelector("#startupStatus").textContent = "正在打开本机资料库…";
    clone.querySelector("#reportAthleteSearch").value = "";
    clone.querySelector("#reportGroupFilter").replaceChildren();
    clone.querySelector("body").classList.remove("management-mode");
    clone.querySelector("#sidebarScrim").hidden = true;
    clone.querySelector("#workspace").removeAttribute("inert");
    clone.querySelector("#sidebar").removeAttribute("inert");
    clone
      .querySelector("body")
      .classList.remove("sidebar-open", "sidebar-collapsed");
    clone
      .querySelectorAll(".modal-backdrop")
      .forEach((el) => el.classList.remove("show"));
    clone.querySelectorAll(".ringside-pdf-stage").forEach((el) => el.remove());
    clone.querySelector("body").style.overflow = "";
    clone.querySelector("#toast").style.display = "none";
    clone.querySelector("#tooltip").style.display = "none";
    clone.querySelector("#pdfProgress").hidden = true;
    clone.querySelector("#motionbench-local-bootstrap")?.remove();
    clone.querySelector("#aiProgress").hidden = true;
    clone.querySelector("#aiProgressTitle").textContent = "";
    clone.querySelector("#aiProgressDetail").textContent = "";
    clone.querySelectorAll("[data-ai-generate],[data-local-draft]").forEach(button => { button.disabled = false; });
    clone.querySelectorAll("[data-ai-generate]").forEach(button => { button.textContent = "生成 AI 综合建议"; });
    clone.querySelectorAll("[data-pdf-action]").forEach((button) => {
      button.disabled = false;
      button.textContent = "导出当前报告 PDF";
    });
    return "<!doctype html>\n" + clone.outerHTML;
  }
  function download(content, name, type) {
    const url = URL.createObjectURL(new Blob([content], { type })),
      a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
  function filename(ext) {
    return (
      "MotionBench_" +
      (state.athlete.name || "athlete").replace(/[<>:"/\\|?*\s]/g, "_") +
      "_" +
      (state.athlete.date || "report") +
      "_" +
      state.recordId.slice(0, 6) +
      "." +
      ext
    );
  }
  function downloadHTML() {
    try {
      download(exportHTMLString(), filename("html"), "text/html;charset=utf-8");
    } catch (e) {
      return toast(e.message);
    }
    toast("当前HTML报告已保存");
  }
  function downloadJSON() {
    try {
      download(
        JSON.stringify(reportPayload(), null, 2),
        filename("json"),
        "application/json;charset=utf-8",
      );
    } catch (e) {
      toast(e.message);
    }
  }
  async function downloadLibrary() {
    try {
      if (!await persist()) throw Error("保存失败，请先重试");
      const blob = await repository.backupBlob(count => toast("正在备份 " + count + " 条测试"));
      download(blob, "MotionBench_完整备份_" + today() + ".motionbench.jsonl", "application/x-ndjson");
      toast("完整备份已导出");
    } catch (error) { toast(error.message); }
  }
  async function downloadLegacyLibrary() {
    try {
      const all = await libraryPayload(), profiles = new Map(all.evaluationProfiles.map(p=>[p.id,p]));
      all.athletes = all.athletes.filter(a=>!a.deletedAt).map(a=>({...a,records:a.records.filter(r=>!r.deletedAt).map(r=>{const out=window.RingsideEvaluation.resolve(r,profiles.get(r.evaluationProfileId));delete out.evaluationProfileId;return out;})})).filter(a=>a.records.length);
      all.schema=2;delete all.evaluationProfiles;delete all.groups;delete all.defaultEvaluationProfileId;
      for(const a of all.athletes){delete a.groupId;delete a.archived;delete a.deletedAt;for(const r of a.records){delete r.archived;delete r.deletedAt;delete r.deletedWithAthlete;delete r.evaluationIssues;}}
      if (!all.athletes.some(a=>a.id===all.activeAthleteId&&a.records.some(r=>r.recordId===all.activeRecordId))) {all.activeAthleteId=all.athletes[0]?.id||"";all.activeRecordId=all.athletes[0]?.records[0]?.recordId||"";}
      M.validateLibrary(all); download(JSON.stringify(all),"MotionBench_旧版兼容_"+today()+".json","application/json");
    } catch(error) {toast(error.message);}
  }
  async function runLibraryTransfer(operation) {
    if(libraryTransferActive)throw Error("资料库正在导入或恢复，请等待完成");
    libraryTransferActive=true;cancelJob();
    const controls=[$("workspace"),$("sidebar"),...document.querySelectorAll(".modal-backdrop.show")].map(node=>[node,node.inert]);
    controls.forEach(([node])=>node.inert=true);document.body.setAttribute("aria-busy","true");toast("正在校验并写入资料库…");
    try{return await operation();}finally{controls.forEach(([node,inert])=>node.inert=inert);document.body.removeAttribute("aria-busy");libraryTransferActive=false;}
  }
  async function importPayload(parsed, conflictChoice = "merge") {
    return runLibraryTransfer(async()=>{
    const incoming=window.RingsideEvaluation.migrate(parsed);
    if (!await persist()) throw Error("当前修改尚未保存");
    const result=await repository.importLibrary(incoming,{merge:conflictChoice!=="replace-library"});
    cancelJob(); await loadDirectory(false);
    const importedRecord=incoming.activeRecordId && await repository.loadRecord(result.recordMap[incoming.activeRecordId]||incoming.activeRecordId);
    if (importedRecord && !importedRecord.deletedAt) { state=importedRecord;library.activeAthleteId=state.athleteId;library.activeRecordId=state.recordId;recordBaselines.set(state.recordId,recordContent(state));await persist(); }
    ui.mode="report"; renderReport(false);renderWorkspace();return result;
    });
  }
  async function importBackup(file, merge = false) {
    return runLibraryTransfer(async()=>{
    if (!await persist()) throw Error("当前修改尚未保存");
    const result=await repository.importRows(window.RingsideStore.fileRows(file),{merge,onProgress:n=>toast("正在校验与导入 "+n+" 条测试")});
    cancelJob();await loadDirectory(false);ui.mode="management";window.RingsideManagement.open("athletes");renderReport(false);renderWorkspace();return result;
    });
  }
  function parseImportText(value) {
    const text = String(value).trim();
    if (text.startsWith("{")) return JSON.parse(text);
    if (!text.startsWith("<"))
      throw Error("请选择JSON备份或含测试数据的HTML报告");
    const template = document.createElement("template");
    template.innerHTML = text;
    const nodes = template.content.querySelectorAll(
      'script#embedded-data[type="application/json"]',
    );
    if (nodes.length !== 1) throw Error("HTML中缺少唯一的报告数据");
    const payload = JSON.parse(nodes[0].textContent);
    if (!payload) throw Error("HTML尚未保存测试数据");
    return payload;
  }
  function stageRecovery(parsed, error, mode) {
    try {
      M.validateLibrary(parsed, { skipRules: true });
    } catch {
      return false;
    }
    const issues = M.diagnoseRules(parsed);
    if (!issues.length) return false;
    recovery = { raw: copy(parsed), mode };
    const records =
      parsed.kind === "athlete-library"
        ? parsed.athletes.flatMap((a) =>
            a.records.map((r) => ({ r, name: a.name })),
          )
        : [
            {
              r: parsed.record || parsed,
              name: (parsed.record || parsed).athlete?.name || "运动员",
            },
          ];
    const keys = {
      asymAmber: "不对称关注阈值 %",
      asymRed: "不对称重点关注阈值 %",
      absoluteAmber: "绝对力关注比例 %",
      scoreAmber: "目标达成黄灯下界 %",
      scoreGreen: "目标达成绿灯下界 %",
    };
    $("recoveryFields").innerHTML =
      '<p class="notice">原始数据保持不变。以下记录的评价阈值不合法，请核对后明确修正；其它测量和历史记录将保留。</p>' +
      records
        .filter(({ r }) => issues.some((x) => x.recordId === r.recordId))
        .map(
          ({ r, name }) =>
            `<section><h4>${E(name)} · ${E(r.athlete?.date)} · ${E(r.recordId)}</h4><p class="field-error">${E(
              issues
                .filter((x) => x.recordId === r.recordId)
                .map((x) => pathLabel(x.path) + "：" + x.message)
                .join("；"),
            )}</p><div class="form-grid">${Object.entries(keys)
              .map(([key, label]) =>
                field(
                  label,
                  `<input type="number" step="any" min="0" required data-recovery-record="${E(r.recordId)}" data-recovery-field="${key}" aria-label="${E(label)}" value="${E(r.rules?.[key] ?? "")}">`,
                ),
              )
              .join("")}</div></section>`,
        )
        .join("");
    $("recoveryError").textContent = error.message;
    $("recoveryError").hidden = false;
    modal("recoveryModal");
    return true;
  }
  function downloadRecovery() {
    if (recovery)
      download(
        recovery.raw?.rawText ?? JSON.stringify(recovery.raw, null, 2),
        "MotionBench_待修复原始数据_" + today() + ".json",
        "application/json;charset=utf-8",
      );
  }
  async function recoverData() {
    if (!recovery) return;
    try {
      const changes = {};
      document.querySelectorAll("[data-recovery-record]").forEach((el) => {
        if (!el.validity.valid || el.value === "")
          throw Error("请填写有效的评价阈值");
        (changes[el.dataset.recoveryRecord] ||= {})[el.dataset.recoveryField] =
          Number(el.value);
      });
      const repaired = M.repairRules(recovery.raw, changes),
        mode = recovery.mode;
      if (mode === "startup") {
        const next = window.RingsideEvaluation.migrate(repaired);
        await repository.importLibrary(next);
        recovery = null;
        location.reload();
      } else {
        await importPayload(repaired);
        recovery = null;
        close("recoveryModal");
        toast("异常阈值已修正，原始测量已恢复");
      }
    } catch (e) {
      $("recoveryError").textContent = e.message;
      $("recoveryError").hidden = false;
    }
  }
  async function importFile(file) {
    if (!file) return;
    try {
      const merge = $("backupImportMode")?.value !== "replace";
      if (!merge && !confirm("恢复备份将切换当前资料库；现有资料库保留，可通过恢复上次资料库撤回。继续？")) return;
      if (/\.jsonl$/i.test(file.name)) {
        await importBackup(file,merge);
      } else {
        if (file.size > 50 * 1024 * 1024) throw Error("旧格式超过 50 MB，请使用完整 JSONL 备份");
        const parsed=parseImportText(await file.text());
        await importPayload(parsed,merge?"merge":"replace-library");
      }
      close("saveModal");toast("导入完成");
    } catch(error) { toast("导入失败："+error.message); }
    finally { $("importFile").value=""; }
  }

  function setPDFStatus(busy, label = "导出当前报告 PDF") {
    document.querySelectorAll("[data-pdf-action]").forEach((button) => {
      button.disabled = busy;
      button.textContent = label;
    });
  }
  async function downloadPDF() {
    if (pdfJob) return toast("PDF正在生成");
    try {
      ensureExportable();
    } catch (e) {
      return toast(e.message);
    }
    persist();
    renderReport();
    const record = effectiveRecord(),
      name = filename("pdf"),
      report = $("reportView").cloneNode(true);
    pdfJob = true;
    setPDFStatus(true, "生成 PDF…");
    $("pdfProgress").hidden = false;
    try {
      const blob = await window.RingsidePDF.build(record, report, {
        onProgress: (p) => {
          $("pdfProgress").textContent =
            p.phase === "render"
              ? `生成第 ${p.current} / ${p.total} 页`
              : "整理报告…";
          setPDFStatus(
            true,
            p.phase === "render" ? `PDF ${p.current}/${p.total}` : "生成 PDF…",
          );
        },
      });
      download(blob, name, "application/pdf");
      toast("PDF已导出");
    } catch (error) {
      toast("PDF导出失败：" + (error.message || String(error)));
    } finally {
      pdfJob = false;
      setPDFStatus(false);
      $("pdfProgress").hidden = true;
    }
  }

  function print() {
    try {
      ensureExportable();
    } catch (e) {
      return toast(e.message);
    }
    persist();
    cancelJob();
    const groups = [...document.querySelectorAll(".details-group")],
      old = groups.map((g) => g.open);
    groups.forEach((g) => (g.open = true));
    const restorePrint = () => {
      groups.forEach((g, i) => (g.open = old[i]));
      window.removeEventListener("afterprint", restorePrint);
    };
    window.addEventListener("afterprint", restorePrint);
    setTimeout(() => window.print(), 80);
  }
  window.App = {
    openEntry,
    openManagement, openManagedRecord, effectiveRecord, recordBasis,
    saveLibraryChanges, loadDirectory, renderSelectors, downloadLegacyLibrary, importBackup,
    getRepository: () => repository,
    async assignRecordProfile(id) { if (!state || !library.evaluationProfiles.some(p=>p.id===id)) return; state.evaluationProfileId=id;cancelJob();await persist();renderReport();renderEntry(); },
    viewEvaluation() { if(state) window.RingsideManagement.showEffective(effectiveRecord(),library.evaluationProfiles.find(p=>p.id===state.evaluationProfileId)); },
    async restorePreviousLibrary() { await repository.restorePrevious();cancelJob();await loadDirectory(false);openManagement("athletes");renderReport();renderWorkspace(); },
    downloadPreMigration() { const raw=localStorage.getItem(storageKey)||localStorage.getItem(legacyKey); if(raw) download(raw,"MotionBench_迁移前资料.json","application/json");else toast("此页面没有旧版资料"); },
    refreshWorkspace() { renderReport(); if (ui.mode === "entry") renderEntry(); renderWorkspace(); },
    saveNow: persist,
    async loadDemo() { return importPayload(M.recordEnvelope(M.sampleRecord())); },
    creationNext,
    creationBack,
    submitCreation,
    selectProjects,
    startEntry,
    gotoInputError,
    undoDelete,
    previousEntry() {
      moveEntry(-1);
    },
    nextEntry() {
      moveEntry(1);
    },
    openCatalogItem,
    submitCatalogItem,
    applyCatalogProject,
    resolveCatalogConflict,
    confirmUnitChange,
    recoverData,
    downloadRecovery,
    entry(t) {
      saveEditor();
      persist();
      entryTab = t;
      renderEntry();
      renderWorkspace();
      closeMobileSidebar();
      window.scrollTo({ top: 0, behavior: "instant" });
      focusContentTitle();
    },
    showReport,
    back,
    navigate,
    toggleSidebar,
    addForcePoint,
    removeForcePoint,
    getUIState() {
      return copy({ ...ui, entryTab, settingsTab });
    },
    close, modal,
    openSettings,
    settings(t) {
      settingsTab = t;
      renderSettings();
      renderWorkspace();
      closeMobileSidebar();
      window.scrollTo({ top: 0, behavior: "instant" });
      focusContentTitle();
    },
    selectDef(id) {
      selectedDef = id;
      renderSettings();
    },
    openNewAthlete,
    createAthlete,
    newTest,
    selectAthlete,
    selectRecord,
    addRow,
    removeRow,
    addRepeat,
    removeRepeat,
    isoFilter(v) {
      isoFilter = v;
      renderEntry();
    },
    addIso,
    changeMode(v) {
      state.mode = v;
      persist();
      renderReport();
    },
    saveRanges,
    saveBalanceRanges,
    addBalance,
    saveZones,
    addDefinition,
    addTest,
    format,
    localDraft,
    cancelAI,
    reviewAIDraft,
    applyAI,
    ai,
    models,
    copyAIFacts,
    saveMenu() { openManagement("backup"); },
    downloadHTML,
    downloadJSON,
    downloadLibrary,
    downloadPDF,
    print,
    stats() {
      return M.stats(effectiveRecord());
    },
    getState() {
      return state;
    },
    getLibrary() {
      return library;
    },
    reportPayload,
    libraryPayload,
    importPayload,
    exportHTMLString,
    renderReport,
    facts,
  };
  function inputIssue(control, message = "") {
    let feedback = control.nextElementSibling;
    if (!feedback?.classList.contains("field-error")) feedback = null;
    if (!message) {
      control.removeAttribute("aria-invalid");
      feedback?.remove();
      return;
    }
    control.setAttribute("aria-invalid", "true");
    if (!feedback) {
      feedback = document.createElement("span");
      feedback.className = "field-error";
      feedback.setAttribute("role", "alert");
      control.after(feedback);
    }
    feedback.textContent = message + "，此值未保存";
    $("entrySave").textContent = "部分输入未保存，请核对标红字段";
  }
  document.addEventListener("input", (e) => {
    const t = e.target;
    if (t.id === "aiPreview" && pendingAI) {
      pendingAI.html = M.sanitizeHTML(t.innerHTML);
      pendingAI.text = M.htmlToText(pendingAI.html);
      if (!pendingAI.origin.includes("人工编辑"))
        pendingAI.origin += " · 人工编辑";
      return;
    }
    if (t.dataset.editDraft) {
      rememberEditDraft(t);
      return;
    }
    if (t.id === "apiKey") {
      key = t.value;
      return;
    }
    if (t.id === "apiURL") {
      apiURL = t.value;
      return;
    }
    if (t.id === "apiModel") {
      model = t.value;
      return;
    }
    if (t.id === "interpEditor") {
      updateEditor();
      return;
    }
    if (t.dataset.path && t.tagName !== "SELECT" && t.type !== "checkbox") {
      t.setCustomValidity("");
      let error = M.validateField(state, t.dataset.path, t.value);
      if (t.type === "number" && !t.validity.valid)
        error ||= t.validity.badInput
          ? "请填写有效数值"
          : t.validity.stepMismatch
            ? "请填写整数"
            : "数值不在允许范围内";
      if (t.dataset.path === "athlete.name" && !t.value.trim())
        error = "姓名 / 编号不能为空";
      if (
        /^definitions\.\d+\.unit$/.test(t.dataset.path) &&
        /km\s*\/?\s*h/i.test(t.value)
      )
        error = "速度单位统一为 m/s，请使用 m/s 并核对数值与目标";
      if (error) {
        rememberInputError(t, error, rawNumbers.get(t)?.value || e.data);
        return;
      }
      if (t.type === "number")
        rawNumbers.set(t, { value: t.value, selected: false });
      forgetInputError(t.dataset.path);
      inputIssue(t);
      setPath(t.dataset.path, t.value);
    }
  });
  document.addEventListener("change", (e) => {
    const t = e.target;
    if (t.dataset.metricUnit) return requestMetricUnit(t, t.dataset.metricUnit);
    if (t.dataset.creationProject && creation) {
      creation.enabled[t.dataset.creationProject] = t.checked;
      refreshCreationCount();
      return;
    }
    if (t.dataset.path && (t.tagName === "SELECT" || t.type === "checkbox")) {
      const unit = t.dataset.path.match(/^data\.iso\.(\d+)\.unit$/);
      if (unit) return requestUnitChange(t, Number(unit[1]));
      if (t.dataset.path.startsWith("enabled.")) {
        const id = t.dataset.path.slice(8);
        if (t.checked && !installCatalogProject(id)) {
          t.checked = false;
          return toast("请先在设置中确认项目目录定义");
        }
        setPath(t.dataset.path, t.checked);
        refreshEntryChrome();
        return;
      }
      const error = M.validateField(
        state,
        t.dataset.path,
        t.type === "checkbox" ? t.checked : t.value,
      );
      if (error) {
        rememberInputError(t, error);
        return;
      }
      forgetInputError(t.dataset.path);
      inputIssue(t);
      setPath(t.dataset.path, t.type === "checkbox" ? t.checked : t.value);
      if (/^views\.lvp(Upper|Lower)\.showBand$/.test(t.dataset.path))
        state.views[t.dataset.path.split(".")[1]].bandExplicit = true;
      if (ui.mode === "entry" && ["dsi.source"].includes(t.dataset.path))
        renderEntry();
    }
    if (t.dataset.axis) {
      const axisId = T.axisKey(t.dataset.axis);
      state.axes[axisId] ||= {
        ...(T.axisConfig(state, t.dataset.axis) || {
          method: "primary",
          primary: state.definitions.find(
            (d) => T.abilityName(d.ability) === T.abilityName(t.dataset.axis),
          )?.id,
        }),
      };
      state.axes[axisId][t.dataset.axisKey] = t.value;
      changed();
    }
    if (t.dataset.lvpId) {
      const view =
        state.views[t.dataset.lvpLimb === "upper" ? "lvpUpper" : "lvpLower"];
      if (!view.selectionExplicit) {
        const ids =
          t.dataset.lvpLimb === "upper"
            ? ["bench", "landmineR", "landmineL"]
            : ["squat", "deadlift"];
        const available = M.stats(effectiveRecord()).lvpSeries.filter(
            (x) => ids.includes(x.id) && x.points.length,
          ),
          selected = available.filter((x) => view.selected.includes(x.id));
        view.selected = (
          selected.length ? selected : available.slice(0, 1)
        ).map((x) => x.id);
      }
      view.selected = t.checked
        ? [...new Set([...view.selected, t.dataset.lvpId])]
        : view.selected.filter((id) => id !== t.dataset.lvpId);
      view.selectionExplicit = true;
      changed();
    }
    if (t.id === "importFile") {
      importFile(t.files[0]);
      t.value = "";
    }
  });
  $("interpEditor").addEventListener("paste", (e) => {
    e.preventDefault();
    const html = e.clipboardData.getData("text/html");
    document.execCommand(
      "insertHTML",
      false,
      html
        ? M.sanitizeHTML(html)
        : M.textToHTML(e.clipboardData.getData("text/plain")),
    );
    updateEditor();
  });
  document.addEventListener("click", (e) => {
    const anchor = e.target.closest('#reportView a[href^="#"]');
    if (anchor) {
      e.preventDefault();
      navigate(anchor.getAttribute("href").slice(1));
    }
    if (e.target.classList.contains("modal-backdrop")) close(e.target.id);
    const hotspot = e.target.closest("[data-region]");
    if (hotspot) {
      document.querySelector("#screenDetail").open = true;
      document
        .querySelectorAll(".selected-result")
        .forEach((x) => x.classList.remove("selected-result"));
      const region = hotspot.dataset.region.replace(/_[lr]$/, "");
      const row = document.querySelector(
        '[data-iso-region="' + CSS.escape(region) + '"]',
      );
      row?.classList.add("selected-result");
      (row || $("detail-fms") || $("detail-iso"))?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }
  });
  document.addEventListener("keydown", (e) => {
    if (
      e.target.type === "number" &&
      e.target.dataset.path &&
      (e.ctrlKey || e.metaKey) &&
      e.key.toLowerCase() === "a"
    )
      rawNumbers.set(e.target, {
        value: e.target.value || rawNumbers.get(e.target)?.value || "",
        selected: true,
      });
    if (
      e.key === "Enter" &&
      creation?.step === "profile" &&
      e.target.closest("#creationProfileStep") &&
      e.target.tagName !== "TEXTAREA"
    ) {
      e.preventDefault();
      creationNext();
      return;
    }
    const hotspot = e.target.closest("[data-region]");
    if (hotspot && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      hotspot.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }
    if (
      e.key === "Escape" &&
      document.body.classList.contains("sidebar-open")
    ) {
      toggleSidebar(false);
      return;
    }
    const drawer = document.body.classList.contains("sidebar-open")
      ? $("sidebar")
      : null;
    const open =
      [...document.querySelectorAll(".modal-backdrop.show")].at(-1) || drawer;
    if (!open) return;
    if (e.key === "Escape") {
      close(open.id);
      return;
    }
    if (e.key === "Tab") {
      const els = [
          ...open.querySelectorAll("button,input,select,textarea,[tabindex]"),
        ].filter((x) => !x.disabled && x.offsetParent),
        first = els[0],
        last = els.at(-1);
      if (e.shiftKey && document.activeElement === first) {
        last?.focus();
        e.preventDefault();
      } else if (!e.shiftKey && document.activeElement === last) {
        first?.focus();
        e.preventDefault();
      }
    }
  });
  document.addEventListener("focusin", (e) => {
    if (
      e.target.type === "number" &&
      e.target.dataset.path &&
      !e.target.validity.badInput
    )
      rawNumbers.set(e.target, { value: e.target.value, selected: false });
  });
  document.addEventListener("beforeinput", (e) => {
    const t = e.target;
    if (t.type !== "number" || !t.dataset.path) return;
    const prior = rawNumbers.get(t) || { value: t.value, selected: false };
    let value = prior.selected ? "" : prior.value;
    if (e.inputType?.startsWith("insert"))
      value += e.data ?? e.dataTransfer?.getData("text/plain") ?? "";
    else if (e.inputType?.startsWith("delete"))
      value = prior.selected ? "" : value.slice(0, -1);
    rawNumbers.set(t, { value, selected: false });
  });
  document.addEventListener("pointermove", (e) => {
    const hit = e.target.closest("[data-lvp-series]"),
      hover = hit ? V.lvpHover(hit, e) : null,
      el = e.target.closest("[data-tooltip]");
    if (hover) {
      $("tooltip").textContent =
        hover.label +
        " · " +
        hover.metric +
        "\n负荷 " +
        F(hover.load, 1) +
        " kg · 速度 " +
        F(hover.velocity, 3) +
        " m/s\n" +
        (hover.zone || "未配置素质区间") +
        (hover.supported ? "" : " · 外推");
    } else if (el) $("tooltip").textContent = el.dataset.tooltip;
    else {
      $("tooltip").style.display = "none";
      return;
    }
    $("tooltip").style.display = "block";
    $("tooltip").style.left =
      Math.max(6, Math.min(e.clientX + 12, innerWidth - 300)) + "px";
    $("tooltip").style.top =
      Math.max(6, Math.min(e.clientY + 12, innerHeight - 100)) + "px";
  });
  window.addEventListener("beforeunload", (event) => {
    saveEditor();
    const unsaved=libraryTransferActive||storageFailed||saveTimer||pendingSaves||(state&&recordBaselines.get(state.recordId)!==recordContent(state));
    if (unsaved) persist();
    if (job) job.controller.abort();
    if (unsaved) { event.preventDefault(); event.returnValue=""; }
  });

  window.addEventListener(
    "scroll",
    () => {
      if (ui.mode !== "report") return;
      if (scrollFrame === null)
        scrollFrame = requestAnimationFrame(() => {
          scrollFrame = null;
          updateScrollNav();
        });
      clearTimeout(uiSaveTimer);
      uiSaveTimer = setTimeout(() => {
        captureReportUI();
        rememberUI();
      }, 180);
    },
    { passive: true },
  );
  document.addEventListener(
    "toggle",
    (e) => {
      if (
        e.target.isConnected &&
        e.target.matches("#reportView .details-group,#reportView [data-raw-trials]")
      ) {
        ui.detailOpen[e.target.id] = e.target.open;
        rememberUI();
      }
    },
    true,
  );
  matchMedia("(max-width:900px)").addEventListener("change", (e) => {
    document.body.classList.remove("sidebar-open");
    $("sidebarScrim").hidden = true;
    $("workspace").inert = false;
    document.body.style.overflow = "";
    if (e.matches) {
      $("sidebar").inert = true;
      $("sidebarToggle").setAttribute("aria-expanded", "false");
    } else toggleSidebar(!ui.sidebarCollapsed);
  });
  async function initializeApplication() {
    $("startupStatus").hidden = false;
    try {
      await restore();
      window.RingsideManagement.init();
      try {
        const saved=JSON.parse(sessionStorage.getItem(uiKey)||"null");
        if(saved){ui.sidebarCollapsed=!!saved.sidebarCollapsed;ui.lastViewed=saved.lastViewed||{};}
      } catch {}
      document.body.classList.toggle("sidebar-collapsed",ui.sidebarCollapsed);
      renderReport(false);renderWorkspace();
      $("sidebar").inert=matchMedia("(max-width:900px)").matches||ui.sidebarCollapsed;
      $("sidebarToggle").setAttribute("aria-expanded",String(!$("sidebar").inert));
      $("startupStatus").hidden=true;
      return true;
    } catch(error) {
      $("startupStatus").textContent="无法打开资料库："+error.message+"。原始资料未删除，请导出旧资料或重新打开后重试。";
      $("startupStatus").classList.add("notice");
      const recoverButton=document.createElement("button");recoverButton.className="btn small";recoverButton.textContent="导出迁移前原始资料";recoverButton.onclick=App.downloadPreMigration;$("startupStatus").append(recoverButton);
      if(lastRestorePayload&&!lastRestorePayload.rawText)stageRecovery(lastRestorePayload,error,"startup");
      console.error(error);
      return false;
    }
  }
  window.App.ready=initializeApplication();
})();
