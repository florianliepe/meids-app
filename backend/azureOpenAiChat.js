const COGNITIVE_SERVICES_TOKEN_RESOURCE = "https://cognitiveservices.azure.com";

let cachedToken = { value: "", expiresAt: 0 };

function cleanBaseUrl(value = "") {
  return String(value || "").trim().replace(/\/+$/, "");
}

function azureOpenAiChatConfigFromEnv(env = process.env) {
  const azureEndpoint = cleanBaseUrl(env.AZURE_OPENAI_ENDPOINT || "");
  const azureDeployment = String(env.AZURE_OPENAI_CHAT_DEPLOYMENT || "").trim();
  const azureApiKey = String(env.AZURE_OPENAI_API_KEY || "").trim();
  const azureAuthMode = String(env.AZURE_OPENAI_AUTH_MODE || "managed_identity").trim().toLowerCase();
  const gatewayEndpoint = cleanBaseUrl(env.ERANEOS_AI_GATEWAY_BASE_URL || "");
  const gatewayModel = String(env.ERANEOS_AI_GATEWAY_CHAT_MODEL || "").trim();
  const gatewayApiKey = String(env.ERANEOS_AI_GATEWAY_API_KEY || "").trim();
  const provider = azureEndpoint && azureDeployment ? "azure_openai" : "eraneos_gateway";
  const configured = provider === "azure_openai"
    ? Boolean(azureEndpoint && azureDeployment && (azureAuthMode === "managed_identity" || azureApiKey))
    : Boolean(gatewayEndpoint && gatewayModel && gatewayApiKey);
  return {
    provider,
    configured,
    endpoint: provider === "azure_openai" ? azureEndpoint : gatewayEndpoint,
    deployment: provider === "azure_openai" ? azureDeployment : gatewayModel,
    apiKey: provider === "azure_openai" ? azureApiKey : gatewayApiKey,
    authMode: provider === "azure_openai" ? azureAuthMode : "api_key",
    apiVersion: String(env.AZURE_OPENAI_API_VERSION || "2024-10-21").trim(),
    identityEndpoint: cleanBaseUrl(env.IDENTITY_ENDPOINT || ""),
    identityHeader: String(env.IDENTITY_HEADER || "").trim(),
    identityClientId: String(env.AZURE_OPENAI_MANAGED_IDENTITY_CLIENT_ID || "").trim(),
    timeoutMs: Math.max(5_000, Math.min(Number(env.AZURE_OPENAI_CHAT_TIMEOUT_MS || 25_000), 90_000)),
    maxOutputTokens: Math.max(256, Math.min(Number(env.AZURE_OPENAI_CHAT_MAX_OUTPUT_TOKENS || 1_800), 8_000)),
  };
}

async function managedIdentityToken(config) {
  if (cachedToken.value && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  if (!config.identityEndpoint || !config.identityHeader) {
    const error = new Error("Azure OpenAI managed identity endpoint is unavailable.");
    error.statusCode = 503;
    throw error;
  }
  const url = new URL(config.identityEndpoint);
  url.searchParams.set("resource", COGNITIVE_SERVICES_TOKEN_RESOURCE);
  url.searchParams.set("api-version", "2019-08-01");
  if (config.identityClientId) url.searchParams.set("client_id", config.identityClientId);
  const response = await fetch(url, {
    headers: { "X-IDENTITY-HEADER": config.identityHeader, Metadata: "true" },
    signal: AbortSignal.timeout(10_000),
  });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = {}; }
  if (!response.ok || !data.access_token) {
    const error = new Error(data.error_description || data.error || text || `Managed identity returned ${response.status}`);
    error.statusCode = response.status || 503;
    throw error;
  }
  const numericExpiry = Number(data.expires_on);
  cachedToken = {
    value: data.access_token,
    expiresAt: Number.isFinite(numericExpiry) ? numericExpiry * 1000 : Date.now() + 5 * 60_000,
  };
  return cachedToken.value;
}

function responseText(data = {}) {
  const content = data.choices?.[0]?.message?.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) return content.map((part) => part?.text || part?.content || "").join("\n").trim();
  return String(data.output_text || data.text || "").trim();
}

async function completeChat(messages, options = {}) {
  const config = options.config || azureOpenAiChatConfigFromEnv();
  if (!config.configured) {
    const error = new Error("Azure-native chat model is not configured.");
    error.statusCode = 503;
    error.code = "azure_chat_not_configured";
    throw error;
  }
  const timeoutMs = Math.max(5_000, Math.min(Number(options.timeoutMs || config.timeoutMs), config.timeoutMs));
  const headers = { "Content-Type": "application/json" };
  let url;
  if (config.provider === "azure_openai") {
    url = `${config.endpoint}/openai/deployments/${encodeURIComponent(config.deployment)}/chat/completions?api-version=${encodeURIComponent(config.apiVersion)}`;
    if (config.authMode === "managed_identity") headers.Authorization = `Bearer ${await managedIdentityToken(config)}`;
    else headers["api-key"] = config.apiKey;
  } else {
    url = `${config.endpoint}/chat/completions`;
    headers.Authorization = `Bearer ${config.apiKey}`;
  }
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: config.deployment,
        messages,
        temperature: Number.isFinite(options.temperature) ? options.temperature : 0.2,
        max_tokens: Math.min(Number(options.maxOutputTokens || config.maxOutputTokens), config.maxOutputTokens),
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (cause) {
    if (["AbortError", "TimeoutError"].includes(String(cause?.name || ""))) {
      const error = new Error(`Azure-native chat exceeded its ${timeoutMs} ms response budget; completion is unknown.`);
      error.statusCode = 504;
      error.code = "azure_chat_timeout";
      error.noRetry = true;
      error.unknownCompletion = true;
      throw error;
    }
    throw cause;
  }
  const raw = await response.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { raw }; }
  if (!response.ok) {
    const error = new Error(data.error?.message || data.message || data.raw || `Chat provider returned ${response.status}`);
    error.statusCode = response.status;
    error.code = "azure_chat_failed";
    throw error;
  }
  const text = responseText(data);
  if (!text) {
    const error = new Error("Chat provider returned no answer text.");
    error.statusCode = 502;
    error.code = "azure_chat_empty";
    throw error;
  }
  return {
    text,
    provider: config.provider,
    model: config.deployment,
    usage: data.usage || null,
  };
}

module.exports = { azureOpenAiChatConfigFromEnv, completeChat };
