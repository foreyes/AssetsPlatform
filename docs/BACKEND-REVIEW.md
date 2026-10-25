> 历史初审记录：以下发现和行号对应修复前快照。已完成后续修复与复审，当前状态见 [代码审查闭环](CODE-REVIEW.md)。请勿将本页的“未修复”或旧许可状态当作当前结论。

# Assets Platform — current implementation architecture review

Review date: 2026-10-25. Scope: read-only inspection of the current full private platform source, with an explicit comparison to the separate portable frontend candidate. No production changes, publication, database changes, or remote computer use occurred. Source references below are relative to `reference/hosted/`; excluded private integration files are explicitly described but not distributed; no private account identities, asset records, credentials, or deployment identifiers are reproduced.

## Executive result

The platform is substantially more than a viewer: it combines a shared asset-review frontend, native model-resource verification and rendering, a hosted authenticated Worker, immutable R2 storage, D1 publication receipts, an owner-only MCP ingestion interface, and a resumable normalized-package transport. It is **not** a generic Unity project importer, a game runtime, a universal animation converter, or a complete standalone multi-tenant product.

Publish the runnable portable example and a separately labeled **sanitized hosted implementation reference**. Do not represent the reference source as a turnkey recreation of the private hosted deployment. Current build scripts intentionally depend on the private corpus, immutable batch plans, reviewed samples, host configuration, and generated artifacts that must not be included in a public repository.

## Prioritized findings

### P1 — public export must not use repository-wide copying

Evidence: `scripts/build-publication.mjs:5-15` reads real catalogs, classification, a live-baseline fixture, and library manifests; it recursively copies `data`. `scripts/build-worker.mjs:5-17` assembles the actual published corpus and static fallback. `lib/generated/asset-pilot.json` contains an embedded fixed payload (consumed by `lib/asset-pilot-storage.mjs:9`). `.openai/hosting.json` contains deployment configuration. Generated frontend files and tests also contain project-specific pins and provenance.

Impact: copying all tracked source or all JSON “configuration” would publish private asset/provenance data or host configuration, not merely reusable implementation. A text-only secret scanner is insufficient for embedded base64/binary and asset metadata.

Action: explicit file allowlist; synthetic fixtures; omit actual generated release/plan JSON and all corpus directories; audit both source strings and artifacts; describe omitted integration dependencies. Do not create fake original release records to make production builds appear supported.

### P2 — GLB metadata bypasses JSON privacy validation (reproduced)

Evidence: `incremental-candidate/manifest.mjs:20` checks JSON files with `checkJSON`, while its GLB branch parses and validates geometry without applying that check to the embedded document. `checkJSON` at line 24 rejects sensitive metadata keys and local filesystem roots. Lines 41–47 explicitly preserve opaque shader metadata in extras, but no equivalent privacy scan occurs.

Synthetic verification: a structurally valid triangle GLB with `extras.sourceRoot` set to a synthetic local path and `extras.apiKey` set to a non-secret synthetic string was accepted by `validateContent`; the equivalent standalone JSON was rejected with `ingest-private-metadata`.

Impact: normalized GLB exports can retain local-path or credential-shaped metadata that the documented JSON policy otherwise rejects. This does not establish a network leak or auth bypass, but it invalidates a claim that accepted packages are comprehensively metadata-sanitized.

Action: apply a deliberately scoped privacy validation to GLB metadata without confusing shader evidence properties with actual glTF texture references. Add regression tests for sensitive metadata at root, asset, node, material, and mesh extras. Public exports must independently inspect GLB metadata or omit real GLBs.

### P2 — hosted authentication is an infrastructure contract, not application-contained verification

Evidence: `app/chatgpt-auth.ts:21-39` reads trusted authentication headers; it does not verify a signed identity itself. `worker/index.ts:10-11` serves fixed batch storage before the framework authentication helper. `lib/batch877-storage.mjs:24-27` checks allowlisted immutable paths and storage integrity, not caller identity. Dynamic incremental routes correctly call the helper before reading storage (`app/api/review-assets/[...path]/route.ts:13-16`).

Impact: security depends on official host ingress stripping spoofed identity headers and enforcing the existing private audience before Worker/static delivery. Deploying this source onto an arbitrary public Worker is not equivalent to the private Sites deployment. No hosted bypass was tested or demonstrated.

