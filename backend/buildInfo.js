const fs = require("node:fs");
const path = require("node:path");

const fields = ["schemaVersion", "available", "component", "repository", "commit", "runId", "runAttempt", "builtAt"];
const unavailable = (component) => ({ schemaVersion: 1, available: false, component });

function validateBuildInfo(value, component) {
  if (!value || typeof value !== "object" || Object.keys(value).some((key) => !fields.includes(key))) return null;
  if (value.schemaVersion !== 1 || value.available !== true || value.component !== component) return null;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value.repository || "") || !/^[a-f0-9]{40}$/.test(value.commit || "")) return null;
  if (!Number.isSafeInteger(value.runId) || value.runId < 1 || !Number.isSafeInteger(value.runAttempt) || value.runAttempt < 1) return null;
  if (typeof value.builtAt !== "string" || !Number.isFinite(Date.parse(value.builtAt))) return null;
  return Object.fromEntries(fields.map((key) => [key, value[key]]));
}

function createBuildInfo(component, env = process.env) {
  if (!["frontend", "backend"].includes(component)) throw new Error("Unknown build component");
  // Local builds must not invent a GitHub deployment identity.
  if (env.GITHUB_ACTIONS !== "true") return unavailable(component);
  const result = validateBuildInfo({ schemaVersion: 1, available: true, component,
    repository: env.GITHUB_REPOSITORY, commit: env.GITHUB_SHA,
    runId: Number(env.GITHUB_RUN_ID), runAttempt: Number(env.GITHUB_RUN_ATTEMPT),
    builtAt: new Date().toISOString() }, component);
  if (!result) throw new Error("GitHub build identity is incomplete or invalid");
  return result;
}

function readBuildInfo(file = path.join(__dirname, "build-info.json")) {
  try {
    if (fs.statSync(file).size > 4096) return unavailable("backend");
    return validateBuildInfo(JSON.parse(fs.readFileSync(file, "utf8")), "backend") || unavailable("backend");
  } catch { return unavailable("backend"); }
}

module.exports = { createBuildInfo, readBuildInfo, validateBuildInfo };
