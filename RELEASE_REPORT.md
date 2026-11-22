# SafeBlock — Release / Packaging Report

Final task in the pipeline (implementation → QA → security → docs → release).
Date: 2026-11-21. Performed by: Release Engineer. No remote was configured and
**nothing was pushed**.

---

## 1. Artifact

| Field | Value |
|---|---|
| Artifact path | `/home/agentroost/safeblock/safeblock-extension.zip` |
| Size | 12,894 bytes |
| SHA-256 | `b35870faad83152e081c0bae43811b521d4647c251d37fc642c1944f5b29fbab` |
| Files in archive | 17 (extension runtime files only) |
| `manifest.json` at zip root | yes (single entry, no wrapper directory) |
| Reproducible | yes — a rebuild produces the identical SHA-256 |
| Git status of artifact | untracked by design, ignored via `.gitignore` (`*.zip`) |

Contents (paths exactly as stored in the archive):

```
manifest.json
content/adult.js
content/youtube.js
icons/icon16.png
icons/icon48.png
icons/icon128.png
lib/compat.js
lib/rules.js
lib/settings.js
options/options.css
options/options.html
options/options.js
popup/popup.css
popup/popup.html
popup/popup.js
rules/ads_trackers.json
rules/adult_filter.json
```

Deliberately excluded: `.git/`, `node_modules/`, `__pycache__/`, the zip
itself, `.gitignore`, and the workspace documents `README.md`, `QA_REPORT.md`
and this report (repository/review artifacts, not extension runtime files). No
temporary or verification script lives in the workspace — the verification and
packaging scripts were kept outside the repository, in `/tmp`.

## 2. Git commit

| Field | Value |
|---|---|
| Repository | `/home/agentroost/safeblock` (local only) |
| Branch | `master` |
| Release commit | `80b656d688795759495bfab3a4648cbee1b2c5ae` (`80b656d`) |
| Commit message | `Add SafeBlock MV3 extension (v0.1.0)` |
| Author | `SafeBlock Release Engineer <release@safeblock.local>` (repo-local identity) |
| Files committed | 20 (17 extension files + `README.md`, `QA_REPORT.md`, `.gitignore`) |
| Remote / push | no remote configured (`git remote -v` is empty); nothing pushed |

The repository existed but had no commits; `git config --global --add
safe.directory /home/agentroost/safeblock` was run as instructed, then the root
commit was created locally. A follow-up commit adds this report.

## 3. Structural verification performed

Verifier: read-only Python script (path resolution, DNR rule integrity, PNG
header parsing, HTML asset resolution, packaging-noise scan) plus `node --check`
and `python3 -m json.tool`. Run against the working tree **and** re-run against
the extracted contents of the built zip.

| Check | Result |
|---|---|
| `manifest.json` parses, `manifest_version` = 3, name/version/description present | pass |
| All 13 manifest references resolve (`rule_resources[].path`, `content_scripts[].js`, `action.default_popup`, `options_ui.page`, 3 icons) | pass |
| `rules/ads_trackers.json`: 109 rules, unique ids 1–109, valid actions/conditions | pass |
| `rules/adult_filter.json`: 181 rules, unique ids 1000–1180, valid actions/conditions | pass |
| Icons are real PNGs at 16×16, 48×48, 128×128 matching their manifest keys | pass |
| `popup/popup.html` and `options/options.html`: 5 local asset refs each resolve | pass |
| `node --check` on all 7 JS files | pass |
| `python3 -m json.tool` on manifest and both rulesets | pass |
| Packaging-noise scan (no `node_modules`, `__pycache__`, `.venv`, temp scripts) | pass |
| **Same 14 checks re-run on the unpacked zip contents** | pass (14 passed, 0 failed) |
| Extracted archive bytes identical to source files (SHA-256 per file) | pass, 17/17 |
| Zip integrity (`zipfile.testzip()`), no directory entries, no absolute/`.` paths | pass |

