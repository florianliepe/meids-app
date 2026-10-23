const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  MAX_AUDIO_BYTES,
  validateAudioUpload,
} = require("../backend/audioUpload");

function fixture(filename, type = "application/octet-stream", size = 64) {
  return { filename, type, buffer: Buffer.alloc(size, 1) };
}

function main() {
  const m4a = validateAudioUpload(fixture("Meeting Übernahme.m4a", "audio/x-m4a"));
  assert.equal(m4a.filename, "Meeting Übernahme.m4a");
  assert.equal(m4a.mediaType, "audio/mp4");
  assert.equal(m4a.gatewayFilename, "meids-audio.m4a");
  assert.match(m4a.gatewayFilename, /^[\x20-\x7e]+$/);

  const webm = validateAudioUpload(fixture("voice.webm", "audio/webm"));
  assert.equal(webm.mediaType, "audio/webm");

  assert.throws(
    () => validateAudioUpload(fixture("Voice Memo.aiff", "audio/aiff")),
    (error) => error.statusCode === 415 && /M4A or WAV/.test(error.message),
  );
  assert.throws(
    () => validateAudioUpload(fixture("raw.aac", "audio/aac")),
    (error) => error.statusCode === 415 && /M4A or WAV/.test(error.message),
  );
  assert.throws(
    () => validateAudioUpload(fixture("oversized.wav", "audio/wav", MAX_AUDIO_BYTES + 1)),
    (error) => error.statusCode === 413,
  );

  const root = path.resolve(__dirname, "..");
  const workspaceApi = fs.readFileSync(path.join(root, "backend", "workspaceApi.js"), "utf8");
  const server = fs.readFileSync(path.join(root, "backend", "server.js"), "utf8");
  const frontend = fs.readFileSync(path.join(root, "frontend", "app.js"), "utf8");
  const html = fs.readFileSync(path.join(root, "frontend", "index.html"), "utf8");

  assert.match(workspaceApi, /POST \/api\/voice\/concepts\/transcribe/);
  assert.match(workspaceApi, /context\(req, form\.fields, true\)/);
  assert.match(workspaceApi, /assertTwin\(mapping, form\.fields\.twin/);
  assert.match(workspaceApi, /voice\.transcribe/);
  assert.doesNotMatch(server, /async function handleVoiceConceptTranscribe/);
  assert.match(frontend, /sourceType: "audio_document"/);
  assert.match(frontend, /await assessVoiceConcept\(\)/);
  assert.match(frontend, /source_type: state\.voiceConceptSession\.sourceType/);
  assert.match(html, /id="sourceAudioConsent"/);
  assert.match(html, /id="sourceAudioTranscribeBtn"/);

  process.stdout.write("Audio upload contract valid: M4A/macOS support, format and size gates, scoped transcription, consent, and shared quality flow.\n");
}

main();
