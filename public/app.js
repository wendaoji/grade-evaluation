const state = {
  user: null,
  app: null,
  activeTab: "dashboard",
  selectedCycleId: null,
  scoreContext: null,
  message: "",
  error: ""
};

const app = document.querySelector("#app");

function setMessage(message = "", error = "") {
  state.message = message;
  state.error = error;
}

function scoreRateText(rate) {
  return `${Math.round((rate ?? 0) * 100)}%`;
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {})
    },
    ...options
  });

  if (response.status === 204) {
    return null;
  }

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.message || "请求失败");
  }
  return payload;
}

async function bootstrap() {
  try {
    const me = await request("/api/auth/me");
    state.user = me.user;
    state.app = await request("/api/app-state");
    state.selectedCycleId ||= state.app.cycles[0]?.id ?? null;
    render();
  } catch {
    state.user = null;
    state.app = null;
    render();
  }
}

function render() {
  if (!state.user) {
    renderLogin();
    return;
  }

  const selectedCycle =
    state.app.cycles.find((cycle) => cycle.id === state.selectedCycleId) ?? state.app.cycles[0];
  state.selectedCycleId = selectedCycle?.id ?? null;
  const main = state.activeTab === "score" ? renderScoreTab(selectedCycle) : renderMainTab(selectedCycle);

  app.innerHTML = `
    <div class="page">
      <section class="hero">
        <div class="toolbar">
          <div>
            <h1>人员任职资格评价</h1>
            <p>支持加权评分、关键项门槛、自动定级与批次统计分析。</p>
          </div>
          <div class="inline-actions">
            <span class="badge">${state.user.name} · ${state.user.role === "admin" ? "管理员" : "评委"}</span>
            <button class="button-secondary" data-action="logout">退出登录</button>
          </div>
        </div>
        <div class="toolbar">
          <div class="tabs">
            ${["dashboard", state.user.role === "admin" ? "admin" : null, "review", "analytics", "score"]
              .filter(Boolean)
              .map(
                (tab) => `
                <button class="tab ${state.activeTab === tab ? "active" : ""}" data-tab="${tab}">
                  ${tab === "dashboard" ? "总览" : ""}
                  ${tab === "admin" ? "管理员配置" : ""}
                  ${tab === "review" ? "评分任务" : ""}
                  ${tab === "analytics" ? "统计分析" : ""}
                  ${tab === "score" ? "评分详情" : ""}
                </button>`
              )
              .join("")}
          </div>
          <div class="inline-actions">
            <label>
              当前批次
              <select data-action="select-cycle">
                ${state.app.cycles
                  .map(
                    (cycle) => `
                    <option value="${cycle.id}" ${cycle.id === state.selectedCycleId ? "selected" : ""}>
                      ${cycle.name} (${cycle.status})
                    </option>`
                  )
                  .join("")}
              </select>
            </label>
          </div>
        </div>
        ${state.error ? `<div class="alert">${state.error}</div>` : ""}
        ${state.message ? `<div class="alert success">${state.message}</div>` : ""}
      </section>
      <div class="grid" style="margin-top: 20px;">${main}</div>
    </div>
  `;

  bindEvents();
}

function renderLogin() {
  app.innerHTML = `
    <div class="login-wrap">
      <div class="hero login-card">
        <div>
          <h1>任职资格评价系统</h1>
          <p>演示账号：管理员 <code>admin / admin123</code>，评委 <code>reviewer / review123</code></p>
        </div>
        ${state.error ? `<div class="alert">${state.error}</div>` : ""}
        <form id="login-form" class="grid">
          <label>用户名<input name="username" value="admin" /></label>
          <label>密码<input name="password" type="password" value="admin123" /></label>
          <button class="button-primary" type="submit">登录</button>
        </form>
      </div>
    </div>
  `;
  document.querySelector("#login-form").addEventListener("submit", handleLogin);
}

function getSelectedCycle() {
  return state.app.cycles.find((cycle) => cycle.id === state.selectedCycleId) ?? null;
}

function getSelectedCycleAnalyticsHtml() {
  return `
    <div class="panel">
      <div class="panel-title">
        <h2>批次概览</h2>
      </div>
      <div class="metric-grid">
        <div class="metric-card">
          <div class="muted">评价批次</div>
          <div class="metric-value">${getSelectedCycle()?.name ?? "-"}</div>
        </div>
        <div class="metric-card">
          <div class="muted">被评价人员</div>
          <div class="metric-value">${state.app.people.length}</div>
        </div>
        <div class="metric-card">
          <div class="muted">已创建批次</div>
          <div class="metric-value">${state.app.cycles.length}</div>
        </div>
      </div>
    </div>
  `;
}

