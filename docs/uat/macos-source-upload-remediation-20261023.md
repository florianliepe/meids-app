# macOS source-upload remediation

Date: 2026-10-23

## Root cause

The production source-upload UI and backend only accepted plain-text formats. Common business documents selected on macOS, especially PDF, DOCX, and Apple Pages, were either hidden by the file picker or rejected with HTTP 415. The custom multipart parser also ignored RFC 5987 `filename*` parameters used by some Safari upload requests and did not normalize decomposed macOS Unicode filenames.

This was not an Entra or row-level-security failure: the affected user could authenticate and create an owned twin. Document ingestion uses the same production identity mapping and checks that the selected twin is assigned to that user.

## Remediation

- Added server-side PDF and DOCX text extraction.
- Added Safari-compatible `filename*` decoding, Unicode NFC normalization, and path stripping.
- Added UTF-16 text-file handling for files exported by macOS applications.
- Added a 10 MB document limit and a 1.6 MB multipart limit around the existing 1.5 MB twin-picture limit.
- Added explicit Apple Pages guidance: export as PDF or DOCX.
- Added structured request-failure logs with the correlation ID, route, and status code, without document content.
- Added a contract test covering Safari filenames, UTF-16, PDF, DOCX, Pages rejection, and oversized files.

## Supported production formats

TXT, Markdown, JSON, CSV, YAML, XML, PDF, and DOCX. Image-only PDFs require OCR before upload. Apple Pages files must be exported as PDF or DOCX.

## UAT

1. Sign in as a standard user on macOS Safari.
2. Select the user's own active twin.
3. Upload one TXT file with an umlaut in its filename, one text-based PDF, and one DOCX.
4. Confirm that each upload creates a `review_needed` OKF concept under that twin.
5. Confirm that a `.pages` file displays the export guidance and that a file larger than 10 MB is rejected before upload.
6. Review and reject the three UAT concepts after evidence capture.
