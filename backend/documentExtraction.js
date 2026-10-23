const path = require("node:path");

const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
const MAX_EXTRACTED_CHARACTERS = 100_000;
const TEXT_DOCUMENT_EXTENSIONS = new Set(["txt", "md", "markdown", "json", "csv", "yaml", "yml", "xml"]);
const BINARY_DOCUMENT_EXTENSIONS = new Set(["pdf", "docx"]);
const SUPPORTED_DOCUMENT_EXTENSIONS = new Set([...TEXT_DOCUMENT_EXTENSIONS, ...BINARY_DOCUMENT_EXTENSIONS]);

function uploadError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizeUploadFilename(value) {
  const decoded = String(value || "")
    .replace(/\0/g, "")
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim();
  return path.basename(decoded.replace(/\\/g, "/")).slice(0, 240);
}

function documentExtension(filename) {
  const normalized = normalizeUploadFilename(filename);
  const match = normalized.match(/\.([^.]+)$/);
  return match ? match[1].toLowerCase() : "";
}

function decodeTextBuffer(buffer) {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.subarray(2).toString("utf16le");
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    const swapped = Buffer.allocUnsafe(buffer.length - 2);
    for (let index = 2; index + 1 < buffer.length; index += 2) {
      swapped[index - 2] = buffer[index + 1];
      swapped[index - 1] = buffer[index];
    }
    return swapped.toString("utf16le");
  }
  return buffer.toString("utf8");
}

function cleanExtractedText(value) {
  return String(value || "")
    .replace(/\0/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim()
    .slice(0, MAX_EXTRACTED_CHARACTERS);
}

async function extractPdf(buffer) {
  const { PDFParse } = require("pdf-parse");
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return cleanExtractedText(result.text);
  } catch (error) {
    throw uploadError(422, `The PDF could not be read: ${error.message || "invalid or protected PDF"}.`);
  } finally {
    await Promise.resolve(parser.destroy()).catch(() => {});
  }
}

async function extractDocx(buffer) {
  const mammoth = require("mammoth");
  try {
    const result = await mammoth.extractRawText({ buffer });
    return cleanExtractedText(result.value);
  } catch (error) {
    throw uploadError(422, `The DOCX file could not be read: ${error.message || "invalid or protected document"}.`);
  }
}

async function extractDocumentText(file) {
  const filename = normalizeUploadFilename(file?.filename);
  if (!filename || !file?.buffer?.length) throw uploadError(400, "A non-empty document file is required.");
  if (file.buffer.length > MAX_DOCUMENT_BYTES) throw uploadError(413, "Documents must not exceed 10 MB.");

  const extension = documentExtension(filename);
  if (extension === "pages") {
    throw uploadError(415, "Apple Pages files are not supported. Export the document as PDF or DOCX and upload it again.");
  }
  if (!SUPPORTED_DOCUMENT_EXTENSIONS.has(extension)) {
    throw uploadError(415, "Supported document formats are TXT, Markdown, JSON, CSV, YAML, XML, PDF, and DOCX.");
  }

  let text = "";
  if (TEXT_DOCUMENT_EXTENSIONS.has(extension)) text = cleanExtractedText(decodeTextBuffer(file.buffer));
  else if (extension === "pdf") text = await extractPdf(file.buffer);
  else if (extension === "docx") text = await extractDocx(file.buffer);

  if (!text) {
    const hint = extension === "pdf" ? " Scanned PDFs need OCR before upload." : "";
    throw uploadError(422, `The uploaded document contains no readable text.${hint}`);
  }
  return { filename, extension, text };
}

module.exports = {
  MAX_DOCUMENT_BYTES,
  MAX_EXTRACTED_CHARACTERS,
  SUPPORTED_DOCUMENT_EXTENSIONS,
  normalizeUploadFilename,
  documentExtension,
  extractDocumentText,
};