function renderMainTab(selectedCycle) {
  if (state.activeTab === "dashboard") {
    return `
      ${getSelectedCycleAnalyticsHtml()}
      <div class="grid two-col">
        ${renderCycleList()}
        ${renderPeopleList()}
      </div>
    `;
  }

  if (state.activeTab === "admin") {
    return `
      <div class="grid two-col">
        ${renderCycleAdmin(selectedCycle)}
        ${renderFrameworkAdmin(selectedCycle)}
      </div>
      ${renderPeopleAdmin()}
    `;
  }

  if (state.activeTab === "review") {
    return renderReviewList(selectedCycle);
  }

  if (state.activeTab === "analytics") {
    return renderAnalytics(selectedCycle);
  }

  return "";
}

function renderCycleList() {
  return `
    <section class="panel">
      <div class="panel-title">
        <h2>评价批次</h2>
      </div>
      <div class="list">
        ${state.app.cycles
          .map(
            (cycle) => `
            <div class="list-row">
              <div>
                <strong>${cycle.name}</strong>
                <div class="muted">${cycle.status} · 创建时间 ${new Date(cycle.createdAt).toLocaleString()}</div>
              </div>
              <div class="badge">${cycle.framework.levels.length} 个等级 · ${cycle.framework.dimensions.length} 个维度</div>
            </div>`
          )
          .join("")}
      </div>
    </section>
  `;
}

function renderPeopleList() {
  return `
    <section class="panel">
      <div class="panel-title">
        <h2>人员清单</h2>
      </div>
      <div class="list">
        ${state.app.people
          .map(
            (person) => `
              <div class="person-row">
                <strong>${person.name}</strong>
                <div class="muted">${person.employeeNo} · ${person.department || "未设置部门"} · ${person.position || "未设置岗位"}</div>
              </div>`
          )
          .join("")}
      </div>
    </section>
  `;
}

function renderCycleAdmin(selectedCycle) {
  return `
    <section class="panel">
      <div class="panel-title">
        <h2>批次管理</h2>
      </div>
      <form id="create-cycle-form" class="grid">
        <label>新批次名称<input name="name" placeholder="例如：2026 下半年任职资格评价" /></label>
        <button class="button-primary" type="submit">创建草稿批次</button>
      </form>
      <div class="list" style="margin-top: 18px;">
        ${state.app.cycles
          .map(
            (cycle) => `
              <div class="list-row">
                <div>
                  <strong>${cycle.name}</strong>
                  <div class="muted">${cycle.status === "draft" ? "草稿，可编辑体系" : "已激活，体系冻结"}</div>
                </div>
                <div class="inline-actions">
                  ${
                    cycle.status === "draft"
                      ? `<button class="button-secondary" data-action="activate-cycle" data-id="${cycle.id}">激活</button>`
                      : `<button class="button-secondary" data-action="draft-cycle" data-id="${cycle.id}">转回草稿</button>`
                  }
                </div>
              </div>`
          )
          .join("")}
      </div>
      ${
        selectedCycle
          ? `<div class="muted" style="margin-top: 16px;">当前编辑批次：${selectedCycle.name}</div>`
          : ""
      }
    </section>
  `;
}

function renderFrameworkAdmin(selectedCycle) {
  if (!selectedCycle) {
    return `<section class="panel"><div class="empty">暂无批次</div></section>`;
  }

  const framework = structuredClone(selectedCycle.framework);
  return `
    <section class="panel">
      <div class="panel-title">
        <h2>评价体系配置</h2>
        <span class="badge">${selectedCycle.status === "draft" ? "可编辑" : "已冻结"}</span>
      </div>
      <form id="framework-form" class="grid" data-disabled="${selectedCycle.status !== "draft"}">
        <label>体系名称<input name="frameworkName" value="${framework.name}" ${selectedCycle.status !== "draft" ? "disabled" : ""} /></label>
        <div class="dimension-card">
          <div class="panel-title">
            <h3>等级规则</h3>
            ${
              selectedCycle.status === "draft"
                ? `<button class="button-secondary" type="button" data-action="add-level">新增等级</button>`
                : ""
            }
          </div>
          <div id="level-editor" class="grid">
            ${framework.levels
              .map((level, index) => renderLevelEditor(level, index, selectedCycle.status !== "draft"))
              .join("")}
          </div>
        </div>
        <div class="dimension-card">
          <div class="panel-title">
            <h3>评价维度</h3>
            ${
              selectedCycle.status === "draft"
                ? `<button class="button-secondary" type="button" data-action="add-dimension">新增维度</button>`
                : ""
            }
          </div>
          <div id="dimension-editor" class="grid">
            ${framework.dimensions
              .map((dimension, index) => renderDimensionEditor(dimension, index, selectedCycle.status !== "draft"))
              .join("")}
          </div>
        </div>
        ${
          selectedCycle.status === "draft"
            ? `<button class="button-primary" type="submit">保存评价体系</button>`
            : `<div class="alert">已激活批次不允许修改评价体系，如需调整请创建新的草稿批次。</div>`
        }
      </form>
    </section>
  `;
}

