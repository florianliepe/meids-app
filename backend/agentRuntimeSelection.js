const RUNTIME_PROVIDERS = Object.freeze(["n8n", "azure_native"]);

function normalizeRuntimeMode(value) {
  const mode = String(value || "n8n").trim().toLowerCase();
  return ["azure_native", "hybrid"].includes(mode) ? mode : "n8n";
}

function routeSet(value) {
  if (value instanceof Set) return value;
  if (Array.isArray(value)) return new Set(value.map(String));
  return new Set(String(value || "").split(",").map((item) => item.trim()).filter(Boolean));
}

function selectRuntimeProvider({ mode, route, azureRoutes } = {}) {
  const normalizedMode = normalizeRuntimeMode(mode);
  if (normalizedMode === "azure_native") return "azure_native";
  if (normalizedMode === "hybrid" && routeSet(azureRoutes).has(String(route || ""))) return "azure_native";
  return "n8n";
}

function assertRuntimeProvider(value) {
  const provider = String(value || "").trim().toLowerCase();
  if (!RUNTIME_PROVIDERS.includes(provider)) throw new Error(`Unsupported agent runtime provider: ${provider || "missing"}.`);
  return provider;
}

module.exports = {
  RUNTIME_PROVIDERS,
  normalizeRuntimeMode,
  selectRuntimeProvider,
  assertRuntimeProvider,
};
