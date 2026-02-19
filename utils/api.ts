const trimTrailingSlash = (value: string): string => value.replace(/\/+$/, "");

export const getApiBaseUrl = (): string => {
  const fromEnv = (import.meta.env.VITE_API_URL || "").trim();
  if (fromEnv) {
    return trimTrailingSlash(fromEnv);
  }

  if (typeof window === "undefined") {
    return "http://localhost:4000";
  }

  const { protocol, hostname, port } = window.location;
  const isLocalhost = hostname === "localhost" || hostname === "127.0.0.1";

  if (isLocalhost) {
    return `http://${hostname}:4000`;
  }

  return trimTrailingSlash(`${protocol}//${hostname}${port ? `:${port}` : ""}`);
};

export const apiUrl = (path: string): string => {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${getApiBaseUrl()}${normalizedPath}`;
};
