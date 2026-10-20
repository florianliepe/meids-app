# Knowledge Retention Policy Template

Date: 2026-10-20

This template separates the launch-safe technical default from the retention
schedule that Legal, Records Management, Security, and the product owner must
approve.

## Current technical policy

| Data class | Current control | Launch default |
| --- | --- | --- |
| Approved OKF knowledge | Blob versioning and PostgreSQL revision history | Retain; no automatic deletion |
| Working and review-needed knowledge | PostgreSQL revision history; Blob non-current versions expire after 90 days | Retain current revision until review or explicit deletion |
| Source and learning artifact history | Non-current Blob versions and snapshots expire after 90 days | Keep current object; expire superseded object versions |
| Quarantine | Blob lifecycle cleanup | Delete after 30 days |
| Exports | Blob lifecycle cleanup | Delete after 90 days |
| PostgreSQL backups | 35-day retention with geo backup | Retain according to platform configuration |
| Traces and n8n execution data | Not yet governed by this policy | Define before public launch |

## Required human decisions

1. Name the accountable data owner and deletion authority.
2. Approve retention periods for approved, review-needed, rejected, source,
   learning, trace, audit, and exported data.
3. Define legal-hold initiation, release, and evidence requirements.
4. Define user-offboarding behavior for private twin knowledge and shared
   organization knowledge.
5. Define deletion propagation across PostgreSQL, Blob, Azure AI Search,
   backups, and n8n execution history.
6. Approve an exception process for investigations and regulated records.

## Acceptance record

- Data owner:
- Legal/Records approver:
- Security approver:
- Effective date:
- Review cadence:
- Approved-knowledge retention:
- Review-needed retention:
- Trace/audit retention:
- User-offboarding rule:
- Legal-hold process reference:

No destructive lifecycle rule for approved knowledge should be deployed until
this section is completed and approved.
