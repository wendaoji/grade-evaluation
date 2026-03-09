import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { HttpError, parseJsonBody, parseListQuery } from "./http.js";
import {
  authenticate,
  createCycle,
  createPerson,
  exportCycleResults,
  getCyclesList,
  getCycleAnalytics,
  getCyclePersonalResults,
  getEvaluationForm,
  getPeopleList,
  getPersonResult,
  getPublicAppState,
  importFrameworkToCycle,
  importPeopleBatch,
  saveEvaluationScores,
  submitEvaluation,
  updateCycleStatus,
  updateFramework,
  updatePerson
} from "./store.js";

const sessions = new Map();
const publicDir = path.resolve(process.cwd(), "public");
const port = Number(process.env.PORT ?? 3000);

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
      sendJson(response, 200, getPublicAppState(user.role));
      return;
    }

    if (method === "GET" && url.pathname === "/api/cycles") {
      if (!requireUser(request, response)) {
        return;
      }
      sendJson(response, 200, getCyclesList(parseListQuery(url.searchParams)));
      return;
    }

    if (method === "POST" && url.pathname === "/api/cycles") {
      if (!requireAdmin(request, response)) {
        return;
      }
      const body = await readBody(request);
      sendJson(response, 201, createCycle(body));
      return;
    }

    const cycleStatusMatch = url.pathname.match(/^\/api\/cycles\/([^/]+)\/status$/);
    if (method === "PATCH" && cycleStatusMatch) {
      if (!requireAdmin(request, response)) {
        return;
      }
      const body = await readBody(request);
      sendJson(response, 200, updateCycleStatus(cycleStatusMatch[1], body.status));
      return;
    }

    const frameworkMatch = url.pathname.match(/^\/api\/cycles\/([^/]+)\/framework$/);
    if (method === "PUT" && frameworkMatch) {
      if (!requireAdmin(request, response)) {
        return;
      }
      const body = await readBody(request);
      sendJson(response, 200, updateFramework(frameworkMatch[1], body));
      return;
    }

    const frameworkImportMatch = url.pathname.match(/^\/api\/cycles\/([^/]+)\/framework\/import$/);
    if (method === "POST" && frameworkImportMatch) {
      if (!requireAdmin(request, response)) {
        return;
      }
      const body = await readBody(request);
      sendJson(response, 200, importFrameworkToCycle(frameworkImportMatch[1], body));
      return;
    }

    if (method === "POST" && url.pathname === "/api/people") {
      if (!requireAdmin(request, response)) {
        return;
      }
      const body = await readBody(request);
      sendJson(response, 201, createPerson(body));
      return;
    }

    if (method === "POST" && url.pathname === "/api/import/people") {
      if (!requireAdmin(request, response)) {
        return;
      }
      const body = await readBody(request);
      sendJson(response, 200, importPeopleBatch(body));
      return;
    }

    if (method === "GET" && url.pathname === "/api/people") {
      if (!requireUser(request, response)) {
        return;
      }
      sendJson(response, 200, getPeopleList(parseListQuery(url.searchParams, { defaultSortBy: "employeeNo" })));
      return;
    }

    const personMatch = url.pathname.match(/^\/api\/people\/([^/]+)$/);
    if (method === "PUT" && personMatch) {
      if (!requireAdmin(request, response)) {
        return;
      }
      const body = await readBody(request);
      sendJson(response, 200, updatePerson(personMatch[1], body));
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
      if (!requireUser(request, response)) {
        return;
      }
      const [_, cycleId, personId] = resultMatch;
      sendJson(response, 200, getPersonResult(cycleId, personId));
      return;
    }

    const analyticsMatch = url.pathname.match(/^\/api\/results\/([^/]+)\/analytics$/);
    if (method === "GET" && analyticsMatch) {
      if (!requireUser(request, response)) {
        return;
      }
      sendJson(response, 200, getCycleAnalytics(analyticsMatch[1]));
      return;
    }

    const exportMatch = url.pathname.match(/^\/api\/results\/([^/]+)\/export$/);
    if (method === "GET" && exportMatch) {
      if (!requireUser(request, response)) {
        return;
      }
      const exported = exportCycleResults(exportMatch[1], url.searchParams.get("format") || "csv");
      sendContent(response, 200, exported.body, exported.contentType, exported.filename);
      return;
    }

    const personalResultsMatch = url.pathname.match(/^\/api\/results\/([^/]+)\/personal-results$/);
    if (method === "GET" && personalResultsMatch) {
      if (!requireUser(request, response)) {
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
