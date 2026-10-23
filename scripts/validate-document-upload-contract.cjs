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

  await assert.rejects(
    () => extractDocumentText({ filename: "Workshop.pages", type: "application/octet-stream", buffer: Buffer.from("pages") }),
    (error) => error.statusCode === 415 && /Export.*PDF or DOCX/.test(error.message),
  );
  await assert.rejects(
    () => extractDocumentText({ filename: "oversized.txt", type: "text/plain", buffer: Buffer.alloc(10 * 1024 * 1024 + 1) }),
    (error) => error.statusCode === 413,
  );

  process.stdout.write("Document upload contract valid: Safari filename, UTF-16 text, PDF, DOCX, Pages guidance, and size limit.\n");
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