Negative controls (each run against a throwaway copy; the checker failed every
time, so a green run is meaningful):

| Injected fault | Detected |
|---|---|
| delete `popup/popup.html` | yes — missing manifest reference + missing file |
| re-wrap a ruleset as `{"rules": [...]}` | yes — "is not a JSON array" |
| duplicate rule id in `adult_filter.json` | yes — duplicate id reported |
| replace `icon48.png` with the 128 px image | yes — size mismatch |
| add a `node_modules/` directory | yes — packaging noise |
| truncate a ruleset to invalid JSON | yes — parse error with position |
| break a `popup.html` asset reference | yes — unresolved asset |
| empty tree | yes — manifest missing |

## 4. Defect found and fixed during packaging (needs a QA re-review tick)

**Blocker:** both static ruleset files were shaped as `{"rules": [ ... ]}`. A
file referenced from `declarative_net_request.rule_resources[].path` must be a
**top-level JSON array** of rules — the `{ "rules": [...] }` object is the
`updateDynamicRules()` request shape, not a static ruleset file. With the
previous shape a browser refuses to load the ruleset, so the extension would
not have worked as shipped. QA §2.3 recorded "top-level keys `["rules"]`" and
treated it as valid; that conclusion was wrong.

Change made (mechanical, rule content untouched):

* `rules/ads_trackers.json`, `rules/adult_filter.json` — unwrapped to a
  top-level array; re-serialised with 2-space indent.
* `README.md` — "Customizing the block lists" now says *top-level array*
  instead of "`rules` array", and the post-edit check block adds two
  assertions that the top level of each file is an array.

Evidence that no rule data changed:

```
ads_trackers.json : sem( before["rules"] ) == sem( after )  -> True, 109 rules
adult_filter.json : sem( before["rules"] ) == sem( after )  -> True, 181 rules
```

Both files were compared after parsing (not textually), so ordering,
`urlFilter`, `resourceTypes`, priorities and ids are provably identical.

File hashes before → after:

| File | md5 before (QA §6.1) | md5 after |
|---|---|---|
| `rules/ads_trackers.json` | `b32cdf92f0e12d7fbc709f58e3b60e63` | `f605981d9f4c60afc292ab21e3ce11c1` |
| `rules/adult_filter.json` | `3b7f7ba16bc01d289dc4d0f8fe7bb3a9` | `0091cccb192f6304b3b3390c4392e20c` |

Unchanged relative to QA §6.1: `manifest.json` (`7fad8ca3…`), `lib/compat.js`,
`lib/rules.js`, `lib/settings.js`, `content/adult.js`, `content/youtube.js`,
`popup/popup.js`, `options/options.js`.

This is the only content change made by the packaging step. It should be
acknowledged in QA (a re-run of QA §2.2/§2.3 against the array shape) before
any store submission; the checks above replace that re-run only for the
mechanical properties, not as a fresh QA sign-off.

## 5. Still open after this task

* **D1 (High, QA):** both `content_scripts` entries inject `lib/compat.js` and
  `lib/settings.js`; on YouTube both entries match, so the shared files are
  evaluated twice in one isolate and `const DEFAULT_SETTINGS`
  (`lib/settings.js:3`) throws `SyntaxError: Identifier 'DEFAULT_SETTINGS' has
  already been declared`. Not fixed here — it is a code change needing browser
  verification, outside packaging scope. Tracked as `tkt_2dd3aad3`/O1 work.
* **D2 (Low):** rule id 109 uses `||facebook.com/tr` instead of
  `||facebook.com/tr^`, over-blocking `/travel`, `/trending`, etc. Left as-is:
  it changes blocking behaviour and needs a product decision, not a release
  edit.
* **D3 (Low):** no `gecko.strict_min_version`, so Firefox 109–112 can install
  but cannot toggle static rulesets.