function renderLevelEditor(level, index, disabled) {
  return `
    <div class="item-row" data-level-index="${index}">
      <div class="form-grid two">
        <label>等级名称<input data-field="name" value="${level.name}" ${disabled ? "disabled" : ""} /></label>
        <label>排序<input data-field="order" type="number" value="${level.order}" ${disabled ? "disabled" : ""} /></label>
        <label>最小得分率<input data-field="minRate" type="number" step="0.01" min="0" max="1" value="${level.minRate}" ${disabled ? "disabled" : ""} /></label>
        <label>最大得分率<input data-field="maxRate" type="number" step="0.01" min="0" max="1" value="${level.maxRate}" ${disabled ? "disabled" : ""} /></label>
      </div>
      <label>
        <input type="checkbox" data-field="keyEnabled" ${level.keyRule?.enabled ? "checked" : ""} ${disabled ? "disabled" : ""} />
        启用关键项门槛
      </label>
      <div class="form-grid two">
        <label>关键项最低得分率<input data-field="minKeyRate" type="number" step="0.01" min="0" max="1" value="${level.keyRule?.minKeyRate ?? ""}" ${disabled ? "disabled" : ""} /></label>
        <label>
          <input type="checkbox" data-field="disallowZeroKeyScore" ${level.keyRule?.disallowZeroKeyScore ? "checked" : ""} ${disabled ? "disabled" : ""} />
          关键项不能出现 0 分
        </label>
      </div>
      ${disabled ? "" : `<button class="button-danger" type="button" data-action="remove-level" data-index="${index}">删除等级</button>`}
    </div>
  `;
}

function renderDimensionEditor(dimension, dimensionIndex, disabled) {
  return `
    <div class="dimension-card" data-dimension-index="${dimensionIndex}">
      <div class="panel-title">
        <h3>维度 ${dimensionIndex + 1}</h3>
        ${disabled ? "" : `<button class="button-danger" type="button" data-action="remove-dimension" data-index="${dimensionIndex}">删除维度</button>`}
      </div>
      <label>维度名称<input data-field="dimension-name" value="${dimension.name}" ${disabled ? "disabled" : ""} /></label>
      <div class="grid">
        ${dimension.categories
          .map((category, categoryIndex) =>
            renderCategoryEditor(category, dimensionIndex, categoryIndex, disabled)
          )
          .join("")}
      </div>
      ${
        disabled
          ? ""
          : `<button class="button-secondary" type="button" data-action="add-category" data-dimension-index="${dimensionIndex}">新增分类</button>`
      }
    </div>
  `;
}

function renderCategoryEditor(category, dimensionIndex, categoryIndex, disabled) {
  return `
    <div class="category-card" data-category-index="${categoryIndex}">
      <div class="panel-title">
        <h3>分类 ${categoryIndex + 1}</h3>
        ${disabled ? "" : `<button class="button-danger" type="button" data-action="remove-category" data-dimension-index="${dimensionIndex}" data-category-index="${categoryIndex}">删除分类</button>`}
      </div>
      <label>分类名称<input data-field="category-name" value="${category.name}" ${disabled ? "disabled" : ""} /></label>
      <div class="item-grid">
        ${category.items
          .map((item, itemIndex) =>
            renderItemEditor(item, dimensionIndex, categoryIndex, itemIndex, disabled)
          )
          .join("")}
      </div>
      ${
        disabled
          ? ""
          : `<button class="button-secondary" type="button" data-action="add-item" data-dimension-index="${dimensionIndex}" data-category-index="${categoryIndex}">新增评分项</button>`
      }
    </div>
  `;
}

function renderItemEditor(item, dimensionIndex, categoryIndex, itemIndex, disabled) {
  return `
    <div class="item-row">
      <div class="form-grid two">
        <label>评分项标题<input data-field="item-title" value="${item.title}" ${disabled ? "disabled" : ""} /></label>
        <label>
          权重
          <select data-field="item-weight" ${disabled ? "disabled" : ""}>
            ${[1, 1.5, 2]
              .map((weight) => `<option value="${weight}" ${Number(item.weight) === weight ? "selected" : ""}>${weight}</option>`)
              .join("")}
          </select>
        </label>
      </div>
      <label>评分项说明<textarea data-field="item-description" ${disabled ? "disabled" : ""}>${item.description || ""}</textarea></label>
      <label>
        <input type="checkbox" data-field="item-key" ${item.isKeyItem ? "checked" : ""} ${disabled ? "disabled" : ""} />
        关键项
      </label>
      ${disabled ? "" : `<button class="button-danger" type="button" data-action="remove-item" data-dimension-index="${dimensionIndex}" data-category-index="${categoryIndex}" data-item-index="${itemIndex}">删除评分项</button>`}
    </div>
  `;
}

