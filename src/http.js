export class HttpError extends Error {
  constructor(statusCode, message, details = null) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
  }
}

export function assert(condition, statusCode, message, details = null) {
  if (!condition) {
    throw new HttpError(statusCode, message, details);
  }
}

export function parseJsonBody(text) {
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new HttpError(400, "请求体不是合法 JSON");
  }
}

export function parseListQuery(searchParams, options = {}) {
  const defaultSortBy = options.defaultSortBy ?? "createdAt";
  const sortBy = searchParams.get("sortBy") || defaultSortBy;
  const sortOrder = searchParams.get("sortOrder") === "asc" ? "asc" : "desc";
  const page = Math.max(1, Number(searchParams.get("page") || 1));
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get("pageSize") || 10)));
  const keyword = (searchParams.get("keyword") || "").trim();
  return { page, pageSize, keyword, sortBy, sortOrder };
}

export function paginate(items, query) {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / query.pageSize));
  const page = Math.min(query.page, totalPages);
  const start = (page - 1) * query.pageSize;
  return {
    items: items.slice(start, start + query.pageSize),
    pagination: {
      page,
      pageSize: query.pageSize,
      total,
      totalPages
    }
  };
}
