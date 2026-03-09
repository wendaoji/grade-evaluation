import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { HttpError, parseJsonBody, parseListQuery } from "./http.js";
import {
  applyFrameworkTemplate,
  authenticate,
  authenticateSSO,
  backupDatabase,
  changeReviewStatus,
  createCycle,
  createPerson,
  exportCycleResults,
  getAuditLogs,
  getCyclesList,
  getCycleAnalytics,
  getCyclePersonalResults,
  getEvaluationForm,
  getFrameworkTemplates,
  getMonitoringSnapshot,
  getPeopleList,
  getPersonResult,
  getPublicAppState,
  getReviewForm,
  getReviewSubmissions,
  getTrendAnalytics,
  importFrameworkToCycle,
  importPeopleBatch,
  recordAuditLog,
  saveEvaluationScores,
  saveReviewScores,
  submitReview,
  submitEvaluation,
  updateCycleStatus,
  updateFramework,
  updatePerson
} from "./store.js";

const sessions = new Map();
const publicDir = path.resolve(process.cwd(), "public");
const port = Number(process.env.PORT ?? 3000);
const permissions = {
  admin: new Set(["*"]),
  reviewer: new Set(["review:peer", "results:view", "cycles:view", "people:view"]),
  employee: new Set(["review:self", "results:view:self", "cycles:view"]),
  supervisor: new Set(["review:supervisor", "review:approve", "results:view", "cycles:view", "people:view"]),
  auditor: new Set(["audit:view", "results:view", "cycles:view", "people:view"])
};

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(payload));
}

function sendContent(response, statusCode, body, contentType, filename) {
  response.writeHead(statusCode, {
    "Content-Type": contentType,
    ...(filename ? { "Content-Disposition": `attachment; filename=\"${filename}\"` } : {})
  });
  response.end(body);
}

function sendText(response, statusCode, payload, contentType = "text/plain; charset=utf-8") {
  response.writeHead(statusCode, { "Content-Type": contentType });
  response.end(payload);
}

function parseCookies(request) {
  const cookieHeader = request.headers.cookie ?? "";
  return Object.fromEntries(
    cookieHeader
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      })
  );
}

function getSessionUser(request) {
  const cookies = parseCookies(request);
  const sessionId = cookies.sessionId;
  if (!sessionId) {
    return null;
  }
  return sessions.get(sessionId) ?? null;
}

function requireUser(request, response) {
  const user = getSessionUser(request);
  if (!user) {
    sendJson(response, 401, { message: "请先登录" });
    return null;
  }
  return user;
}

function requireAdmin(request, response) {
  const user = requireUser(request, response);
  if (!user) {
    return null;
  }
  if (user.role !== "admin") {
    sendJson(response, 403, { message: "仅管理员可执行该操作" });
    return null;
  }
  return user;
}

function hasPermission(user, permission) {
  const rolePermissions = permissions[user.role] ?? new Set();
  return rolePermissions.has("*") || rolePermissions.has(permission);
}

function requirePermission(request, response, permission) {
  const user = requireUser(request, response);
  if (!user) {
    return null;
  }
  if (!hasPermission(user, permission)) {
    sendJson(response, 403, { message: "当前角色无权限执行该操作" });
    return null;
  }
  return user;
}

function audit(user, action, entityType, entityId, details = {}) {
  recordAuditLog(action, entityType, entityId, details, user?.id ?? null);
}

function resolveReviewType(user, explicitReviewType) {
  const reviewType =
    explicitReviewType || (user.role === "employee" ? "self" : user.role === "supervisor" ? "supervisor" : "peer");
  const permissionMap = {
    self: "review:self",
    peer: "review:peer",
    supervisor: "review:supervisor"
  };
  if (!hasPermission(user, permissionMap[reviewType])) {
    throw new HttpError(403, "当前角色无权使用该评审类型");
  }
  return reviewType;
}

function assertReviewTargetAccess(user, personId) {
  if (user.role === "employee" && user.person_id && user.person_id !== personId) {
    throw new HttpError(403, "员工仅能对本人进行自评");
  }
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return parseJsonBody(text);
}

