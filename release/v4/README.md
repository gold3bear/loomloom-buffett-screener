# v4 Release Preparation

Status: **release candidate — not published**. This directory prepares the
LoomLoom Market update; it does not create a Listing version, upload a package, or
publish anything.

## What is in this directory

| File | Purpose |
|---|---|
| `listing-input-schema.json` | Proposed public input schema (5 fields) |
| `build-skill-package.sh` | Builds the v4 Agent Skill ZIP locally |
| `release-notes-v4.md` | User-facing changelog |
| `README.md` | Production publish plan, pricing, rollback, blockers |

The local Skill manifest
[`skill/.../loomloom-skill.json`](../../skill/loomloom-019fad3b-8831-7986-bdd0-db4620e261b8/loomloom-skill.json)
has already been updated to the v4 display name, description and five-field input
schema. Its `installed_listing_version_id` still points at the **published v3
version**; do not change it until the new Listing version is approved.

## Public input schema diff

| Field | v3 | v4 | Notes |
|---|---|---|---|
| `identityPacket` | required | required | unchanged |
| `financialPacket` | required | required | now should include `marketSnapshot.marketCapUsd`, `sharesOutstanding`, and `balanceSheet` |
| `qualitativePacket` | required | required | facts should include `sourceTier` S/A/B/C |
| `modelAssumptions` | — | required | bear/base/bull drivers |
| `asOf` | — | optional | freshness reference; blank falls back to `modelAssumptions.asOf`, then run date |

Schema in [`listing-input-schema.json`](listing-input-schema.json).

## Current production objects (read-only facts)

| Object | Value |
|---|---|
| Listing | `019fad3b-8831-7986-bdd0-db4620e261b8` |
| Listing version | `019fad3b-8831-7980-af5a-7b20b6391df9` |
| Source template | `f3fdd1b3-d16b-4b2d-bd13-5a1351e38cc6` |
| Source template version | `06af2a1c-a3ef-4bd1-8024-df5918b95874` (v7, `template-spec/v1`) |
| Package archive hash | `sha256:f07bd66818b62f737723b322fbe9684bc79e7e2cc2804af2a375d3a05094f281` |
| Package version | `01a09f57-3ced-78c8-82f1-827cc7a61cb4` |
| Price | `0.2 CNY` per billable task (`creator_task_fixed_fee_v1`) |
| Sale status | `listed`, review `approved` |

## Pricing estimate

| Component | Estimate |
|---|---|
| Creator fixed fee | `0.20 CNY` per task (current listing price) |
| Observed model/Code cost (test env, 6 steps) | `≈ 0.0223 CNY` per row |
| Estimated total pay-per-use | `≈ 0.22 CNY` per row |
| Subscription | not enabled; no bundle tiers |

`market quote` / `template-spec precheck` on the published version is the
authoritative number. Code execution pricing is not configured in the controlled
test environment; production may differ. Do not change `--task-fixed-fee` without
a pricing decision.

## Publish plan (requires explicit confirmation)

### 0. Local checks

```bash
cd skill/loomloom-019fad3b-8831-7986-bdd0-db4620e261b8
node --test scripts/*.test.mjs
python3.12 -m unittest discover -s model -p "test_*.py"
python3.12 model/minify_code.py --check
node scripts/sync-model-code.mjs --check
```

### 1. Build and hash the Skill ZIP

```bash
bash release/v4/build-skill-package.sh
# -> release/v4/loomloom-buffett-screener-v4.zip
# -> print sha256 and byte size
```

### 2. Create a production template version

The existing source template is `template-spec/v1`; the v4 file is
`template-spec/v2`. Try a version on the existing template first:

```bash
export LOOMLOOM_SERVER='https://loomloom.shengsuanyun.com/loom/v1'
export LOOMLOOM_TOKEN='<production creator token>'

loomloom --server "$LOOMLOOM_SERVER" --token "$LOOMLOOM_TOKEN" \
  template-spec check templates/buffett-four-filters-model.cogfoundry/template.json

loomloom --server "$LOOMLOOM_SERVER" --token "$LOOMLOOM_TOKEN" \
  template-spec create-version f3fdd1b3-d16b-4b2d-bd13-5a1351e38cc6 \
  templates/buffett-four-filters-model.cogfoundry/template.json \
  --version-note "v4 preflight gate + three-statement DCF"
```

