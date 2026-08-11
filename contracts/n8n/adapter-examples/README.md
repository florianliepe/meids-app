# n8n Production Adapter Examples

These public-safe examples define the response shape expected after each live n8n AI Agent node.

The production adapter is the code/function layer that normalizes raw AI node output into one of three stable statuses:

- `completed`
- `approval_required`
- `failed`

The adapter must preserve human approval boundaries. It must not promote concepts, execute skills, send messages, schedule meetings, or refresh trusted retrieval indexes unless a prior gate explicitly permits that action.

Validate these examples with:

```powershell
node scripts\validate-n8n-response-adapters.cjs
```