function serveStatic(request, response) {
  const requestPath = request.url === "/" ? "/index.html" : request.url;
  const filePath = path.join(publicDir, requestPath.split("?")[0]);
  if (!filePath.startsWith(publicDir) || !fs.existsSync(filePath)) {
    sendText(response, 404, "Not Found");
    return;
  }
  const ext = path.extname(filePath);
  const contentTypes = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8"
  };
  sendText(response, 200, fs.readFileSync(filePath), contentTypes[ext] ?? "application/octet-stream");
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const method = request.method ?? "GET";

    if (method === "GET" && url.pathname === "/healthz") {
      sendJson(response, 200, { status: "ok" });
      return;
    }

    if (method === "GET" && url.pathname === "/readyz") {
      sendJson(response, 200, { status: "ready", snapshot: getMonitoringSnapshot() });
      return;
    }

    if (method === "GET" && url.pathname === "/metrics") {
      sendJson(response, 200, getMonitoringSnapshot());
      return;
    }

    if (method === "POST" && url.pathname === "/api/auth/login") {
      const body = await readBody(request);
      if (!body.username || !body.password) {
        throw new HttpError(400, "用户名和密码不能为空");
      }
      const user = authenticate(body.username, body.password);
      if (!user) {
        throw new HttpError(401, "用户名或密码错误");
      }
      const sessionId = randomUUID();
      sessions.set(sessionId, user);
      response.setHeader("Set-Cookie", `sessionId=${sessionId}; HttpOnly; Path=/; SameSite=Lax`);
      sendJson(response, 200, { user });
      return;
    }

    if (method === "POST" && url.pathname === "/api/auth/sso-login") {
      const username = request.headers["x-sso-user"] || url.searchParams.get("username");
      if (!username) {
        throw new HttpError(400, "缺少 SSO 用户标识");
      }
      const user = authenticateSSO(String(username));
      if (!user) {
        throw new HttpError(401, "SSO 用户未映射到系统账号");
      }
      const sessionId = randomUUID();
      sessions.set(sessionId, user);
      response.setHeader("Set-Cookie", `sessionId=${sessionId}; HttpOnly; Path=/; SameSite=Lax`);
      sendJson(response, 200, { user, mode: "sso" });
      return;
    }

    if (method === "POST" && url.pathname === "/api/auth/logout") {
      const cookies = parseCookies(request);
      if (cookies.sessionId) {
        sessions.delete(cookies.sessionId);
      }
      response.setHeader("Set-Cookie", "sessionId=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax");
      sendJson(response, 200, { ok: true });
      return;
    }

    if (method === "GET" && url.pathname === "/api/auth/me") {
      const user = requireUser(request, response);
      if (!user) {
        return;
      }
      sendJson(response, 200, { user });
      return;
    }

    if (method === "GET" && url.pathname === "/api/app-state") {
      const user = requireUser(request, response);
      if (!user) {
        return;
      }
      sendJson(response, 200, getPublicAppState(user.role, user.id));
      return;
    }

    if (method === "GET" && url.pathname === "/api/framework-templates") {
      if (!requireUser(request, response)) {
        return;
      }
      sendJson(response, 200, { items: getFrameworkTemplates() });
      return;
    }

    if (method === "GET" && url.pathname === "/api/results/trends") {
      if (!requirePermission(request, response, "results:view")) {
        return;
      }
      sendJson(response, 200, getTrendAnalytics());
      return;
    }

    if (method === "GET" && url.pathname === "/api/audit-logs") {
      if (!requirePermission(request, response, "audit:view")) {
        return;
      }
      sendJson(response, 200, getAuditLogs(parseListQuery(url.searchParams)));
      return;
    }

    if (method === "POST" && url.pathname === "/api/admin/backup") {
      const user = requireAdmin(request, response);
      if (!user) {
        return;
      }
      const result = backupDatabase();
      audit(user, "backup.create", "backup", result.filename, result);
      sendJson(response, 200, result);
      return;
    }

    if (method === "GET" && url.pathname === "/api/cycles") {
      if (!requirePermission(request, response, "cycles:view")) {
        return;
      }
      sendJson(response, 200, getCyclesList(parseListQuery(url.searchParams)));
      return;
    }

    if (method === "POST" && url.pathname === "/api/cycles") {
      const user = requireAdmin(request, response);
      if (!user) {
        return;
      }
      const body = await readBody(request);
      const cycle = createCycle(body);
      audit(user, "cycle.create", "cycle", cycle.id, { name: cycle.name });
      sendJson(response, 201, cycle);
      return;
    }

    const cycleStatusMatch = url.pathname.match(/^\/api\/cycles\/([^/]+)\/status$/);
    if (method === "PATCH" && cycleStatusMatch) {
      const user = requireAdmin(request, response);
      if (!user) {
        return;
      }
      const body = await readBody(request);
      const cycle = updateCycleStatus(cycleStatusMatch[1], body.status);
      audit(user, "cycle.status", "cycle", cycle.id, { status: body.status });
      sendJson(response, 200, cycle);
      return;
    }

    const frameworkMatch = url.pathname.match(/^\/api\/cycles\/([^/]+)\/framework$/);
    if (method === "PUT" && frameworkMatch) {
      const user = requireAdmin(request, response);
      if (!user) {
        return;
      }
      const body = await readBody(request);
      const framework = updateFramework(frameworkMatch[1], body);
      audit(user, "framework.update", "cycle", frameworkMatch[1], { frameworkId: framework.id });
      sendJson(response, 200, framework);
      return;
    }

    const frameworkImportMatch = url.pathname.match(/^\/api\/cycles\/([^/]+)\/framework\/import$/);
    if (method === "POST" && frameworkImportMatch) {
      const user = requireAdmin(request, response);
      if (!user) {
        return;
      }
      const body = await readBody(request);
      const framework = importFrameworkToCycle(frameworkImportMatch[1], body);
      audit(user, "framework.import", "cycle", frameworkImportMatch[1], { frameworkId: framework.id });
      sendJson(response, 200, framework);
      return;
    }

    const frameworkTemplateMatch = url.pathname.match(/^\/api\/cycles\/([^/]+)\/framework\/apply-template$/);
    if (method === "POST" && frameworkTemplateMatch) {
      const user = requireAdmin(request, response);
      if (!user) {
        return;
      }
      const body = await readBody(request);
      const framework = applyFrameworkTemplate(frameworkTemplateMatch[1], body.templateId);
      audit(user, "framework.applyTemplate", "cycle", frameworkTemplateMatch[1], { templateId: body.templateId });
      sendJson(response, 200, framework);
      return;
    }

    if (method === "POST" && url.pathname === "/api/people") {
      const user = requireAdmin(request, response);
      if (!user) {
        return;
      }
      const body = await readBody(request);
      const person = createPerson(body);
      audit(user, "person.create", "person", person.id, { employeeNo: person.employeeNo });
      sendJson(response, 201, person);
      return;
    }

    if (method === "POST" && url.pathname === "/api/import/people") {
      const user = requireAdmin(request, response);
      if (!user) {
        return;
      }
      const body = await readBody(request);
      const result = importPeopleBatch(body);
      audit(user, "people.import", "people", "batch", result);
      sendJson(response, 200, result);
      return;
    }

    if (method === "GET" && url.pathname === "/api/people") {
      if (!requirePermission(request, response, "people:view")) {
        return;
      }
      sendJson(response, 200, getPeopleList(parseListQuery(url.searchParams, { defaultSortBy: "employeeNo" })));
      return;
    }

    const personMatch = url.pathname.match(/^\/api\/people\/([^/]+)$/);
    if (method === "PUT" && personMatch) {
      const user = requireAdmin(request, response);
      if (!user) {
        return;
      }
      const body = await readBody(request);
      const person = updatePerson(personMatch[1], body);
      audit(user, "person.update", "person", person.id, { employeeNo: person.employeeNo });
      sendJson(response, 200, person);
      return;
    }

    const evaluationFormMatch = url.pathname.match(/^\/api\/evaluations\/([^/]+)\/people\/([^/]+)\/form$/);
    if (method === "GET" && evaluationFormMatch) {
      if (!requireUser(request, response)) {
        return;
      }
      const [_, cycleId, personId] = evaluationFormMatch;
      sendJson(response, 200, getEvaluationForm(cycleId, personId));
      return;
    }

    const evaluationScoresMatch = url.pathname.match(
      /^\/api\/evaluations\/([^/]+)\/people\/([^/]+)\/scores$/
    );
    if (method === "PUT" && evaluationScoresMatch) {
      if (!requireUser(request, response)) {
        return;
      }
      const body = await readBody(request);
      const [_, cycleId, personId] = evaluationScoresMatch;
      sendJson(response, 200, saveEvaluationScores(cycleId, personId, body.scores));
      return;
    }

    const evaluationSubmitMatch = url.pathname.match(
      /^\/api\/evaluations\/([^/]+)\/people\/([^/]+)\/submit$/
    );
    if (method === "POST" && evaluationSubmitMatch) {
      if (!requireUser(request, response)) {
        return;
      }
      const [_, cycleId, personId] = evaluationSubmitMatch;
      sendJson(response, 200, submitEvaluation(cycleId, personId));
      return;
    }

    const resultMatch = url.pathname.match(/^\/api\/results\/([^/]+)\/people\/([^/]+)$/);
    if (method === "GET" && resultMatch) {
      const user = requireUser(request, response);
      if (!user) {
        return;
      }
      const [_, cycleId, personId] = resultMatch;
      if (user.role === "employee" && user.person_id !== personId) {
        throw new HttpError(403, "员工仅能查看本人结果");
      }
      if (user.role !== "employee" && !hasPermission(user, "results:view")) {
        throw new HttpError(403, "当前角色无权限查看结果");
      }
      sendJson(response, 200, getPersonResult(cycleId, personId));
      return;
    }

    const analyticsMatch = url.pathname.match(/^\/api\/results\/([^/]+)\/analytics$/);
    if (method === "GET" && analyticsMatch) {
      if (!requirePermission(request, response, "results:view")) {
        return;
      }
      sendJson(response, 200, getCycleAnalytics(analyticsMatch[1]));
      return;
    }

    const exportMatch = url.pathname.match(/^\/api\/results\/([^/]+)\/export$/);
    if (method === "GET" && exportMatch) {
      if (!requirePermission(request, response, "results:view")) {
        return;
      }
      const exported = exportCycleResults(exportMatch[1], url.searchParams.get("format") || "csv");
      sendContent(response, 200, exported.body, exported.contentType, exported.filename);
      return;
    }

    const personalResultsMatch = url.pathname.match(/^\/api\/results\/([^/]+)\/personal-results$/);
    if (method === "GET" && personalResultsMatch) {
      if (!requirePermission(request, response, "results:view")) {
        return;
      }
      sendJson(
        response,
        200,
        getCyclePersonalResults(
          personalResultsMatch[1],
          parseListQuery(url.searchParams, { defaultSortBy: "scoreRate" })
        )
      );
      return;
    }

    const reviewListMatch = url.pathname.match(/^\/api\/reviews\/([^/]+)\/people\/([^/]+)$/);
    if (method === "GET" && reviewListMatch) {
      const user = requireUser(request, response);
      if (!user) {
        return;
      }
      assertReviewTargetAccess(user, reviewListMatch[2]);
      sendJson(response, 200, { items: getReviewSubmissions(reviewListMatch[1], reviewListMatch[2]) });
      return;
    }

    const reviewFormMatch = url.pathname.match(/^\/api\/reviews\/([^/]+)\/people\/([^/]+)\/form$/);
    if (method === "GET" && reviewFormMatch) {
      const user = requireUser(request, response);
      if (!user) {
        return;
      }
      assertReviewTargetAccess(user, reviewFormMatch[2]);
      const reviewType = resolveReviewType(user, url.searchParams.get("reviewType"));
      sendJson(response, 200, getReviewForm(reviewFormMatch[1], reviewFormMatch[2], user.id, reviewType));
      return;
    }

    const reviewScoresMatch = url.pathname.match(/^\/api\/reviews\/([^/]+)\/people\/([^/]+)\/scores$/);
    if (method === "PUT" && reviewScoresMatch) {
      const user = requireUser(request, response);
      if (!user) {
        return;
      }
      assertReviewTargetAccess(user, reviewScoresMatch[2]);
      const body = await readBody(request);
      const reviewType = resolveReviewType(user, body.reviewType);
      const result = saveReviewScores(reviewScoresMatch[1], reviewScoresMatch[2], user.id, reviewType, body.scores, body.comments || "");
      audit(user, "review.save", "review", result.submission.id, { reviewType, personId: reviewScoresMatch[2] });
      sendJson(response, 200, result);
      return;
    }

    const reviewSubmitMatch = url.pathname.match(/^\/api\/reviews\/([^/]+)\/people\/([^/]+)\/submit$/);
    if (method === "POST" && reviewSubmitMatch) {
      const user = requireUser(request, response);
      if (!user) {
        return;
      }
      assertReviewTargetAccess(user, reviewSubmitMatch[2]);
      const body = await readBody(request);
      const reviewType = resolveReviewType(user, body.reviewType);
      const result = submitReview(reviewSubmitMatch[1], reviewSubmitMatch[2], user.id, reviewType, body.comments || "");
      audit(user, "review.submit", "review", result.submission.id, { reviewType, personId: reviewSubmitMatch[2] });
      sendJson(response, 200, result);
      return;
    }

    const reviewStatusMatch = url.pathname.match(/^\/api\/reviews\/([^/]+)\/status$/);
    if (method === "PATCH" && reviewStatusMatch) {
      const user = requirePermission(request, response, "review:approve");
      if (!user) {
        return;
      }
      const body = await readBody(request);
      const result = changeReviewStatus(reviewStatusMatch[1], body.status);
      audit(user, "review.status", "review", reviewStatusMatch[1], { status: body.status });
      sendJson(response, 200, result);
      return;
    }

    if (!url.pathname.startsWith("/api/")) {
      serveStatic(request, response);
      return;
    }

    sendJson(response, 404, { message: "接口不存在" });
  } catch (error) {
    const statusCode = error instanceof HttpError ? error.statusCode : 500;
    sendJson(response, statusCode, {
      message: error.message || "请求处理失败",
      details: error instanceof HttpError ? error.details : undefined
    });
  }
});

server.listen(port, () => {
  console.log(`Grade evaluation app is running at http://localhost:${port}`);
});
