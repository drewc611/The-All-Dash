# Security audit — The-All-Dash — 2026-09-27

Part of a 22-repository audit of this account. The cross-repository report (method, pain points, business impact, solution analysis, roadmap) is published at https://claude.ai/artifact/KgdrC9eNyCwdqjvSfwMNuB.

## Summary for this repository

| Severity | Count |
|---|---|
| Medium | 1 |
| Low | 3 |

**AI-generated placeholder / default credential findings (★):** AD-1 (fixed in this PR)

Automated passes run against this repository: gitleaks 8.24.2 (full history and tree), the placeholder-credential checker now shipped in `scripts/`, semgrep 1.178.0 (`p/security-audit`, `p/secrets`, `p/owasp-top-ten`, `p/github-actions`), bandit, pip-audit and npm audit where applicable, plus a manual review of auth, input handling, workflows and deployment files.

## Findings

| ID | Severity | Category | Location | Evidence | Impact | Fix | Status |
|---|---|---|---|---|---|---|---|
| AD-1 ★ | Medium | Default credentials in the documented run path | `docker-compose.yml:14,16,33,120,124; .env.example` | `ALLDASH_API_KEYS: ${ALLDASH_API_KEYS:-dev-key-change-me}`, `POSTGRES_PASSWORD:-alldash`, `FRONTEND_AUTH_USER:-admin`, `FRONTEND_AUTH_PASSWORD:-dev-password-change-me` | Forgetting to edit `.env` silently boots with a public API key, DB password and `admin` login. Ports are loopback-bound and production refuses to start without keys, which caps this at Medium. | Secrets now use `${VAR:?message}` so compose stops until `.env` sets them. | fixed in this PR |
| AD-2 | Low | Expression interpolated into a run step | `.github/workflows/release.yml:81-84,451` | `version="${{ inputs.version }}"`; `git push origin --delete "${{ github.ref_name }}"` | Only collaborators can set these inputs; limited surface. | Pass through `env:` and reference the variable. | open |
| AD-3 | Low | Actions on mutable tags and unverified downloads in release | `.github/workflows/ci.yml:19-20; release.yml:67-68,260,263,302` | `dtolnay/rust-toolchain@stable`, `tauri-apps/tauri-action@v0`, `curl -sSLo kubectl ...` without checksum | Release job holds signing secrets. | Pin SHAs; verify checksums. | open |
| AD-4 | Low | Indirect prompt injection from scraped pages | `backend/app/web/llm.py:160-166` | Page content shares the user turn with the operator prompt | Output is JSON-parsed and audited only; blast radius is data quality. | Delimit page content as data; validate output schema. | open |

## Guardrails added in this change

- `scripts/check-placeholder-secrets.sh` — fails the build on placeholder credentials, secret defaults, disabled-auth defaults, `debug=True`, literal secret assignments, private keys and committed `.env` files.
- `.gitleaks.toml` — gitleaks defaults plus custom placeholder rules and a fixture allowlist.
- `.github/workflows/secret-scan.yml` — runs both on every push and pull request and weekly over full history (SHA-pinned actions).
- `.pre-commit-config.yaml` — the same checks locally; run `pre-commit install` once.
- `docs/security/AI-CODING-GUARDRAILS.md` — the binding rules for any AI-assisted change, with references.
- A "Security rules for AI-assisted changes" section in `CLAUDE.md` (and `AGENTS.md` / Copilot instructions where present).
- `.gitignore` rules for `.env`, keys and Terraform state where they were missing.

See the cross-repository report for the fail-closed pattern by language and the prioritised fix list.