function renderPeopleAdmin() {
  return `
    <section class="panel">
      <div class="panel-title">
        <h2>人员管理</h2>
      </div>
      <form id="person-form" class="form-grid two">
        <label>工号<input name="employeeNo" placeholder="例如 E003" /></label>
        <label>姓名<input name="name" placeholder="例如 王五" /></label>
        <label>部门<input name="department" placeholder="例如 AI 创新部" /></label>
        <label>岗位<input name="position" placeholder="例如 技术专家" /></label>
        <button class="button-primary" type="submit">新增人员</button>
      </form>
      <table class="table" style="margin-top: 18px;">
        <thead>
          <tr><th>工号</th><th>姓名</th><th>部门</th><th>岗位</th></tr>
        </thead>
        <tbody>
          ${state.app.people
            .map(
              (person) => `
                <tr>
                  <td>${person.employeeNo}</td>
                  <td>${person.name}</td>
                  <td>${person.department || "-"}</td>
                  <td>${person.position || "-"}</td>
                </tr>`
            )
            .join("")}
        </tbody>
      </table>
      <div class="grid two-col" style="margin-top: 20px;">
        <form id="people-import-form" class="dimension-card">
          <div class="panel-title"><h3>批量导入人员</h3></div>
          <label>
            导入模式
            <select name="mode">
              <option value="merge">合并更新</option>
              <option value="replace">替换现有人员</option>
            </select>
          </label>
          <label>
            CSV 内容
            <textarea name="content" placeholder="employeeNo,name,department,position&#10;E003,王五,AI创新部,技术专家"></textarea>
          </label>
          <button class="button-primary" type="submit">导入人员</button>
        </form>
        <form id="framework-import-form" class="dimension-card">
          <div class="panel-title"><h3>批量导入评价体系</h3></div>
          <label>
            JSON 内容
            <textarea name="content" placeholder='{"name":"导入体系","levels":[],"dimensions":[]}'></textarea>
          </label>
          <button class="button-primary" type="submit">导入到当前草稿批次</button>
          <div class="muted">仅当前批次为草稿时允许导入，导入后会替换该批次现有体系与评分记录。</div>
        </form>
      </div>
    </section>
  `;
}

function renderReviewList(selectedCycle) {
  if (!selectedCycle) {
    return `<section class="panel"><div class="empty">暂无批次</div></section>`;
  }

  const evaluations = state.app.evaluations.filter((item) => item.cycleId === selectedCycle.id);

  return `
    <section class="panel">
      <div class="panel-title">
        <h2>评分任务</h2>
        <span class="badge">${selectedCycle.name}</span>
      </div>
      <div class="list">
        ${state.app.people
          .map((person) => {
            const evaluation = evaluations.find((item) => item.personId === person.id);
            return `
              <div class="list-row">
                <div>
                  <strong>${person.name}</strong>
                  <div class="muted">${person.employeeNo} · ${person.department || "未设置部门"}</div>
                </div>
                <div class="inline-actions">
                  <span class="badge">${evaluation?.status === "submitted" ? "已提交" : "待评分"}</span>
                  <button class="button-primary" data-action="open-score" data-person-id="${person.id}">进入评分</button>
                </div>
              </div>`;
          })
          .join("")}
      </div>
    </section>
  `;
}

function renderAnalytics(selectedCycle) {
  if (!selectedCycle) {
    return `<section class="panel"><div class="empty">暂无批次</div></section>`;
  }

  return `
    <section class="panel">
      <div class="panel-title">
        <h2>统计分析</h2>
        <div class="inline-actions">
          <button class="button-secondary" data-action="export-results" data-format="csv">导出 CSV</button>
          <button class="button-secondary" data-action="export-results" data-format="json">导出 JSON</button>
          <button class="button-secondary" data-action="load-analytics">刷新统计</button>
        </div>
      </div>
      <div id="analytics-content" class="empty">点击“刷新统计”加载当前批次分析结果。</div>
    </section>
  `;
}