* **Browser smoke test not run:** no Chrome/Firefox binary in this environment,
  so "loads as an unpacked extension and blocks a known ad domain" was **not**
  executed. This is the one acceptance item that remains unproven and must be
  done by a human with a browser (`tkt_900cdd95`).
* **No remote:** there is no `origin`, so no push and no PR were possible. When
  a remote is added, push `master` (or a branch) and open a PR from `80b656d` +
  the report commit; `.gitignore` already keeps the zip out of history.

## 6. Rollback

The ruleset-shape fix is inside the root commit, so `git revert` is not the
tool for undoing just that change. Two documented paths:

* **Undo the fix only** (returns the original, non-loading shape): re-wrap each
  file with
  `python3 -c 'import json,sys;p=sys.argv[1];json.dump({"rules":json.load(open(p))},open(p,"w"),indent=2)' rules/ads_trackers.json rules/adult_filter.json`.
  The pre-fix copies are preserved at `/tmp/ads_trackers.before.json` and
  `/tmp/adult_filter.before.json` (scratch, outside the repository). Do **not**
  ship the reverted tree — the wrapper shape prevents the browser from loading
  the ruleset.
* **Undo the whole release** (nothing was published): delete
  `safeblock-extension.zip`; the repository is a single local root commit with
  no remote, so `git reset --hard` / deleting `.git` returns the workspace to
  its pre-commit state without affecting anyone else.
* **Artifact rebuild:** the build is deterministic (sorted entries, fixed
  timestamps), so rebuilding from commit `80b656d` reproduces SHA-256
  `b35870faad83152e081c0bae43811b521d4647c251d37fc642c1944f5b29fbab`.

---

## 7. Addendum — publication to GitHub (2026-11-21)

The project was published to the public repository
<https://github.com/radu1006/SafeBlock> under the Apache License 2.0.

* `LICENSE` (Apache 2.0, copyright `2026 radu1006`) and the README licence,
  repository and Firefox-minimum-version sections were added for publication.
* The tree pushed is **not** `80b656d`: it also carries the fixes for the
  release blockers and defects that were open when this report was written —
  H1/O1 (`<all_urls>` content script and `content/adult.js` removed),
  D1/M1 (`lib/settings.js` made re-entrant), D2/L2 (`||facebook.com/tr^`),
  D3/I2 (`strict_min_version: "113.0"`) and L1 (`ping`, `object`, `other`
  added to every rule) — plus the AMO `data_collection_permissions`
  declaration from I3.
* Consequently `safeblock-extension.zip` on disk, and the SHA-256 recorded in
  §1, describe the pre-fix tree. Regenerate the zip from the published commit
  before any store submission; the archive is ignored by `.gitignore` and is
  not part of the repository.
* The browser smoke test listed in §5 and the QA/security reports' O4/§6 items
  are still unexecuted.

---

## 8. Addendum — rebake of both packaged artifacts (2026-11-22)

Rebuild ticket: `tkt_521ecd3b-e70a-44fc-8abe-0e1e0d8b5477` (Release Engineer).
Trigger: QA defect **DEF-1** (stale `safeblock-extension.zip`) and **DEF-2** (stale
`safeblock-main.bundle`) from the 2026-11-22 verification of the YouTube in-feed ad
fix (`tkt_a1ad0cf9`, QA `tkt_4de71cff`). Both artifacts predated the uncommitted
`content/youtube.js` change and shipped the old 4-selector `HIDE_SELECTORS`, so the
distributable did not hide in-feed/promoted ads at all.

### 8.1 Commits landed

| Commit | Subject | Files |
|---|---|---|
| `f02d5bd` | Hide YouTube in-feed, promoted, shelf and masthead ad slots | `content/youtube.js`, `README.md` (+30/−6) |
| `193108c` | Record QA verification of the YouTube in-feed ad change | `QA_REPORT.md` (+372) |

