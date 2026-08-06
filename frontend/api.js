(function initIntellectualTwinApi(global) {
  const runtimeConfig = global.INTELLECTUAL_TWIN_CONFIG || {};
  const apiBaseUrl = normalizeBaseUrl(runtimeConfig.apiBaseUrl || "");
  const configuredAssetBase = Object.prototype.hasOwnProperty.call(runtimeConfig, "assetBaseUrl")
    ? runtimeConfig.assetBaseUrl
    : global.__MEIDS_ASSET_BASE__ || "/static";
  const assetBaseUrl = normalizeBaseUrl(configuredAssetBase);

  function normalizeBaseUrl(value) {
    return String(value || "").trim().replace(/\/+$/, "");
  }

  function apiUrl(path) {
    if (!apiBaseUrl || /^https?:\/\//i.test(path)) return path;
    return `${apiBaseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  }

  function resolveAssetUrl(path) {
    if (!path || /^https?:\/\//i.test(path) || path.startsWith("data:") || path.startsWith("blob:")) return path;
    if (path.startsWith("/static/") && apiBaseUrl) return `${apiBaseUrl}${path}`;
    return path;
  }

  function frontendAssetUrl(path) {
    const cleanPath = String(path || "").replace(/^\/+/, "");
    if (!assetBaseUrl || assetBaseUrl === ".") return `./${cleanPath}`;
    return `${assetBaseUrl}/${cleanPath}`;
  }

  async function requestJson(url, options = {}) {
    const response = await fetch(apiUrl(url), options);
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  }

  function getJson(url) {
    return requestJson(url);
  }

  function postJson(url, body) {
    return requestJson(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  function postForm(url, form) {
    return requestJson(url, { method: "POST", body: form });
  }

  function deleteJson(url, body) {
    return requestJson(url, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  global.IntellectualTwinApi = {
    normalizeBaseUrl,
    apiUrl,
    resolveAssetUrl,
    frontendAssetUrl,
    requestJson,
    getJson,
    postJson,
    postForm,
    deleteJson,
  };
})(window);