Action: prominently document the ingress trust boundary; do not advertise generic self-hosted authentication. For any new host, supply real verified authentication at the edge and protect static fallback as well as API routes. Perform negative hosted identity/audience tests before accepting that deployment.

### P2 — production build is corpus-bound; public reference cannot honestly promise it works unchanged

Evidence: `scripts/build-worker.mjs:4-17`, `scripts/build-publication.mjs:5-58`, `scripts/sync-canonical-frontend.mjs:2-3`, and eager generated-data imports in `app/mcp/route.ts:6-9` / `worker/index.ts:1-3`. `incremental-candidate/manifest.mjs:1-4` also imports implementation from `asset-source`, not a standalone backend package.

Action: portable example remains runnable; reference backend documents prerequisites and intentionally unsupported production-build command. Longer term, extract reusable validator/rendering modules, inject configured capabilities, and make private sample/pilot/batch integrations optional rather than eager module dependencies.

### P2 — critical ingestion guards are outside default test discovery

Evidence: `package.json` runs `node --test tests/*.test.js`; `incremental-candidate/guards.test.mjs`, shared registry suites, and frontend `.mjs` suites are not included in that glob. `incremental-candidate/probe-local.mjs:5` depends on an external sibling importer path and an already built Wrangler configuration.

Action: add a documented aggregate verification entrypoint with distinct unit, validator, local R2/D1, frontend, and hosted integration stages. Public standalone tests must not claim to exercise private backend ingestion.

### P3 — deployment documentation and route comments are internally stale

Evidence: `app/api/asset-session/route.ts:1-4` says the file is not deployed despite its presence in the framework route tree. Its response retains `hostedIdentityVerification: 'pending'` at line 15. `review-frontend/README.zh-CN.md` combines old release history, current source policy, and links to material outside its local tree. Existing README/build reports include historical claims that are not fresh test evidence.

Action: rewrite top-level README as a current supported contract; move historical receipts to private release records. Clearly separate implemented, locally verified, hosted verified, and unverified behavior.

### P3 — maintainability and operational limits

Storage, manifest, MCP, and directory modules compress complex logic onto extremely long lines (`incremental-candidate/storage.mjs`, `manifest.mjs`, `lib/asset-pilot-mcp.mjs`, `lib/batch877-storage.mjs`). Limits and legacy fixed data are mixed with reusable policy. Incremental object reads hash full object bytes even for HEAD, and fixed pilot reads audit the entire fixed release before returning a single object (`lib/asset-storage-readonly.mjs:15-19,34-36`). These are defensible integrity-first choices for bounded assets, not evidence of scalable arbitrary-size delivery.

Action: format and split policy/validation/storage concerns with unchanged tests; document byte/request/dataset limits and full-read cost. Keep integrity checks unless an equivalent verified immutable-cache design is established.

## Architecture and runtime boundaries

### 1. Canonical frontend

`review-frontend/shared/app.mjs` is the shared application controller. `shell-controller.mjs` owns common DOM composition. `project-loader.mjs` validates/resolves registered project descriptors. `resource-url.mjs` centralizes resource resolution and project cancellation scope. `preview-queue.mjs` handles bounded preview scheduling. `selection-state.mjs` handles local review/selection persistence; `selection-client.mjs` is an optional shared-selection integration, not proof a selection service is implemented in this repository. `review-export.mjs` and `selection-manifest.mjs` produce review/selection outputs. Playback and viewer adapters are capability-dependent.

`review-frontend/adapters/entity-data.mjs` and `indexed-data.mjs` normalize distinct catalog formats. `entity-viewer.mjs` adapts existing native rendering. `review-frontend/emit.mjs:5-12` copies shared implementation and adapters, writes project data descriptors, and optionally copies a viewer source. `asset-source` is mixed: generated UI plus handwritten model/transport implementation plus private data. It cannot be included or excluded wholesale without losing either privacy or backend dependencies.

### 2. Native resource runtime

`asset-source/model-resource.js` verifies self-contained GLB, supports closed glTF resource transport, enforces preview budgets, uses the vendored Three.js GLTF loader, and disposes geometry/material/texture resources. Related modules include `asset-transport.js`, `shared-resource-transport.js`, `model-bundle-transport.js`, `verified-resource-cache.js`, `gltf-static-matrices.js`, `render-pool.js`, and delivery/profile helpers. Browser rendering approximations are not original-engine shader fidelity. Static incremental packages reject skins and playable animation.

