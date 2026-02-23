const trimTrailingSlash = (value: string): string => value.replace(/\/+$/, "");
const PRODUCTION_PROXY_BASE = "/api";

const isLocalhost = (hostname: string): boolean => {
  return hostname === "localhost" || hostname === "127.0.0.1";
};

export const getApiBaseUrl = (): string => {
  const fromEnv = (import.meta.env.VITE_API_URL || "").trim();
  if (fromEnv) {
    return trimTrailingSlash(fromEnv);
  }

  if (typeof window === "undefined") {
    return "http://localhost:4000";
  }

  const { hostname } = window.location;

  if (isLocalhost(hostname)) {
    return `http://${hostname}:4000`;
  }

  // In production, route API calls through same-origin proxy (/api/*).
  return PRODUCTION_PROXY_BASE;
};

export const apiUrl = (path: string): string => {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${trimTrailingSlash(getApiBaseUrl())}${normalizedPath}`;
};