If the server rejects a v2 spec on a v1 template, create a **new v2 template**
instead and keep the new `templateId` for step 4:

```bash
loomloom --server "$LOOMLOOM_SERVER" --token "$LOOMLOOM_TOKEN" \
  template-spec create templates/buffett-four-filters-model.cogfoundry/template.json \
  --version-note "v4 preflight gate + three-statement DCF"
```

Record `templateId` and `versionId`.

### 3. Upload the Skill package to the template

```bash
loomloom --server "$LOOMLOOM_SERVER" --token "$LOOMLOOM_TOKEN" \
  skill package private upload <template-id> \
  --file release/v4/loomloom-buffett-screener-v4.zip \
  --expected-archive-hash <current-head-hash> \
  --expected-validation-id <current-head-validation-id>
```

If the template has no package head, omit the two `--expected-*` flags. The
current production template returned `skill_package_not_found` from
`skill package private show`, so the platform may need to attach/migrate the
package first. Record the returned archive hash and validation ID.

### 4. Publish the Listing version

```bash
loomloom --server "$LOOMLOOM_SERVER" --token "$LOOMLOOM_TOKEN" \
  listing publish <template-id> \
  --listing-id 019fad3b-8831-7986-bdd0-db4620e261b8 \
  --template-version-id <version-id> \
  --skill-package-archive-hash <archive-hash> \
  --skill-package-validation-id <validation-id> \
  --display-name "美股长期价值批量初筛（巴菲特四维 + 三表 DCF · beta）" \
  --description "四维并行研究 + 确定性前置门禁与三表 DCF；仅研究辅助，不构成投资建议。" \
  --task-fixed-fee 0.2 \
  --pay-per-use
```

Submitting for review does not make the version sellable. Check:

```bash
loomloom --server "$LOOMLOOM_SERVER" --token "$LOOMLOOM_TOKEN" \
  listing show 019fad3b-8831-7986-bdd0-db4620e261b8 --output json
loomloom --server "$LOOMLOOM_SERVER" --token "$LOOMLOOM_TOKEN" \
  market show 019fad3b-8831-7986-bdd0-db4620e261b8 --output json
```

### 5. Post-approval verification

1. `market show` shows the new `listingVersionId`, five input fields, and the new price.
2. `market quote` on a known row returns a numeric estimate (not `CODE_PRICING_PENDING`).
3. Run one known-good row and one deliberately invalid row; confirm the invalid row is
   skipped with `ready=false` and no downstream artifacts.
4. Update `installed_listing_version_id` in `loomloom-skill.json` to the new Listing version.
5. Tag the repo `v4.0.0` and publish the Release ZIP.

## Rollback

- Before approval: `listing withdraw 019fad3b-...` cancels the pending review.
- After approval: `listing unlist 019fad3b-...` removes it from sale; the previous
  approved version remains the last sellable one until the new one is approved.
- Do not delete the previous template version.

## Known blockers / risks

1. **v1 template vs v2 spec**: production source template versions are
   `template-spec/v1`; v4 is `template-spec/v2`. Confirm whether `create-version`
   accepts the new spec version; otherwise create a new v2 template.
2. **Skill package head missing**: `skill package private show` returned
   `skill_package_not_found` for the current source template, even though the
   Listing has an approved package archive. The platform may need to attach the
   package to the template before `upload`.
3. **Public schema source**: the Listing input schema matches the local
   `loomloom-skill.json` snapshot, so the new ZIP and manifest must be uploaded
   before publishing; a template-only publish will not add the fields.
4. **Code pricing**: not configured in the test environment. Confirm production
   Code pricing and the final `market quote` before announcing a price.
5. **Review**: publishing submits for review; it is not an instant release.