function renderScoreTab(selectedCycle) {
  if (!state.scoreContext) {
    return `
      <section class="panel">
        <div class="empty">请先从“评分任务”进入某个人员的评分详情。</div>
      </section>
    `;
  }

  const { person, evaluation } = state.scoreContext;
  return `
    <section class="score-card">
      <div class="score-header">
        <div>
          <h3>${person.name} 的评分表</h3>
          <div class="muted">${person.employeeNo} · ${person.department || "未设置部门"} · ${person.position || "未设置岗位"}</div>
        </div>
        <div class="score-actions">
          <span class="badge">总分率 ${scoreRateText(evaluation.result.scoreRate)}</span>
          <span class="badge">等级 ${evaluation.result.levelName}</span>
          ${
            evaluation.result.keyScoreRate !== null
              ? `<span class="badge key">关键项 ${scoreRateText(evaluation.result.keyScoreRate)}</span>`
              : ""
          }
          <button class="button-secondary" data-action="back-review">返回任务列表</button>
          <button class="button-primary" data-action="submit-score">提交评分</button>
        </div>
      </div>
      <div class="result-grid" style="margin: 18px 0;">
        <div class="metric-card"><div class="muted">原始分</div><div class="metric-value">${evaluation.result.rawScore}</div></div>
        <div class="metric-card"><div class="muted">加权得分</div><div class="metric-value">${evaluation.result.weightedScore}</div></div>
        <div class="metric-card"><div class="muted">满分</div><div class="metric-value">${evaluation.result.weightedMaxScore}</div></div>
        <div class="metric-card"><div class="muted">状态</div><div class="metric-value">${evaluation.status === "submitted" ? "已提交" : "草稿"}</div></div>
      </div>
      <div class="grid">
        ${evaluation.form.dimensions
          .map(
            (dimension) => `
              <div class="dimension-card">
                <div class="panel-title">
                  <h3>${dimension.name}</h3>
                  <span class="badge">
                    ${scoreRateText(
                      evaluation.result.dimensionSummaries.find((item) => item.dimensionId === dimension.id)?.scoreRate ?? 0
                    )}
                  </span>
                </div>
                <div class="grid">
                  ${dimension.categories
                    .map(
                      (category) => `
                        <div class="category-card">
                          <h4 style="margin: 0;">${category.name}</h4>
                          <div class="item-grid">
                            ${category.items
                              .map(
                                (item) => `
                                  <div class="item-row">
                                    <div>
                                      <strong>${item.title}</strong>
                                      <div class="muted">${item.description || "无说明"}</div>
                                    </div>
                                    <div class="inline-actions">
                                      <span class="badge">权重 ${item.weight}</span>
                                      ${
                                        item.isKeyItem
                                          ? `<span class="badge key">关键项</span>`
                                          : ""
                                      }
                                      <span class="badge">满分 ${item.maxWeightedScore}</span>
                                    </div>
                                    <div class="inline-actions">
                                      ${[0, 1, 3]
                                        .map(
                                          (score) => `
                                            <button class="score-choice ${Number(item.score) === score ? "active" : ""}" data-action="set-score" data-item-id="${item.id}" data-score="${score}">
                                              ${score}
                                            </button>`
                                        )
                                        .join("")}
                                    </div>
                                  </div>`
                              )
                              .join("")}
                          </div>
                        </div>`
                    )
                    .join("")}
                </div>
              </div>`
          )
          .join("")}
      </div>
    </section>
  `;
}

function bindEvents() {
  document.querySelectorAll("[data-tab]").forEach((button) =>
    button.addEventListener("click", () => {
      state.activeTab = button.dataset.tab;
      setMessage();
      render();
    })
  );

  document.querySelector('[data-action="logout"]')?.addEventListener("click", handleLogout);
  document.querySelector('[data-action="select-cycle"]')?.addEventListener("change", async (event) => {
    state.selectedCycleId = event.target.value;
    if (state.activeTab === "analytics") {
      render();
    } else {
      render();
    }
  });

  document.querySelector("#create-cycle-form")?.addEventListener("submit", handleCreateCycle);
  document.querySelector("#person-form")?.addEventListener("submit", handleCreatePerson);
  document.querySelector("#people-import-form")?.addEventListener("submit", handleImportPeople);
  document.querySelector("#framework-import-form")?.addEventListener("submit", handleImportFramework);
  document.querySelector("#framework-form")?.addEventListener("submit", handleSaveFramework);

  document.querySelectorAll('[data-action="activate-cycle"]').forEach((button) =>
    button.addEventListener("click", () => handleChangeCycleStatus(button.dataset.id, "active"))
  );
  document.querySelectorAll('[data-action="draft-cycle"]').forEach((button) =>
    button.addEventListener("click", () => handleChangeCycleStatus(button.dataset.id, "draft"))
  );
  document.querySelectorAll('[data-action="open-score"]').forEach((button) =>
    button.addEventListener("click", () => handleOpenScore(button.dataset.personId))
  );
  document.querySelector('[data-action="back-review"]')?.addEventListener("click", () => {
    state.activeTab = "review";
    render();
  });
  document.querySelector('[data-action="submit-score"]')?.addEventListener("click", handleSubmitScore);
  document.querySelectorAll('[data-action="set-score"]').forEach((button) =>
    button.addEventListener("click", () => handleSetScore(button.dataset.itemId, Number(button.dataset.score)))
  );
  document.querySelector('[data-action="load-analytics"]')?.addEventListener("click", handleLoadAnalytics);
  document.querySelectorAll('[data-action="export-results"]').forEach((button) =>
    button.addEventListener("click", () => handleExportResults(button.dataset.format))
  );

  bindFrameworkEditorEvents();
}