### 3. Host and application routing

Vite + Vinext + Cloudflare plugin build the React/framework application and Worker. `/` redirects to `/entity/`. The Worker first handles fixed legacy immutable asset routes, then establishes request-scoped connector capability and delegates to the framework. D1 and R2 binding names originate in host configuration. Connector preview support is local/development-only; it is not a public credential channel.

Authenticated read routes:
- `/api/asset-session`: request identity diagnostics, no browser upload.
- `/api/asset-pilot/status` and `/api/assets/...`: fixed legacy pilot readback.
- `/entity/project-directory.json`: server-owned active dataset directory.
- `/entity/supplemental-preview-links.json`: fixed reviewed supplement readiness lookup.
- `/api/review-assets/{project}/{dataset}/active.json`: current version pointer.
- `/api/review-assets/{project}/{dataset}/{version}/...`: ready immutable files, server-owned descriptor, or trusted hash-checked viewer module.

MCP `/mcp` exposes typed discovery/list/call. Identity comes from the server helper; a configured site-scoped owner binding authorizes import operations. It does not automatically bind the first caller. Arguments, request size, same-origin mutation checks, and tool allowlists are explicit. All incremental tools, including status/check operations, are owner-only under current wrapper behavior.

### 4. Persistent storage

D1 tables:
- `entity_asset_versions`: immutable ready receipt for legacy fixed releases.
- `entity_asset_batch_chunks`: plan-bound fixed batch audit receipts.
- `ingest_plans`: normalized manifest and baseline by project/dataset/version.
- `ingest_files`: verified object receipts by project/dataset/content hash.
- `ingest_versions`: immutable finalized version receipt.
- `ingest_active`: current version and revision by project/dataset.

R2 uses content-derived keys for blocks, complete objects, and version manifests within a validated project/dataset scope. Existing objects are validated, not overwritten; conditional create is followed by SHA/length readback. There is no user-facing arbitrary-key upload/delete or generic file manager. Database schemas and migrations are distinct from private seeded state.

### 5. Incremental import sequence

1. The separate local importer inventories an already normalized static asset tree into a local content-addressed store. It is not contained in this platform checkout.
2. `incremental-candidate/export_local.py` loads that explicitly supplied importer implementation, validates a chosen local version, and creates a bounded manifest plus base64 blocks. No network occurs in this script.
3. `transport.mjs` uses an injected authorized tool callback, not a built-in production HTTP client.
4. `begin` validates manifest, project scope, and expected baseline; stores immutable plan.
5. Check/file/block calls skip verified content. Each block is limited to 32 KiB. Put validates base64, declared size, and SHA before conditional creation and readback.
6. `commit_file` reconstructs and verifies the complete file, validates GLB/PNG/JSON content, conditionally creates the object, and records its validation receipt.
7. `finalize` requires every receipt, re-reads catalog JSON, validates cross-file references, creates the version manifest, and uses one D1 batch transaction to create ready version and compare-and-swap active pointer.
8. Directory reads expose only validated active/ready versions. Server-generated descriptors prevent packages from supplying executable viewer modules, host audience policy, or browser storage namespaces.
9. Lost successful tool responses are reconciled by readback checks. Stale concurrent baselines cannot become active. Old immutable ready versions remain readable.

Current limits: four named project scopes; dataset identifier up to 64 restricted characters; 2,048 files; 1 MiB per file; 256 MiB aggregate declared bytes; 512 KiB manifest; eight JSON files; 32 KiB blocks; MCP request cap 768 KiB; directory cap 128 dynamic datasets. Required catalog files are `assets/catalog.json`, `assets/objects-catalog.json`, `assets/render-profiles.json`, and `assets/canopy-rules.json`. Accepted package formats are restricted GLB, PNG, JSON; animation is metadata-only, not playable.

## Export allowlist and abstraction plan

A safe **reference-only** export can preserve structure and representative implementation without claiming executable hosted deployment. Audit every selected file; the following is a starting allowlist, not permission to skip inspection:

