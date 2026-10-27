# Read-only deployment revision probes

Pandora needs the revision actually served by each environment. A successful workflow or
the manually maintained frontend tag alone does not establish that revision.

- Frontend artifacts include `build-info.json`, served at `/build-info.json` on Azure Static
  Web Apps and `/meids-app/build-info.json` on the GitHub Pages sandbox.
- The backend package includes `backend/build-info.json`, served by `GET /api/build-info`.
- Fields are allowlisted: schema version, availability, component, repository, full commit
  SHA, GitHub run ID, run attempt and build timestamp. No environment secrets, account data,
  knowledge records, API keys or runtime settings are exposed.
- GitHub Actions builds fail if their build identity is incomplete. Local builds explicitly
  report `available: false`. Missing, malformed or oversized backend manifests return 503;
  the backend never guesses a revision from `MEIDS_APP_VERSION`.

Azure Static Web Apps and the backend send `Cache-Control: no-store` for their probes.
GitHub Pages controls its own CDN headers; clients must treat old manifests as stale and
wait for the expected revision instead of interpreting the latest pipeline as proof.

The manifest identifies a build, not functional correctness. A verifier must cross-check
the repository, workflow run/attempt, commit, expected component and target environment,
then execute the relevant post-deployment tests. The probes never save or approve knowledge.

The backend GitHub deployment workflow stamps the manifest before packaging. A manual
deployment outside that workflow has no verified GitHub identity unless its build process
is updated accordingly; it must not retain a manifest from an unrelated earlier build.

Validation: `node --test scripts/test-build-info.cjs`, the existing backend contract suite,
and a frontend artifact build. The dedicated PR workflow uses read-only permissions and
does not deploy or access Azure credentials.