Base: `03e81ee` (previous `main`, also `origin/main`). This addendum is a third,
documentation-only commit on top of `193108c`; it changes no source file and no
artifact (the artifacts were rebuilt before it was written). The
`content/youtube.js` change was already reviewed and QA-verified; it was committed
**as-is** — no source file was edited by this ticket. `manifest.json` is untouched
(`git show 03e81ee:manifest.json` is identical to the working tree).
`git status --porcelain -uall` is empty after the commits and the artifact rebuilds
(both artifacts are ignored: `*.zip` via `.gitignore`, the bundle via
`.git/info/exclude`).

### 8.2 Artifact A — `safeblock-extension.zip`

| Field | Previous (stale) | Rebuilt (2026-11-22) |
|---|---|---|
| Size | 12,406 bytes | **12,579 bytes** |
| SHA-256 | `25a965dc77fab6cde6566699bc51035855c231c6e25d5685278b28fada402b31` | **`5094a04305201020857dadc1f2a6deee9adcbc5cc400c085e49bd85fdb92ede8`** |
| Files in archive | 16 | 16 (same list) |
| `manifest.json` at zip root | yes | yes |
| Zip integrity (`testzip()`) | clean | clean |
| Directory entries / absolute or `./` paths | none | none |
| Tracked by git | no (`*.zip` ignored) | no |

The only entry that differs from the previous archive is `content/youtube.js`
(8,229 → 8,713 bytes, sha256 `7a51e27f…` → **`678242a5df6ddaddbabeb7be9d4e8c2c9a2604b4fb10525b7a60f3000625f61d`**,
which equals the working-tree source). All other 15 entries are byte-identical to
the working tree; all 16 are byte-identical to the post-change tree.

Build recipe (deterministic; nothing else about the archive changed): the 16
extension runtime files, sorted by path, `manifest.json` at the root, no directory
entries, no wrapper directory, `ZIP_DEFLATED`, fixed timestamp `2026-11-21 00:00:00`
and mode 0644. Proof the recipe is the same one used before: re-packing the
**pre-change** commit `03e81ee` with it reproduces the old artifact exactly
(12,406 bytes, sha256 `25a965dc…`), so the new zip differs from the old one only in
`content/youtube.js`.

`HIDE_SELECTORS` read back **out of the zip** (13 entries):

```
#player-ads, .ytp-ad-overlay-container, ytd-display-ad-renderer, .ytp-ad-module,
ytd-ad-slot-renderer, ytd-in-feed-ad-layout-renderer,
ytd-promoted-sparkles-web-renderer, ytd-promoted-video-renderer,
ytd-companion-slot-renderer, ytd-banner-promo-renderer,
ytd-statement-banner-renderer, ytd-brand-video-shelf-renderer, #masthead-ad
```

### 8.3 Artifact B — `safeblock-main.bundle`

| Field | Previous (stale) | Rebuilt (2026-11-22) |
|---|---|---|
| Size | 44,357 bytes | **53,537 bytes** |
| SHA-256 | `e9e87ea089abc14fcf82bd9a602420a68437790efdcecd0ec4965c4358da197c` | **`7d7e5ed15b29fca4d5f39c86298b55e0310674fcbcd74db75a62aef998c604ac`** |
| `refs/heads/main` | `03e81ee5835988c222cc102efe774f8922a1cb12` | **`193108ce92509fa6de54663abea36eda5be8b962`** |
| `git show main:content/youtube.js` sha256 | `7a51e27f…` (pre-change) | **`678242a5df6ddaddbabeb7be9d4e8c2c9a2604b4fb10525b7a60f3000625f61d`** |
| Bundle integrity | `git bundle verify`: complete history | `git bundle verify`: **okay, records a complete history** |

Cut with `git bundle create safeblock-main.bundle refs/heads/main` from `193108c`,
the last commit before this addendum; it contains the fix commit `f02d5bd`. This
addendum's own commit follows the bundle and is therefore not inside it — a bundle
cannot name the commit that records its hash. Re-running the same command after
this commit reproduces the identical source tree under a new
`refs/heads/main` value; the artifact-to-source relationship documented here is
what the release depends on.

