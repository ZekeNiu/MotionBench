(function (root) {
  "use strict";
  const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[char]));
  const fields = ["name", "sex", "sport", "dominantHand", "sportLevel", "birthDate", "experienceYears", "injuryHistory"];
  const creationIds = { name:"newAthleteName", sex:"newAthleteSex", sport:"newAthleteSport", dominantHand:"newAthleteHand", sportLevel:"newAthleteLevel", groupId:"newAthleteGroup", birthDate:"newAthleteBirthDate", experienceYears:"newAthleteExperienceYears", injuryHistory:"newAthleteInjuryHistory" };
  const option = (value, label, selected) => `<option value="${esc(value)}" ${value === selected ? "selected" : ""}>${esc(label)}</option>`;

  function render(profile = {}, { creation = false, groups = [], groupId = "" } = {}) {
    const id = key => creation ? ` id="${creationIds[key]}"` : "";
    const field = (label, control, wide = false) => `<label class="field${wide ? " wide" : ""}"><span>${label}</span>${control}</label>`;
    const input = (key, extra = "") => `<input${id(key)} name="${key}" ${extra} value="${esc(profile[key])}">`;
    const select = (key, values, selected) => `<select${id(key)} name="${key}">${values.map(([value, label]) => option(value, label, selected)).join("")}</select>`;
    return '<div class="form-grid athlete-profile-core">' +
      field("姓名 / 编号", input("name", 'required maxlength="100"')) +
      field("队伍 / 训练组", select("groupId", [["", "未分组"], ...groups.map(group => [group.id, group.name])], groupId)) +
      field("性别", select("sex", ["未注明", "男", "女"].map(value => [value, value]), profile.sex || "未注明")) +
      field("出生日期（可选）", input("birthDate", 'type="date"')) +
      field("专项", input("sport", 'maxlength="100" list="sportOptions"')) +
      '</div><details class="supplement athlete-profile-more"><summary>更多长期背景（可选）</summary><div class="form-grid">' +
      field("惯用手", select("dominantHand", ["未注明", "右手", "左手", "双手"].map(value => [value, value]), profile.dominantHand || "未注明")) +
      field("水平 / 级别", input("sportLevel", 'maxlength="100"')) +
      field("抗阻训练年限", input("experienceYears", 'type="number" min="0" max="80" step="any" inputmode="decimal"')) +
      field("长期相关伤病简述", `<textarea${id("injuryHistory")} name="injuryHistory" rows="2">${esc(profile.injuryHistory)}</textarea>`, true) +
      '</div></details>';
  }

  function read(form, { creation = false } = {}) {
    const profile = {};
    let groupId = "";
    for (const key of [...fields, "groupId"]) {
      const control = form.querySelector(`[name="${key}"]`) || (creation ? form.querySelector(`#${creationIds[key]}`) : null);
      if (!control) throw Error("运动员资料表单不完整，请重新打开。");
      if (!control.checkValidity()) {
        const more = control.closest("details");
        if (more) more.open = true;
        control.reportValidity();
        throw Error("请核对运动员资料中的日期或数值。");
      }
      if (key === "groupId") { groupId = control.value; continue; }
      profile[key] = control.value.trim();
    }
    if (!profile.name) throw Error("请填写姓名或编号");
    profile.sex ||= "未注明";
    profile.dominantHand ||= "未注明";
    return { profile, groupId };
  }

  root.RingsideProfile = { render, read };
})(window);