function bindFrameworkEditorEvents() {
  const selectedCycle = getSelectedCycle();
  if (!selectedCycle || selectedCycle.status !== "draft") {
    return;
  }

  document.querySelector('[data-action="add-level"]')?.addEventListener("click", () => {
    selectedCycle.framework.levels.push({
      id: crypto.randomUUID(),
      name: `L${selectedCycle.framework.levels.length + 1}`,
      order: selectedCycle.framework.levels.length + 1,
      minRate: 0,
      maxRate: 1,
      keyRule: { enabled: false, minKeyRate: "", disallowZeroKeyScore: false }
    });
    render();
  });

  document.querySelector('[data-action="add-dimension"]')?.addEventListener("click", () => {
    selectedCycle.framework.dimensions.push({
      id: crypto.randomUUID(),
      name: "新维度",
      categories: []
    });
    render();
  });

  document.querySelectorAll('[data-action="remove-level"]').forEach((button) =>
    button.addEventListener("click", () => {
      selectedCycle.framework.levels.splice(Number(button.dataset.index), 1);
      render();
    })
  );

  document.querySelectorAll('[data-action="remove-dimension"]').forEach((button) =>
    button.addEventListener("click", () => {
      selectedCycle.framework.dimensions.splice(Number(button.dataset.index), 1);
      render();
    })
  );

  document.querySelectorAll('[data-action="add-category"]').forEach((button) =>
    button.addEventListener("click", () => {
      selectedCycle.framework.dimensions[Number(button.dataset.dimensionIndex)].categories.push({
        id: crypto.randomUUID(),
        name: "新分类",
        items: []
      });
      render();
    })
  );

  document.querySelectorAll('[data-action="remove-category"]').forEach((button) =>
    button.addEventListener("click", () => {
      selectedCycle.framework.dimensions[Number(button.dataset.dimensionIndex)].categories.splice(
        Number(button.dataset.categoryIndex),
        1
      );
      render();
    })
  );

  document.querySelectorAll('[data-action="add-item"]').forEach((button) =>
    button.addEventListener("click", () => {
      selectedCycle.framework.dimensions[Number(button.dataset.dimensionIndex)].categories[
        Number(button.dataset.categoryIndex)
      ].items.push({
        id: crypto.randomUUID(),
        title: "新评分项",
        description: "",
        weight: 1,
        isKeyItem: false
      });
      render();
    })
  );

  document.querySelectorAll('[data-action="remove-item"]').forEach((button) =>
    button.addEventListener("click", () => {
      selectedCycle.framework.dimensions[Number(button.dataset.dimensionIndex)].categories[
        Number(button.dataset.categoryIndex)
      ].items.splice(Number(button.dataset.itemIndex), 1);
      render();
    })
  );
}

async function handleLogin(event) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  try {
    setMessage();
    const payload = await request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        username: formData.get("username"),
        password: formData.get("password")
      })
    });
    state.user = payload.user;
    state.activeTab = "dashboard";
    await bootstrap();
  } catch (error) {
    setMessage("", error.message);
    renderLogin();
  }
}

async function handleLogout() {
  await request("/api/auth/logout", { method: "POST" });
  state.user = null;
  state.app = null;
  state.scoreContext = null;
  setMessage();
  render();
}

async function refreshApp(message = "") {
  state.app = await request("/api/app-state");
  setMessage(message, "");
  render();
}

async function handleCreateCycle(event) {
  event.preventDefault();
  try {
    const formData = new FormData(event.currentTarget);
    await request("/api/cycles", {
      method: "POST",
      body: JSON.stringify({ name: formData.get("name") })
    });
    await refreshApp("批次已创建。");
  } catch (error) {
    setMessage("", error.message);
    render();
  }
}

