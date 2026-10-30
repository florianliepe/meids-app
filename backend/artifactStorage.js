const STORAGE_RESOURCE = "https://storage.azure.com/";
const STORAGE_API_VERSION = "2023-11-03";

let storageToken = { value: "", expiresAt: 0 };
const knownContainers = new Set();

function clean(value, max = 2_000) {
  return String(value || "").trim().slice(0, max);
}

function safeSegment(value, fallback = "item") {
  const normalized = clean(value, 240)
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

function blobUrl(account, container, blobPath = "") {
  const encodedContainer = encodeURIComponent(clean(container, 128));
  const encodedPath = clean(blobPath).split("/").filter(Boolean).map(encodeURIComponent).join("/");
  return `https://${account}.blob.core.windows.net/${encodedContainer}${encodedPath ? `/${encodedPath}` : ""}`;
}

async function accessToken() {
  if (storageToken.value && storageToken.expiresAt > Date.now() + 60_000) return storageToken.value;
  const endpoint = clean(process.env.IDENTITY_ENDPOINT);
  const identityHeader = clean(process.env.IDENTITY_HEADER);
  if (!endpoint || !identityHeader) throw new Error("App Service managed identity endpoint is unavailable for private artifact storage.");
  const url = new URL(endpoint);
  url.searchParams.set("resource", STORAGE_RESOURCE);
  url.searchParams.set("api-version", "2019-08-01");
  const response = await fetch(url, {
    headers: { "X-IDENTITY-HEADER": identityHeader, Metadata: "true" },
    signal: AbortSignal.timeout(10_000),
  });
  const raw = await response.text();
  let data = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = {};
  }
  if (!response.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || raw || `Storage token request returned ${response.status}`);
  }
  const numericExpiry = Number(data.expires_on);
  storageToken = {
    value: data.access_token,
    expiresAt: Number.isFinite(numericExpiry) ? numericExpiry * 1000 : Date.now() + 5 * 60_000,
  };
  return storageToken.value;
}

function storageAccount() {
  const account = clean(process.env.MEIDS_STORAGE_ACCOUNT_NAME, 128);
  if (!account) throw new Error("MEIDS_STORAGE_ACCOUNT_NAME is required for private artifact storage.");
  return account;
}

function containerName(value) {
  const normalized = clean(value, 63)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return (normalized || "source-artifacts").slice(0, 63);
}

async function ensurePrivateContainer(container) {
  const normalized = containerName(container);
  if (knownContainers.has(normalized)) return normalized;
  const response = await fetch(`${blobUrl(storageAccount(), normalized)}?restype=container`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      "x-ms-version": STORAGE_API_VERSION,
      "x-ms-date": new Date().toUTCString(),
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok && response.status !== 409) {
    throw new Error((await response.text()) || `Private Blob container creation returned ${response.status}`);
  }
  knownContainers.add(normalized);
  return normalized;
}

async function putPrivateArtifact({ container = "source-artifacts", path, buffer, contentType = "application/octet-stream", checksum = "" } = {}) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error("A non-empty artifact buffer is required.");
  const normalizedContainer = await ensurePrivateContainer(container);
  const response = await fetch(blobUrl(storageAccount(), normalizedContainer, path), {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      "x-ms-version": STORAGE_API_VERSION,
      "x-ms-date": new Date().toUTCString(),
      "x-ms-blob-type": "BlockBlob",
      "Content-Type": clean(contentType, 256) || "application/octet-stream",
      ...(checksum ? { "x-ms-meta-sha256": clean(checksum, 128) } : {}),
    },
    body: buffer,
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error((await response.text()) || `Private Blob upload returned ${response.status}`);
  return blobUrl(storageAccount(), normalizedContainer, path);
}

async function readPrivateArtifact(uri) {
  const normalized = clean(uri);
  const account = storageAccount();
  if (!normalized.startsWith(`https://${account}.blob.core.windows.net/`)) {
    throw new Error("Artifact URI is outside the configured private storage account.");
  }
  const response = await fetch(normalized, {
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      "x-ms-version": STORAGE_API_VERSION,
      "x-ms-date": new Date().toUTCString(),
    },
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error((await response.text()) || `Private Blob read returned ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function deletePrivateArtifact(uri) {
  const normalized = clean(uri);
  const account = storageAccount();
  if (!normalized.startsWith(`https://${account}.blob.core.windows.net/`)) return false;
  const response = await fetch(normalized, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      "x-ms-version": STORAGE_API_VERSION,
      "x-ms-date": new Date().toUTCString(),
      "x-ms-delete-snapshots": "include",
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok && response.status !== 404) {
    throw new Error((await response.text()) || `Private Blob delete returned ${response.status}`);
  }
  return response.ok;
}

module.exports = {
  safeSegment,
  ensurePrivateContainer,
  putPrivateArtifact,
  readPrivateArtifact,
  deletePrivateArtifact,
};