- `app/**/*.ts`, `app/**/*.tsx`, CSS: remove project/host branding and data imports or mark affected routes as disabled reference integrations.
- `worker/index.ts`: preserve documented sequencing, but do not retain a real fixed plan or imply legacy route auth works on arbitrary hosting.
- `db/*.ts`, `drizzle/*.sql`, `drizzle.config.ts`: schema only, no DB state or seeded data. Migration metadata may be regenerated for the sanitized distribution.
- `incremental-candidate/{manifest,storage,transport}.mjs`, `schema.sql`, `export_local.py`, synthetic `guards.test.mjs`: retain validator dependency closure or clearly describe unresolved imports. Never silently change project scope policy and claim original equivalence.
- `lib/asset-pilot-mcp.mjs`, storage modules, directory logic, connector contracts/context/errors: review fixed release identities and branding. `asset-pilot-storage.mjs` and `batch877-storage.mjs` contain fixed corpus constants; replace with explicit reference placeholders only with clear status, or retain generic algorithms separately.
- `review-frontend/shared/*` and adapter JS: remove private supplemental pins and project-specific strings/links; use the already reviewed portable equivalent where appropriate, documenting differences.
- Minimal handwritten `asset-source` JS import closure and required vendored modules: include copyright/license notices; no generated hashed viewer payload, catalogs, profiles, resource binaries, provenance, or project descriptors.
- Synthetic tests and necessary tooling only. Real-corpus tests can be documented as excluded rather than included with private fixtures.

Exclude by default: `.git`, `.openai`, `.sites-runtime`, `.wrangler`, `.next`, `dist`, `out`, `public`, `qa-output`, `node_modules`, `__pycache__`, generated release JSON, private fixtures and receipts, asset/data/model/image directories, recovery archives, batch payloads, screenshots, logs, exports, credential files, and environment files.

Hardcoded integrations requiring abstraction or explicit exclusion:
- Host project identifier/bindings in `.openai/hosting.json`.
- Legacy pinned release constants and generated pilot/batch data.
- Four-project allowlist in `incremental-candidate/manifest.mjs:5` and exported tool schema at `storage.mjs:3`.
- Fixed reviewed sample registry in `lib/reviewed-preview-projects.mjs`.
- Fixed dataset query and pins in `lib/entity-supplemental-preview-links.mjs:6` and `review-frontend/shared/entity-supplemental-pins.mjs`.
- Entity-default route/directory, labels, localStorage keys, and adapter descriptors.
- Source-corpus assumptions in publication/bundle/build/probe scripts.
- Sibling importer path in local integration probe.
- Development host/runtime integration in Vite and Sites plugins; these are not generic hosting recipes.

## Documentation inventory and recommended replacement

Current materials: root `README.md`; `PRODUCTION-WIRING.zh-CN.md`; `docs/fixed-owner-mcp.md`; `docs/fixed-batch877-storage.md`; `incremental-candidate/README.zh-CN.md`; canonical frontend README plus generic-platform, preview-feedback, review-export, startup-recovery docs; renderer registry API; many private batch reports and validation receipts. These are valuable evidence but mix historical deployment statements, private data, and reusable contracts.

Public repository should provide:
1. README: product purpose, runnable quickstart, implementation/reference matrix, explicit unsupported features, verification commands, repo layout.
2. Architecture: component/data flow, immutable schema, trust boundaries, active-pointer semantics, private integration omissions.
3. Product manual: project switching, searching/filtering, object vs resource semantics, preview/profile limitations, local reviews/selections, export/import scope, failure recovery, privacy/storage persistence.
4. Ingestion specification: supported formats, schemas, budgets, validation and resume sequence; no implied raw Unity conversion.
5. Security/deployment: trusted ingress prerequisite, owner-only writes, static resource protection, no public deployment by default, no production identities included.
6. Development/testing: portable smoke tests vs backend synthetic guards vs local R2/D1 integration vs hosted/GPU checks.
7. Third-party notices and licensing scope; do not assign rights to third-party game assets.
8. Review report with current findings and precise verification status rather than inherited release claims.

## Verification performed in this review

Passed: `node --test incremental-candidate/guards.test.mjs tests/asset-pilot-mcp.test.js tests/batch877-storage.test.js tests/incremental-production-wiring.test.js` — **140 tests, 140 passed**, 0 failed/skipped. Output captured outside source checkout.

Passed as reproduction: synthetic privacy-policy inconsistency between GLB extras and standalone JSON, described above. This is a confirmed finding, not a passing product requirement.

Not run by this reviewer: complete test suite, production build, dependency reinstall, local R2/D1 end-to-end probe, real browser layout/touch/GPU checks, real partner login sessions, hosted ingress spoofing tests, remote storage access, public repository upload. No historical report was promoted to fresh verification.