### 8.4 Verification performed on the rebuilt artifacts

| Check | Command | Result |
|---|---|---|
| Zip parses, no corrupt member | `python3 -m zipfile`-level `zipfile.ZipFile(...).testzip()` | `None` (clean) |
| No directory entries, no absolute/`./`/`..` paths | entry-list scan | 0 found |
| `manifest.json` at zip root | entry-list scan | yes (single entry, no wrapper dir) |
| Every zip entry byte-identical to the working tree | per-entry `sha256` compare, 16/16 | pass, 0 mismatches |
| Zip `content/youtube.js` = post-change source | `sha256` compare | `678242a5df…` = `678242a5df…` |
| 13 `HIDE_SELECTORS`, incl. all 9 in-feed/promoted selectors | regex over the entry's block | 13/13 present |
| No first-party container selector emitted | block scan for `ytd-rich-item-renderer`, `ytd-rich-grid-renderer`, `#content`, `#primary` | none present |
| Rebuild reproducibility | re-pack `03e81ee` → compare with old artifact | identical bytes (`25a965dc…`) |
| Bundle ref points at a commit containing the change | `git bundle list-heads` + `git log main -- content/youtube.js` | `193108c` → contains `f02d5bd` |
| Bundle payload equals the source | `git init` + `git fetch <bundle> refs/heads/main` then `git show main:content/youtube.js \| sha256sum` | `678242a5df…` (13 selectors) |
| Bundle manifest equals the workspace manifest | `git show main:manifest.json \| cmp - manifest.json` | identical |
| Negative control: the *old* bundle really was stale | same fetch against the pre-rebuild bundle | ref `03e81ee`, `content/youtube.js` `7a51e27f…` (old) — the failure reproduced, so the green check above is meaningful |
| Tarball JS syntax + regression scripts | `node --check` (6/6), `.verify/check_scope.js`, `check_resource_types.js`, `check_amo_manifest.js`, `check_youtube_feed.js` | all pass, exit 0 |

### 8.5 Not done / residual

* **Published to `origin` (2026-11-22).** `main` was pushed to
  `https://github.com/radu1006/SafeBlock.git` as a **fast-forward**:
  `03e81ee..6ec0688  main -> main` — no force, no history rewrite, no branch
  deleted. Verified afterwards: `git ls-remote origin` reports
  `6ec0688da1fa853c983c0505357ab976f4f8dfc5` for both `HEAD` and
  `refs/heads/main`, and a fresh clone of the remote has
  `content/youtube.js` = `678242a5df6d…` with all 13 `HIDE_SELECTORS` and
  `manifest.json` = `b6ca1cb3b787…`. No PR was used: `gh` is not authenticated on
  this machine (`gh pr list` → "please run `gh auth login`") and a direct push to
  `main` was explicitly requested. This paragraph was committed and pushed as a
  documentation-only follow-up, so `git ls-remote origin main` is authoritative for
  the current tip — it is one commit newer than the `6ec0688` recorded here.
  The bundle is unchanged by the push and still points at `193108c` (§8.3), which is
  part of the published history.
* **The artifacts are not in git** (zip ignored by `.gitignore`, bundle ignored by
  `.git/info/exclude`), so the remote does not carry them; they must be regenerated
  from the pushed commit for a store upload. §8.2/§8.3 give the identities to
  compare against.
* **Browser smoke test still unexecuted** (§5, `tkt_900cdd95`): no Chrome/Firefox
  binary in this environment. The artifacts are structurally correct and contain
  the reviewed code, but "in-feed ads are actually hidden on live YouTube" remains
  unproven here.
* The earlier §1/§3 figures describe the pre-publication tree and are superseded by
  §8 for the current artifacts; §7's statement that the on-disk zip was pre-fix is
  likewise resolved by §8.
