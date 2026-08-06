const fs = require("node:fs");
const https = require("node:https");
const path = require("node:path");

const requiredPaths = [
  "index.html",
  "styles.css",
  "app.js",
  "api.js",
  "runtime-config.js",
  "assets/intellectual-twin-hero-mark.svg",
  "assets/intellectual-twin-mark.svg",
];

function checkDirectory(root) {
  const missing = requiredPaths.filter((file) => !fs.existsSync(path.join(root, file)));
  if (missing.length) {
    throw new Error(`Missing Pages artifact files: ${missing.join(", ")}`);
  }
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  for (const literal of ["styles.css", "runtime-config.js", "api.js", "app.js"]) {
    if (!html.includes(literal)) throw new Error(`index.html does not reference ${literal}`);
  }
}

function request(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (response) => {
        response.resume();
        response.on("end", () => resolve(response.statusCode));
      })
      .on("error", reject);
  });
}

async function checkUrl(baseUrl) {
  const cleanBase = String(baseUrl).replace(/\/+$/, "");
  const checks = await Promise.all(requiredPaths.map(async (file) => [file, await request(`${cleanBase}/${file}`)]));
  const failures = checks.filter(([, status]) => status !== 200);
  if (failures.length) {
    throw new Error(`Live Pages checks failed: ${failures.map(([file, status]) => `${file}=${status}`).join(", ")}`);
  }
}

(async () => {
  const target = process.argv[2] || "dist-pages";
  if (/^https:\/\//i.test(target)) {
    await checkUrl(target);
  } else {
    checkDirectory(target);
  }
  console.log(`Pages smoke check passed: ${target}`);
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
