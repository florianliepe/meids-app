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

- Data owner: Florian Liepe
- Launch-policy approver: Florian Liepe
- Effective date: 2026-10-21
- Review cadence: annual and upon material regulatory, contractual, or
  architecture change; first review no later than 2027-10-21
- Approved-knowledge retention: retain until governed deletion, legal-hold
  release, or supersession under an approved records schedule
- Review-needed retention: retain the current revision until review or
  explicit deletion; superseded Blob versions expire after 90 days
- Rejected knowledge: retain decision and audit metadata for 12 months; remove
  rejected content from active Search indexes immediately
- Trace/audit retention: retain audit metadata for 12 months and raw n8n
  execution payloads for 30 days unless an incident or legal hold applies
- User-offboarding rule: private knowledge is quarantined for 90 days before
  governed deletion or transfer; approved organization-shared knowledge is
  retained under the organization's ownership
- Legal-hold process reference: the data owner or Security records the hold,
  scope, reason, start date, and release approval; automated deletion remains
  suspended for the scoped records until release
- Enterprise governance note: this is the approved Me.IDs launch schedule.
  Formal Legal/Records and Security policy alignment remains required before
  external customer production use.

No destructive lifecycle rule for approved knowledge should be deployed until
this section is completed and approved.
