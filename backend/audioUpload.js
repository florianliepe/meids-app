const { normalizeUploadFilename } = require("./documentExtraction");

const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const SUPPORTED_AUDIO_EXTENSIONS = new Set(["mp3", "mp4", "mpeg", "mpga", "m4a", "wav", "webm"]);
const UNSUPPORTED_APPLE_AUDIO_EXTENSIONS = new Set(["aif", "aiff", "aac"]);
const AUDIO_MEDIA_TYPES = {
  mp3: "audio/mpeg",
  mp4: "audio/mp4",
  mpeg: "audio/mpeg",
  mpga: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  webm: "audio/webm",
};

function uploadError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function audioExtension(filename) {
  const normalized = normalizeUploadFilename(filename);
  const match = normalized.match(/\.([^.]+)$/);
  return match ? match[1].toLowerCase() : "";
}

function validateAudioUpload(file) {
  const filename = normalizeUploadFilename(file?.filename);
  if (!filename || !file?.buffer?.length) throw uploadError(400, "A non-empty audio file is required.");
  if (file.buffer.length > MAX_AUDIO_BYTES) throw uploadError(413, "Audio files must not exceed 25 MB.");

  const extension = audioExtension(filename);
  if (UNSUPPORTED_APPLE_AUDIO_EXTENSIONS.has(extension)) {
    throw uploadError(415, "AIFF and raw AAC files are not supported. Export or convert the recording to M4A or WAV and upload it again.");
  }
  if (!SUPPORTED_AUDIO_EXTENSIONS.has(extension)) {
    throw uploadError(415, "Supported audio formats are MP3, MP4, MPEG, MPGA, M4A, WAV, and WebM.");
  }

  return {
    filename,
    extension,
    mediaType: AUDIO_MEDIA_TYPES[extension],
    gatewayFilename: `meids-audio.${extension}`,
    size: file.buffer.length,
  };
}

module.exports = {
  MAX_AUDIO_BYTES,
  SUPPORTED_AUDIO_EXTENSIONS,
  audioExtension,
  validateAudioUpload,
};
