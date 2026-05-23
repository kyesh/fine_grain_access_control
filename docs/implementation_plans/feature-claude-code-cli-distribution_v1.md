# Claude Code CLI Skill — Standalone Distribution & Validation

Focus on Package #4 (Claude Code CLI) from the distribution architecture. The previous branch tried to package all 4 distribution channels at once — this branch narrows scope to get one channel working end-to-end.

## Problem Statement

The Claude Code CLI skill (Package #4) is intended to let Claude Code users install a SKILL.md + local scripts bundle that gives Claude the ability to interact with Gmail via the FGAC.ai proxy. The scripts already exist in `docs/skills/gmail-fgac/scripts/` and work for OpenClaw. However:

1. **No self-contained distribution bundle exists** — `public/skills/claude-code/SKILL.md` describes the skill but doesn't ship the scripts. Option B tells users to `cp -r /path/to/fgac/docs/skills/gmail-fgac/scripts` which is not a viable distribution channel.
2. **The CC CLI QA test (`agents/03_claude_code_cli.md`) has never been fully validated** — it references a `--plugin-dir` flag that doesn't exist in Claude Code.
3. **The reset.sh doesn't copy skills into `.claude/skills/`** — it just installs npm deps in the repo's scripts dir.

## Proposed Changes

### 1. Create a self-contained Claude Code CLI skill bundle

#### [NEW] `public/skills/claude-code-cli/SKILL.md`

A standalone SKILL.md specifically for Claude Code CLI mode (separate from the existing `public/skills/claude-code/SKILL.md` which covers MCP Option A + CLI Option B in one file).

This new file will:
- Use Claude Code's native `SKILL.md` frontmatter format (`name`, `description`, `allowed-tools`)
- Reference scripts as relative paths (scripts are co-located)
- Include setup instructions (run `node scripts/setup.js` which handles auth flow)
- Include tool usage instructions (how Claude should invoke `gmail.js`, `accounts.js`)

#### [NEW] `public/skills/claude-code-cli/scripts/` (symlinked or copied)

The actual scripts bundle served from `public/` so they can be downloaded. We'll copy (not symlink, since Next.js `public/` doesn't follow symlinks) the scripts from `docs/skills/gmail-fgac/scripts/`.

> [!IMPORTANT]
> **Build-time copy vs runtime copy decision**: We need a small build script that copies `docs/skills/gmail-fgac/scripts/` → `public/skills/claude-code-cli/scripts/` to keep them in sync. OR we restructure so the canonical scripts live in `public/skills/claude-code-cli/scripts/` and `docs/skills/gmail-fgac/scripts/` becomes a reference to it.

**Recommended**: Move the canonical scripts to `public/skills/claude-code-cli/scripts/` and update `docs/skills/gmail-fgac/SKILL.md` to reference them. This avoids sync issues entirely.

---

### 2. Fix the CC CLI test environment (`test/qa-envs/cc-cli/`)

#### [MODIFY] [reset.sh](file:///home/kyesh/GitRepos/fine_grain_access_control/test/qa-envs/cc-cli/reset.sh)

Current reset.sh is minimal — just installs npm deps in-place. It needs to:
1. Wipe the workspace clean (already does this)
2. Copy the skill bundle into `.claude/skills/gmail-fgac/` (Claude Code discovers skills from this directory)
3. Run `npm install` in the copied scripts directory
4. Verify the skill is discoverable

#### [MODIFY] [03_claude_code_cli.md](file:///home/kyesh/GitRepos/fine_grain_access_control/docs/QA_Acceptance_Test/agents/03_claude_code_cli.md)

Update to:
- Remove the `--plugin-dir` flag (not a real Claude Code flag)
- Use Claude Code's actual skill discovery: place skill in `.claude/skills/gmail-fgac/`
- Fix the launch command to use `claude --dangerously-skip-permissions` from the workspace dir
- Update auth steps to work with the self-contained scripts

---

### 3. Update the production distribution doc

#### [MODIFY] [production/03_claude_code_cli.md](file:///home/kyesh/GitRepos/fine_grain_access_control/docs/QA_Acceptance_Test/production/03_claude_code_cli.md)

Define the actual production install mechanism. Until Claude Code has a marketplace, the install is manual:
```bash
# Download the skill bundle
mkdir -p .claude/skills/gmail-fgac
curl -sL https://fgac.ai/skills/claude-code-cli/SKILL.md -o .claude/skills/gmail-fgac/SKILL.md
curl -sL https://fgac.ai/api/skills/claude-code-cli/bundle.tar.gz | tar xz -C .claude/skills/gmail-fgac/
cd .claude/skills/gmail-fgac/scripts && npm install
```

#### [NEW] `src/app/api/skills/claude-code-cli/bundle/route.ts`

API endpoint that serves the scripts as a tarball for easy download. Reads from `public/skills/claude-code-cli/scripts/` and serves as `bundle.tar.gz`.

---

### 4. Clean up the unified SKILL.md

#### [MODIFY] [public/skills/claude-code/SKILL.md](file:///home/kyesh/GitRepos/fine_grain_access_control/public/skills/claude-code/SKILL.md)

Simplify to only cover Option A (MCP mode). Add a link to the CLI bundle for Option B users. This separates the two distribution channels cleanly.

---

## User Review Required

> [!IMPORTANT]
> **Script canonical location**: Should the scripts live in `public/skills/claude-code-cli/scripts/` (served directly by Next.js) or should we keep them in `docs/skills/gmail-fgac/scripts/` and add a build-time copy step? Moving them to `public/` is simpler but changes the OpenClaw skill to reference a different path.

> [!IMPORTANT]  
> **Bundle API vs static files**: Should we serve the scripts as a tarball via an API route (`/api/skills/claude-code-cli/bundle`), or as static files in `public/` that users download individually? The tarball is easier for one-command installs but adds server-side complexity.

> [!WARNING]
> **Claude Code skill discovery**: Claude Code discovers skills from `.claude/skills/*/SKILL.md`. The test runbook currently uses `--plugin-dir` which isn't a real flag. We need to confirm Claude Code's actual skill discovery mechanism and update accordingly.

## Open Questions

1. Is the `--dangerously-skip-permissions` flag sufficient for QA, or do we need a different approach for running Claude Code non-interactively with local scripts?
2. Do you want a one-line install command (e.g., `npx fgac-cli-install`) that bootstraps the skill, or is a curl-based approach acceptable for now?
3. Should we test against `localhost:3000` or against a preview deployment for this validation pass?

## Verification Plan

### Automated Tests
1. **Script smoke test**: `node scripts/gmail.js --help` exits 0 from the self-contained bundle
2. **Auth flow test**: `FGAC_ROOT_URL=http://localhost:3000 node scripts/auth.js --action login` completes OAuth
3. **Skill discovery test**: Claude Code launched from `test/qa-envs/cc-cli/` discovers `gmail-fgac` skill
4. **End-to-end**: Follow the full QA runbook in `agents/03_claude_code_cli.md`

### Manual Verification
- Run `/qa-claude-code-cli` workflow after changes
- Verify the production install curl commands work against the preview deployment
