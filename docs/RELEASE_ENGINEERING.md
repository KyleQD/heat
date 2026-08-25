# HEAT Release Engineering — Phase B policies

Operational contract for building, validating, versioning, and shipping the
iOS app and API. Every policy here maps to a Phase B ticket (handoff v1.1).

## 1. Project generation policy (HEAT-B001)

- Source of truth: `apps/ios/project.yml`.
- `Heat.xcodeproj` is **gitignored** and regenerated everywhere:
  - locally: `cd apps/ios && xcodegen generate`
  - CI: every iOS job runs `xcodegen generate` before any `xcodebuild`
- Never hand-edit the `.xcodeproj`; changes will be overwritten and are not
  reviewable.

## 2. Build configurations (HEAT-B002)

| Config | Optimization | Bundle ID | Display name | API base URL |
|---|---|---|---|---|
| Debug | debug | `com.heatapp.ios` | HEAT | `http://localhost:8787` (or `HEAT_API_URL` env) |
| Staging | release | `com.heatapp.ios.staging` | HEAT Staging | `${HEAT_STAGING_API_URL}` at build time |
| Release | release | `com.heatapp.ios` | HEAT | `${HEAT_RELEASE_API_URL}` at build time |

Staging and Release URLs are **build-setting expressions** (`${VAR}`), resolved
by `xcodebuild` from its environment at compile time:

- unset → empty `HEAT_API_BASE_URL` in Info.plist → non-Debug binaries hit
  `fatalError` at boot (`AppEnvironment.init`) — no placeholder fallback exists.
- The CI `ios-archive` job additionally rejects placeholder hosts
  (`.invalid`, `example`, `unset.`, `localhost`) in archived plists.

## 3. Signing & identity (HEAT-B004)

- `DEVELOPMENT_TEAM = ${HEAT_DEVELOPMENT_TEAM}` — injected at build time;
  empty for unsigned simulator CI builds.
- Certificates/profiles NEVER live in the repository. Release/TestFlight
  builds run on GitHub Actions using App Store Connect API key secrets
  (see §7); local machines use their own signing identity.
- Staging ships as a separate bundle id so it can be installed alongside
  production during beta.

## 4. Universal links decision (HEAT-B006)

Beta ships **custom-scheme deep links only** (`heat://event/<uuid>`, plus the
`https://heat.app/event/<uuid>` parser kept tolerant-but-inert: foreign hosts
and malformed UUIDs are rejected, and https links do not claim Associated
Domains yet). Consequences:

- No `applinks:heat.app` entitlement is compiled into beta builds.
- Apple App Site Association + Associated Domains land with Phase J
  (public launch) together with server-side AASA hosting and path tests.
- Until then, pasting an `https://heat.app/...` link into Safari must not be
  expected to open the app; share sheets use the `heat://` scheme.

## 5. Version strategy (HEAT-B011)

- `MARKETING_VERSION`: human version, currently `0.2.0` (single source:
  `project.yml`).
- `CURRENT_PROJECT_VERSION`: monotonic build number; CI injects
  `github.run_number` for archives.
- Tags: one synchronized repository tag per release train:
  - `ios-vX.Y.Z` when the iOS app changes,
  - `api-vX.Y.Z` when the API changes,
  - both tagged together for coordinated releases.

## 6. Archive validation gate (HEAT-B008)

The `ios-archive` CI job archives the **Staging** configuration against
`generic/platform=iOS Simulator` (unsigned) and fails unless all of:

- archive completes (`ARCHIVE SUCCEEDED`);
- `HEAT_API_BASE_URL` present, `https://`, non-placeholder;
- staging bundle id `com.heatapp.ios.staging`;
- display name `HEAT` / `HEAT Staging`;
- non-empty `CFBundleShortVersionString` and positive `CFBundleVersion`;
- `MinimumOSVersion == 17.0`;
- app icon compiled into the bundle;
- `PrivacyInfo.xcprivacy` present.

Device/TestFlight archives require signing and run only in the release
pipeline (§7).

## 7. TestFlight pipeline (HEAT-B012)

```text
merge release candidate to main  (all four required checks green)
→ tag ios-vX.Y.Z
→ release workflow (tag push):
     xcodegen generate
     xcodebuild archive -configuration Release   ← requires secrets
     xcodebuild -exportArchive (workflow generates exportOptions plist)
     xcrun altool --upload-app -f Heat.ipa       (App Store Connect API key)
→ App Store Connect processing
→ internal testers group smoke test (fresh install, boot guard, map load,
  star, create, route preview)
→ closed beta group rollout (Phase I cohort)
```

Required repository secrets (set by owner, never committed):

| Secret | Purpose |
|---|---|
| `APPSTORE_KEY_ID` / `APPSTORE_ISSUER_ID` / `APPSTORE_KEY_P8` | App Store Connect API auth for upload |
| `MATCH_*` or manual cert import | distribution signing identity |
| `HEAT_RELEASE_API_URL` | production endpoint baked into the binary |

Until those secrets exist the release workflow exits with an explicit
"secrets not configured" failure — never a silent no-op — and no manual local
archive is the only production path once they are set.

## 8. Branch protection (HEAT-B010)

`main` is protected (enforced for admins):

- required checks: `api`, `ios-core`, `ios-app`, `ios-archive`;
- branches must be up to date before merge;
- force pushes, deletion, and non-linear history disabled;
- unresolved conversations block merge.

Deliberate exception: mandatory PR review is **not** enabled while HEAT has a
single maintainer (it would make direct pushes impossible with no second
reviewer). Revisit before Phase J public launch or as soon as a second
engineer joins.

