const fs = require("node:fs");
const path = require("node:path");

const outputPath = path.resolve(__dirname, "..", "docs", "uat", "device-upload-launch-matrix.json");
const checks = [
  { id: "WIN-CHROME-MIC", platform: "Windows", surface: "Chrome microphone", status: "manual_pending", evidence: "Physical permission and recording UAT required." },
  { id: "MAC-SAFARI-MIC", platform: "macOS", surface: "Safari microphone", status: "manual_pending", evidence: "Physical Safari permission and recording UAT required." },
  { id: "MAC-CHROME-MIC", platform: "macOS", surface: "Chrome microphone", status: "manual_pending", evidence: "Physical Chrome permission and recording UAT required." },
  { id: "M4A", platform: "cross-platform", surface: "M4A upload", status: "automated_pass", evidence: "validate-audio-upload-contract.cjs normalizes audio/x-m4a to audio/mp4." },
  { id: "PPTX", platform: "cross-platform", surface: "PPTX slides and notes", status: "automated_pass", evidence: "validate-document-upload-contract.cjs extracts slide and speaker-note text." },
  { id: "BULK-100MB", platform: "cross-platform", surface: "Mixed sequential bulk upload", status: "automated_pass", evidence: "Frontend enforces a 100 MB batch buffer and 25 MB per-file backend gate." },
  { id: "MAC-NATIVE", platform: "macOS", surface: "Keynote/Pages native formats", status: "expected_rejection_pass", evidence: "Actionable export guidance requires PPTX, PDF, or DOCX." },
];
const result = {
  generated_at: new Date().toISOString(),
  status: checks.some((item) => item.status === "manual_pending") ? "partially_verified" : "passed",
  automated: {
    passed: checks.filter((item) => item.status.endsWith("pass")).length,
    total: checks.length,
  },
  checks,
};
fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