async function handleChangeCycleStatus(cycleId, status) {
  try {
    await request(`/api/cycles/${cycleId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status })
    });
    await refreshApp(status === "active" ? "批次已激活，评价体系已冻结。" : "批次已切换为草稿。");
  } catch (error) {
    setMessage("", error.message);
    render();
  }
}

function collectFrameworkForm() {
  const selectedCycle = getSelectedCycle();
  const form = document.querySelector("#framework-form");
  const framework = structuredClone(selectedCycle.framework);
  framework.name = form.querySelector('[name="frameworkName"]').value;

  framework.levels = [...form.querySelectorAll("[data-level-index]")].map((element, index) => ({
    ...framework.levels[index],
    name: element.querySelector('[data-field="name"]').value,
    order: Number(element.querySelector('[data-field="order"]').value),
    minRate: Number(element.querySelector('[data-field="minRate"]').value),
    maxRate: Number(element.querySelector('[data-field="maxRate"]').value),
    keyRule: {
      enabled: element.querySelector('[data-field="keyEnabled"]').checked,
      minKeyRate: element.querySelector('[data-field="minKeyRate"]').value,
      disallowZeroKeyScore: element.querySelector('[data-field="disallowZeroKeyScore"]').checked
    }
  }));

  framework.dimensions = [...form.querySelectorAll("[data-dimension-index]")].map((dimensionElement, dimensionIndex) => ({
    ...framework.dimensions[dimensionIndex],
    name: dimensionElement.querySelector('[data-field="dimension-name"]').value,
    categories: [...dimensionElement.querySelectorAll("[data-category-index]")].map(
      (categoryElement, categoryIndex) => ({
        ...framework.dimensions[dimensionIndex].categories[categoryIndex],
        name: categoryElement.querySelector('[data-field="category-name"]').value,
        items: [...categoryElement.querySelectorAll(".item-row")].map((itemElement, itemIndex) => ({
          ...framework.dimensions[dimensionIndex].categories[categoryIndex].items[itemIndex],
          title: itemElement.querySelector('[data-field="item-title"]').value,
          description: itemElement.querySelector('[data-field="item-description"]').value,
          weight: Number(itemElement.querySelector('[data-field="item-weight"]').value),
          isKeyItem: itemElement.querySelector('[data-field="item-key"]').checked
        }))
      })
    )
  }));

  return framework;
}

async function handleSaveFramework(event) {
  event.preventDefault();
  try {
    const framework = collectFrameworkForm();
    await request(`/api/cycles/${state.selectedCycleId}/framework`, {
      method: "PUT",
      body: JSON.stringify(framework)
    });
    await refreshApp("评价体系已保存。");
  } catch (error) {
    setMessage("", error.message);
    render();
  }
}

async function handleCreatePerson(event) {
  event.preventDefault();
  try {
    const formData = new FormData(event.currentTarget);
    await request("/api/people", {
      method: "POST",
      body: JSON.stringify({
        employeeNo: formData.get("employeeNo"),
        name: formData.get("name"),
        department: formData.get("department"),
        position: formData.get("position")
      })
    });
    await refreshApp("人员已添加。");
  } catch (error) {
    setMessage("", error.message);
    render();
  }
}

async function handleImportPeople(event) {
  event.preventDefault();
  try {
    const formData = new FormData(event.currentTarget);
    const result = await request("/api/import/people", {
      method: "POST",
      body: JSON.stringify({
        mode: formData.get("mode"),
        content: formData.get("content")
      })
    });
    await refreshApp(`人员导入完成：共 ${result.total} 行，新增 ${result.created}，更新 ${result.updated}。`);
  } catch (error) {
    setMessage("", error.message);
    render();
  }
}

async function handleImportFramework(event) {
  event.preventDefault();
  try {
    const formData = new FormData(event.currentTarget);
    await request(`/api/cycles/${state.selectedCycleId}/framework/import`, {
      method: "POST",
      body: JSON.stringify({
        content: formData.get("content")
      })
    });
    await refreshApp("评价体系已导入到当前草稿批次。");
  } catch (error) {
    setMessage("", error.message);
    render();
  }
}

async function handleOpenScore(personId) {
  try {
    const payload = await request(`/api/evaluations/${state.selectedCycleId}/people/${personId}/form`);
    state.scoreContext = payload;
    state.activeTab = "score";
    setMessage();
    render();
  } catch (error) {
    setMessage("", error.message);
    render();
  }
}

async function handleSetScore(itemId, score) {
  try {
    const scores = collectCurrentScores();
    scores[itemId] = score;
    const payload = await request(
      `/api/evaluations/${state.selectedCycleId}/people/${state.scoreContext.person.id}/scores`,
      {
        method: "PUT",
        body: JSON.stringify({ scores })
      }
    );
    state.scoreContext.evaluation = payload;
    await refreshEvaluationSummary();
  } catch (error) {
    setMessage("", error.message);
    render();
  }
}

function collectCurrentScores() {
  const scores = {};
  for (const dimension of state.scoreContext.evaluation.form.dimensions) {
    for (const category of dimension.categories) {
      for (const item of category.items) {
        scores[item.id] = Number(item.score ?? 0);
      }
    }
  }
  return scores;
}

async function refreshEvaluationSummary() {
  state.app = await request("/api/app-state");
  render();
}

async function handleSubmitScore() {
  try {
    const payload = await request(
      `/api/evaluations/${state.selectedCycleId}/people/${state.scoreContext.person.id}/submit`,
      {
        method: "POST"
      }
    );
    state.scoreContext.evaluation = payload;
    await refreshApp("评分已提交。");
    state.activeTab = "score";
    render();
  } catch (error) {
    setMessage("", error.message);
    render();
  }
}

async function handleLoadAnalytics() {
  try {
    const payload = await request(`/api/results/${state.selectedCycleId}/analytics`);
    document.querySelector("#analytics-content").outerHTML = `
      <div id="analytics-content" class="grid">
        <div class="metric-grid">
          ${payload.levelDistribution
            .map(
              (item) => `
                <div class="metric-card">
                  <div class="muted">${item.levelName}</div>
                  <div class="metric-value">${item.count}</div>
                  <div class="muted">占比 ${scoreRateText(item.percentage)}</div>
                </div>`
            )
            .join("") || `<div class="empty">暂无已评数据</div>`}
        </div>
        <section class="panel">
          <div class="panel-title"><h3>维度平均得分率</h3></div>
          <table class="table">
            <thead><tr><th>维度</th><th>平均得分率</th></tr></thead>
            <tbody>
              ${payload.dimensionAverages
                .map(
                  (item) => `
                    <tr>
                      <td>${item.dimensionName}</td>
                      <td>${scoreRateText(item.averageScoreRate)}</td>
                    </tr>`
                )
                .join("") || `<tr><td colspan="2">暂无数据</td></tr>`}
            </tbody>
          </table>
        </section>
        <section class="panel">
          <div class="panel-title"><h3>部门分布</h3></div>
          <table class="table">
            <thead><tr><th>部门</th><th>人数</th><th>平均得分率</th></tr></thead>
            <tbody>
              ${payload.departmentDistribution
                .map(
                  (item) => `
                    <tr>
                      <td>${item.department}</td>
                      <td>${item.count}</td>
                      <td>${scoreRateText(item.averageScoreRate)}</td>
                    </tr>`
                )
                .join("") || `<tr><td colspan="3">暂无数据</td></tr>`}
            </tbody>
          </table>
        </section>
        <section class="panel">
          <div class="panel-title"><h3>岗位分布</h3></div>
          <table class="table">
            <thead><tr><th>岗位</th><th>人数</th><th>平均得分率</th></tr></thead>
            <tbody>
              ${payload.positionDistribution
                .map(
                  (item) => `
                    <tr>
                      <td>${item.position}</td>
                      <td>${item.count}</td>
                      <td>${scoreRateText(item.averageScoreRate)}</td>
                    </tr>`
                )
                .join("") || `<tr><td colspan="3">暂无数据</td></tr>`}
            </tbody>
          </table>
        </section>
        <section class="panel">
          <div class="panel-title"><h3>个人结果</h3></div>
          <table class="table">
            <thead><tr><th>姓名</th><th>工号</th><th>等级</th><th>总得分率</th><th>关键项</th><th>状态</th></tr></thead>
            <tbody>
              ${payload.personalResults
                .map(
                  (item) => `
                    <tr>
                      <td>${item.personName}</td>
                      <td>${item.employeeNo}</td>
                      <td>${item.levelName}</td>
                      <td>${scoreRateText(item.scoreRate)}</td>
                      <td>${item.keyScoreRate === null ? "-" : scoreRateText(item.keyScoreRate)}</td>
                      <td>${item.status}</td>
                    </tr>`
                )
                .join("") || `<tr><td colspan="6">暂无数据</td></tr>`}
            </tbody>
          </table>
        </section>
      </div>
    `;
  } catch (error) {
    setMessage("", error.message);
    render();
  }
}

async function handleExportResults(format) {
  try {
    window.open(`/api/results/${state.selectedCycleId}/export?format=${format}`, "_blank");
  } catch (error) {
    setMessage("", error.message);
    render();
  }
}

bootstrap();
