const assert = require("node:assert/strict");
const JSZip = require("jszip");
const { decodeMultipartFilename } = require("../backend/server");
const { extractDocumentText, normalizeUploadFilename } = require("../backend/documentExtraction");

async function createDocx() {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0"?>
    <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
      <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
      <Default Extension="xml" ContentType="application/xml"/>
      <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
    </Types>`);
  zip.folder("_rels").file(".rels", `<?xml version="1.0"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
    </Relationships>`);
  zip.folder("word").file("document.xml", `<?xml version="1.0"?>
    <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:body><w:p><w:r><w:t>Mac upload knowledge works</w:t></w:r></w:p></w:body>
    </w:document>`);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

async function createPptx() {
  const zip = new JSZip();
  zip.file("ppt/slides/slide1.xml", `<?xml version="1.0" encoding="UTF-8"?>
    <p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Mac PowerPoint decision flow</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld>
    </p:sld>`);
  zip.file("ppt/notesSlides/notesSlide1.xml", `<?xml version="1.0" encoding="UTF-8"?>
    <p:notes xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Escalate when evidence is incomplete</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld>
    </p:notes>`);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

function createPdf(text) {
  const escaped = text.replace(/([\\()])/g, "\\$1");
  const stream = `BT /F1 12 Tf 72 720 Td (${escaped}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let output = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(output));
    output += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(output);
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  output += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(output);
}

async function main() {
  const nfdName = "u\u0308berblick.pdf";
  assert.equal(normalizeUploadFilename(`../../${nfdName}`), "überblick.pdf");
  assert.equal(
    decodeMultipartFilename("Content-Disposition: form-data; name=\"file\"; filename*=UTF-8''Olaf%20Wissen%20%C3%BCberblick.pdf"),
    "Olaf Wissen überblick.pdf",
  );

  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("Mac text upload", "utf16le")]);
  const plain = await extractDocumentText({ filename: "Notizen.txt", type: "", buffer: utf16 });
  assert.match(plain.text, /Mac text upload/);

  const docx = await extractDocumentText({ filename: "Prozesswissen.docx", type: "", buffer: await createDocx() });
  assert.match(docx.text, /Mac upload knowledge works/);

  const pdf = await extractDocumentText({ filename: "Entscheidung.pdf", type: "application/pdf", buffer: createPdf("Mac PDF upload works") });
  assert.match(pdf.text, /Mac PDF upload works/);

  const pptx = await extractDocumentText({ filename: "Entscheidungslogik Mac.pptx", type: "application/vnd.openxmlformats-officedocument.presentationml.presentation", buffer: await createPptx() });
  assert.match(pptx.text, /\[Slide 1\][\s\S]*Mac PowerPoint decision flow/);
  assert.match(pptx.text, /\[Notes 1\][\s\S]*Escalate when evidence is incomplete/);

  await assert.rejects(
    () => extractDocumentText({ filename: "Workshop.pages", type: "application/octet-stream", buffer: Buffer.from("pages") }),
    (error) => error.statusCode === 415 && /Export.*PDF or DOCX/.test(error.message),
  );
  await assert.rejects(
    () => extractDocumentText({ filename: "Workshop.key", type: "application/octet-stream", buffer: Buffer.from("keynote") }),
    (error) => error.statusCode === 415 && /PPTX|\.pptx/.test(error.message),
  );
  await assert.rejects(
    () => extractDocumentText({ filename: "Legacy.ppt", type: "application/vnd.ms-powerpoint", buffer: Buffer.from("ppt") }),
    (error) => error.statusCode === 415 && /PPTX|\.pptx/.test(error.message),
  );
  await assert.rejects(
    () => extractDocumentText({ filename: "oversized.txt", type: "text/plain", buffer: Buffer.alloc(25 * 1024 * 1024 + 1) }),
    (error) => error.statusCode === 413,
  );

  const workspaceApi = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "backend", "workspaceApi.js"), "utf8");
  const frontend = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "frontend", "app.js"), "utf8");
  const html = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "frontend", "index.html"), "utf8");
  assert.match(workspaceApi, /ingestDocument[\s\S]*context\(req, \{\}, true\)[\s\S]*readMultipartForm/);
  assert.match(frontend, /MAX_DOCUMENT_BATCH_BYTES = 100 \* 1024 \* 1024/);
  assert.match(frontend, /for \(const \[index, file\] of files\.entries\(\)\)/);
  assert.match(html, /id="documentInput" type="file" multiple/);

  process.stdout.write("Document upload contract valid: Safari filename, UTF-16 text, PDF, DOCX, PPTX slides/notes, macOS export guidance, scoped parsing, and sequential 100 MB batches.\n");
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
