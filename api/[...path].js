const trimTrailingSlash = (value = "") => String(value).replace(/\/+$/, "");

const buildQueryString = (query = {}) => {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (key === "path" || value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach((entry) => params.append(key, String(entry)));
      return;
    }
    params.append(key, String(value));
  });
  return params.toString();
};

const buildTargetUrl = (req, backendBaseUrl) => {
  const pathParts = Array.isArray(req.query?.path)
    ? req.query.path
    : [req.query?.path].filter(Boolean);
  const safePath = pathParts
    .map((part) => encodeURIComponent(String(part)))
    .join("/");
  const queryString = buildQueryString(req.query || {});
  const suffix = queryString ? `?${queryString}` : "";
  return `${trimTrailingSlash(backendBaseUrl)}/${safePath}${suffix}`;
};

const toUpstreamHeaders = (req, hasBody) => {
  const headers = new Headers();
  Object.entries(req.headers || {}).forEach(([key, value]) => {
    if (!value) return;
    const normalizedKey = key.toLowerCase();
    if (
      normalizedKey === "host" ||
      normalizedKey === "content-length" ||
      normalizedKey === "x-forwarded-host" ||
      normalizedKey === "x-forwarded-port" ||
      normalizedKey === "x-vercel-id" ||
      normalizedKey === "x-vercel-deployment-url"
    ) {
      return;
    }
    if (Array.isArray(value)) {
      headers.set(key, value.join(", "));
      return;
    }
    headers.set(key, String(value));
  });

  if (hasBody && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  return headers;
};

const getRequestBody = (req, hasBody) => {
  if (!hasBody) return undefined;
  if (req.body === undefined || req.body === null) return undefined;
  if (typeof req.body === "string" || Buffer.isBuffer(req.body)) {
    return req.body;
  }
  return JSON.stringify(req.body);
};

module.exports = async (req, res) => {
  const backendBaseUrl = trimTrailingSlash(
    process.env.BACKEND_API_URL || process.env.VITE_API_URL || ""
  );
  if (!backendBaseUrl) {
    res.status(500).json({
      success: false,
      error: "BACKEND_API_URL is not configured",
      details: "Set BACKEND_API_URL in your Vercel project environment variables.",
    });
    return;
  }

  const method = String(req.method || "GET").toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD";

  try {
    const upstream = await fetch(buildTargetUrl(req, backendBaseUrl), {
      method,
      headers: toUpstreamHeaders(req, hasBody),
      body: getRequestBody(req, hasBody),
      redirect: "manual",
    });

    const setCookie =
      typeof upstream.headers.getSetCookie === "function"
        ? upstream.headers.getSetCookie()
        : [];
    if (Array.isArray(setCookie) && setCookie.length > 0) {
      res.setHeader("set-cookie", setCookie);
    } else {
      const singleSetCookie = upstream.headers.get("set-cookie");
      if (singleSetCookie) {
        res.setHeader("set-cookie", singleSetCookie);
      }
    }

    const contentType = upstream.headers.get("content-type");
    if (contentType) {
      res.setHeader("content-type", contentType);
    }
    const cacheControl = upstream.headers.get("cache-control");
    if (cacheControl) {
      res.setHeader("cache-control", cacheControl);
    }

    const body = Buffer.from(await upstream.arrayBuffer());
    res.status(upstream.status).send(body);
  } catch (error) {
    res.status(502).json({
      success: false,
      error: "Failed to reach backend API",
      details: error instanceof Error ? error.message : String(error),
    });
  }
};
