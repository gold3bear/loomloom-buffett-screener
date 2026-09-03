# LoomLoom US Equity Value Screening Skill

A Skill for local Agents that performs batch long-term value screening of US equities. It first prepares and validates data locally, then runs a parallel research pass through the LoomLoom public SkillBot, and finally audits the evidence locally, applies hard vetos, and produces a deterministic ranking.

> Research aid only. Not investment advice. The Skill never outputs target prices, position sizes, or buy/sell instructions.

## Install — for the Agent

Hand the following paragraph to your Agent:

> Please open https://github.com/gold3bear/loomloom-us-value-screening-skill, download the latest `loomloom-us-value-screening-skill-v2.zip` from Releases, and extract the directory `loomloom-019fad3b-8831-7986-bdd0-db4620e261b8` into the Agent's local Skills directory, preserving every file and folder beneath it. Installation is a local file operation only — do NOT create any LoomLoom cloud task. Then read the extracted `SKILL.md`, verify that the `loomloom` CLI is available, and run `loomloom doctor`. If credentials are not configured, ask me to supply my own ShengSuanyun API key. Do not write the key into the Skill, the repo, the logs, or any report.

## Download the Skill

Get the Skill only from [GitHub Releases](https://github.com/gold3bear/loomloom-us-value-screening-skill/releases/latest). The file is `loomloom-us-value-screening-skill-v2.zip`. The ZIP is not committed to the Git source so we keep reviewable source code separate from release artifacts.

## Manual install with Codex

In the project root where you want to use the Skill:

```bash
curl -L \
  https://github.com/gold3bear/loomloom-us-value-screening-skill/releases/latest/download/loomloom-us-value-screening-skill-v2.zip \
  -o /tmp/loomloom-us-value-screening-skill-v2.zip

mkdir -p .codex/skills
unzip -q /tmp/loomloom-us-value-screening-skill-v2.zip -d .codex/skills
```

After install, the path below must exist:

```text
.codex/skills/loomloom-019fad3b-8831-7986-bdd0-db4620e261b8/SKILL.md
```

For a global install, replace `.codex/skills` with `~/.codex/skills`. Other Agents use their own Skills directory, but the extracted Skill directory name must be preserved exactly.

## Configure the LoomLoom CLI

The cloud research steps depend on the `loomloom` CLI. If it is not installed, clone the official repo and follow its README:

```bash
git clone https://github.com/Cogfoundry-labs/loomloom.git
# If GitHub is not reachable in your network, use the Gitee mirror:
# git clone https://gitee.com/cogfoundry/loomloom.git
```

Configure your own ShengSuanyun credentials (do NOT commit them):

```bash
export LOOMLOOM_SERVER='https://loomloom.shengsuanyun.com/loom/v1'
export LOOMLOOM_TOKEN='<replace with your own ShengSuanyun key>'
loomloom doctor
```

After `doctor` passes, read the installed Skill's `SKILL.md` and start a research run by providing tickers or a standardized financial metrics table.

## Operating principles

1. Local Agent always runs preflight and packet construction first.
2. Before every cloud run the Agent fetches a server quote and obtains explicit confirmation from the user for that run.
3. Cloud results only enter the ranking after local evidence audit, hard-veto checks, and falsification-condition review.
4. Any change in input, price, data period, or quote forces a re-preflight, a re-quote, and a new confirmation.

## Repository layout

```text
index.html                                              Static product page
loomloom-us-value-screening-poster-v1.png               Hero poster
skill/                                                  Reviewable v2 Skill source
docs/brand-spec.md                                      Page visual and asset spec
```

## Local validation

```bash
node --test skill/loomloom-019fad3b-8831-7986-bdd0-db4620e261b8/scripts/*.test.mjs
```

## License

This repository is released under the [MIT License](LICENSE). Use remains subject to the LoomLoom Terms of Service and any third-party data-source restrictions.
