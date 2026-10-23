const path = require("node:path");

const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
const MAX_EXTRACTED_CHARACTERS = 100_000;
const MAX_PPTX_XML_CHARACTERS = 5_000_000;
const TEXT_DOCUMENT_EXTENSIONS = new Set(["txt", "md", "markdown", "json", "csv", "yaml", "yml", "xml"]);
const BINARY_DOCUMENT_EXTENSIONS = new Set(["pdf", "docx", "pptx"]);
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

function collectPowerPointText(node, output = []) {
  if (Array.isArray(node)) {
    node.forEach((value) => collectPowerPointText(value, output));
    return output;
  }
  if (!node || typeof node !== "object") return output;
  for (const [key, value] of Object.entries(node)) {
    if (key === "a:t") {
      const values = [];
      collectXmlText(value, values);
      const text = values.join(" ").trim();
      if (text) output.push(text);
    } else {
      collectPowerPointText(value, output);
    }
  }
  return output;
}

function collectXmlText(node, output = []) {
  if (Array.isArray(node)) {
    node.forEach((value) => collectXmlText(value, output));
  } else if (node && typeof node === "object") {
    if (typeof node["#text"] === "string") output.push(node["#text"]);
    else Object.values(node).forEach((value) => collectXmlText(value, output));
  } else if (typeof node === "string") {
    output.push(node);
  }
  return output;
}

function presentationPartNumber(name) {
  return Number(name.match(/(\d+)\.xml$/)?.[1] || 0);
}

async function extractPptx(buffer) {
  const JSZip = require("jszip");
  const { XMLParser } = require("fast-xml-parser");
  let zip;
  try {
    zip = await JSZip.loadAsync(buffer, { checkCRC32: true });
  } catch (error) {
    throw uploadError(422, `The PPTX file could not be read: ${error.message || "invalid or protected presentation"}.`);
  }

  const partPattern = /^ppt\/(slides\/slide|notesSlides\/notesSlide)\d+\.xml$/;
  const parts = Object.values(zip.files)
    .filter((entry) => !entry.dir && partPattern.test(entry.name))
    .sort((left, right) => {
      const leftNotes = left.name.includes("notesSlides") ? 1 : 0;
      const rightNotes = right.name.includes("notesSlides") ? 1 : 0;
      return presentationPartNumber(left.name) - presentationPartNumber(right.name) || leftNotes - rightNotes;
    });
  if (!parts.length) throw uploadError(422, "The PPTX presentation contains no readable slides.");
  if (parts.length > 2_000) throw uploadError(413, "The PPTX presentation contains too many slide or note parts.");
  const declaredXmlBytes = parts.reduce((total, part) => total + Number(part?._data?.uncompressedSize || 0), 0);
  if (declaredXmlBytes > MAX_PPTX_XML_CHARACTERS) throw uploadError(413, "The expanded PPTX slide content is too large to process safely.");

  const parser = new XMLParser({ preserveOrder: true, ignoreAttributes: false, processEntities: false });
  const sections = [];
  let xmlCharacters = 0;
  for (const part of parts) {
    const xml = await part.async("string");
    xmlCharacters += xml.length;
    if (xmlCharacters > MAX_PPTX_XML_CHARACTERS) throw uploadError(413, "The expanded PPTX slide content is too large to process safely.");
    let parsed;
    try {
      parsed = parser.parse(xml);
    } catch (error) {
      throw uploadError(422, `A PPTX slide could not be parsed: ${error.message || "invalid slide XML"}.`);
    }
    const text = collectPowerPointText(parsed).join("\n").trim();
    if (!text) continue;
    const number = presentationPartNumber(part.name);
    const label = part.name.includes("notesSlides") ? `Notes ${number}` : `Slide ${number}`;
    sections.push(`[${label}]\n${text}`);
  }
  const result = cleanExtractedText(sections.join("\n\n"));
  if (!result) throw uploadError(422, "The PPTX presentation contains no readable text. Image-only slides need OCR before upload.");
  return result;
}

async function extractDocumentText(file) {
  const filename = normalizeUploadFilename(file?.filename);
  if (!filename || !file?.buffer?.length) throw uploadError(400, "A non-empty document file is required.");
  if (file.buffer.length > MAX_DOCUMENT_BYTES) throw uploadError(413, "Documents must not exceed 25 MB per file.");

  const extension = documentExtension(filename);
  if (extension === "pages") {
    throw uploadError(415, "Apple Pages files are not supported. Export the document as PDF or DOCX and upload it again.");
  }
  if (extension === "key") {
    throw uploadError(415, "Apple Keynote files are not supported directly. Export the presentation as PowerPoint (.pptx) or PDF and upload it again.");
  }
  if (extension === "ppt") {
    throw uploadError(415, "Legacy PowerPoint (.ppt) files are not supported. Save the presentation as PowerPoint (.pptx) and upload it again.");
  }
  if (!SUPPORTED_DOCUMENT_EXTENSIONS.has(extension)) {
    throw uploadError(415, "Supported document formats are TXT, Markdown, JSON, CSV, YAML, XML, PDF, DOCX, and PPTX.");
  }

  let text = "";
  if (TEXT_DOCUMENT_EXTENSIONS.has(extension)) text = cleanExtractedText(decodeTextBuffer(file.buffer));
  else if (extension === "pdf") text = await extractPdf(file.buffer);
  else if (extension === "docx") text = await extractDocx(file.buffer);
  else if (extension === "pptx") text = await extractPptx(file.buffer);

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
