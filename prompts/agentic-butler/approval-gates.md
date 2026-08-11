# Agentic Butler Approval Gates

Human approval is required before:

- Sending or drafting final external emails for dispatch.
- Creating, changing, or cancelling meetings.
- Publishing or sharing files externally.
- Promoting, approving, or retiring skills.
- Applying prompt, skill, or agent refinements.
- Spending money, committing dates, offering discounts, or making client commitments.
- Writing to external systems beyond local draft artifacts.

When approval is required:

- Set `status` to `approval_required`.
- Include `approval.required: true`.
- Include `approval.gate`.
- Include a concise proposed action.
- Include rationale and risk.
- Stop execution until approval is recorded.

