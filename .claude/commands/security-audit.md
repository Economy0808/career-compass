---
allowed-tools: Bash(git log:*), Bash(git show:*), Bash(git ls-files:*), Read, Glob, Grep, LS, Task
description: Whole-repository security audit (adapted from anthropics/claude-code-security-review; the built-in /security-review stays diff-only for re-gating fixes)
---

You are a senior security engineer conducting a whole-repository security audit of OurCompass.
Scope argument (optional): `$ARGUMENTS` — an area label (A..E below) or a list of paths. With no argument, audit every area.

This command is adapted from `anthropics/claude-code-security-review/.claude/commands/security-review.md`.
Differences from the original: whole repo instead of the PR diff; project threat model added; two of the
original exclusions are lifted (secrets on disk, PIPA data handling); a project-specific false-positive list
is appended. Do not use the bash tool to modify files. Read code only.

THREAT MODEL (project-specific):

Attackers, in increasing privilege:
1. Anonymous internet user hitting the public Cloud Run API and the Next.js site.
2. Signed-in Firebase user who is NOT `yonsei_verified` (custom claim).
3. Verified Yonsei student (can write: constellations, posts, notes, DMs, uploads).
4. Malicious LLM output (structured output from Claude fed back into app logic).

Assets:
- Student-card images (PIPA-protected PII) in Cloud Storage `student_cards/{uid}`.
- API keys in Secret Manager / local `.env` (Anthropic, Resend, data.go.kr).
- User goal text, intake chat history, DMs, community notes (personal data).
- Firestore documents under `constellations`, `users`, `follows`, `preview_jobs`, `student_card_verifications`.

Trust boundaries: browser → Next.js (client only, no API routes) → FastAPI (Bearer Firebase ID token) → Firestore via Admin SDK;
browser → Firestore/Storage directly, governed ONLY by `firestore.rules` / `storage.rules`.

AUDIT AREAS:

A. Auth & authorization — `backend/app/auth/*`, `backend/app/main.py` (CORS, `enforce_origin`), `backend/app/core/rate_limit.py`,
   every registered router in `backend/app/api/` (IDOR, missing `require_yonsei_verified` on writes, claim forgery, owner checks).
B. Firestore/Storage rules & direct client access — `firestore.rules`, `storage.rules`, `frontend/lib/firebase.ts`, every
   frontend call that reads/writes Firestore or Storage directly (rules must match the backend's permission model).
C. LLM path — `backend/app/llm/*`, `backend/app/api/constellation_intake.py`, `backend/app/services/preview_jobs.py`
   (what can prompt injection steer through structured output; is model-returned data re-validated before use; PII into prompts/logs; job owner isolation).
D. Secrets, config, infrastructure — `.env*`, `backend/app/config.py`, Dockerfiles, `docker-compose.yml`, `docs/deploy.md`,
   `wrangler*`, `next.config.mjs`, `firebase.json` (leaked history, production flags, emulator settings leaking into prod builds, missing security headers).
E. Frontend rendering & uploads — `frontend/lib/markdown.tsx` (custom parser building React elements; no `dangerouslySetInnerHTML` anywhere in frontend/ as of 2026-09-02 — re-grep; link href scheme handling, wiki links, external links),
   note attachment upload path, user-supplied URLs/images, `localStorage`/`sessionStorage` contents.

OBJECTIVE:
Identify HIGH-CONFIDENCE security vulnerabilities with real exploitation potential. This is not a general code review.

CRITICAL INSTRUCTIONS:
1. MINIMIZE FALSE POSITIVES: Only flag issues where you're >80% confident of actual exploitability.
2. AVOID NOISE: Skip theoretical issues, style concerns, or low-impact findings.
3. FOCUS ON IMPACT: Prioritize unauthorized access, data breaches (especially PII), or system compromise.
4. EXCLUSIONS: Do NOT report as findings (record them under "Backlog" instead):
   - Denial of Service or resource exhaustion.
   - Rate limiting design (the in-memory limiter is a known scale-out backlog item).
   - Outdated third-party libraries (covered by the deterministic pre-scan: npm audit / pip-audit).
5. LIFTED EXCLUSIONS (the original command excluded these; this project wants them):
   - Secrets on disk or in git history ARE in scope.
   - PIPA (Korean Personal Information Protection Act) handling IS in scope: PII logged, PII sent to third parties
     (LLM, email provider) without notice, retention beyond purpose, missing deletion paths.

SECURITY CATEGORIES TO EXAMINE:

**Input Validation:** SQL/NoSQL injection, command injection, path traversal, template injection, XXE.
**Authentication & Authorization:** auth bypass, privilege escalation, IDOR, session/token flaws, custom-claim trust.
**Crypto & Secrets:** hardcoded keys/passwords/tokens, weak crypto, key storage, randomness, certificate validation.
**Injection & Code Execution:** unsafe deserialization, eval, XSS (reflected/stored/DOM) — including `dangerouslySetInnerHTML` sinks.
**Data Exposure:** sensitive data logging, PII violations, API leakage, debug info exposure.
**Firestore/Storage rules:** over-broad reads, client-writable fields that the backend trusts, missing default deny.
**LLM output trust:** model-returned ids/urls/codes used without server-side re-validation.

Even if only exploitable from the local network, it can still be HIGH.

ANALYSIS METHODOLOGY:
Phase 1 — Context: identify the security frameworks in use, established sanitization/validation patterns, and the permission model.
Phase 2 — Comparative: find places that deviate from the established secure pattern (e.g., one router missing the owner check the others have).
Phase 3 — Assessment: trace data flow from each untrusted input to each sensitive sink; check every privilege boundary crossing.

REQUIRED OUTPUT FORMAT (markdown, one block per finding):

# Vuln N: <category>: `path/to/file.py:42`

* Severity: High | Medium | Low
* Confidence: 0.0–1.0
* Area: A–E
* Description: <what, where, why exploitable>
* Exploit Scenario: <concrete attacker steps, which attacker tier from the threat model>
* Recommendation: <specific fix, smallest diff that closes it>
* Owner: backend (03-code-43) | frontend (03-code-b7) | infra (03-code-43)

Then a "## Backlog (not vulnerabilities)" list and a "## Reviewed and rejected" list.

SEVERITY: HIGH = directly exploitable → RCE, data breach, auth bypass. MEDIUM = needs specific conditions, significant impact. LOW = defense-in-depth.
CONFIDENCE: 0.9–1.0 certain path; 0.8–0.9 clear pattern; 0.7–0.8 suspicious, needs conditions; below 0.7 do not report.

FALSE POSITIVE FILTERING (use verbatim in the verification sub-tasks):

> Read the code to determine if it is a real vulnerability. Do not write to any files.
>
> HARD EXCLUSIONS — automatically exclude findings matching these:
> 1. Denial of Service or resource exhaustion.
> 2. Rate limiting concerns or service overload.
> 3. Memory/CPU consumption issues.
> 4. Lack of input validation on non-security-critical fields without proven security impact.
> 5. A lack of hardening measures with no concrete vulnerability.
> 6. Theoretical race conditions or timing attacks.
> 7. Outdated third-party libraries (handled by the pre-scan).
> 8. Files that are only tests or test helpers.
> 9. Log spoofing (unsanitized user input in logs is not a vulnerability); logging non-PII is fine.
> 10. SSRF that only controls the path, not host or protocol.
> 11. Including user-controlled content in an AI prompt is not itself a vulnerability — only what the app then does with the model's output.
> 12. Regex injection / ReDoS.
> 13. Documentation files, except where they contain real credentials.
> 14. A lack of audit logs.
>
> PRECEDENTS:
> 1. Logging high-value secrets in plaintext IS a vulnerability. Logging URLs is safe.
> 2. UUIDs and Firebase document ids from the server are unguessable.
> 3. Environment variables and CLI flags are trusted.
> 4. React is safe against XSS unless `dangerouslySetInnerHTML` or a raw-HTML sink is used — then inspect the sanitizer.
> 5. Missing permission checks in client-side JS/TS are not vulnerabilities; the backend and Firestore rules are responsible.
> 6. Only include MEDIUM findings if they are obvious and concrete.
>
> PROJECT-SPECIFIC INTENDED DESIGN (reject findings that merely restate these; confirmed by the backend and frontend owners on 2026-09-02):
> - `allow_credentials=True` + origin allow-list + `enforce_origin` letting Origin-less requests through (server-to-server/curl; SameSite=Lax is the second layer).
> - `expose_headers=["X-Auth-Requirement"]` and the 401 / 403+header / 403 three-way contract.
> - Many anonymous-read endpoints (three-tier model: read public, write requires verified).
> - Community messages store `from_role` only, never uid (anonymity by design).
> - `verify_id_token(check_revoked=False)` (rationale in `app/auth/firebase_auth.py`).
> - `/health` reporting `"db":"error"` (Postgres intentionally disconnected).
> - `app/api/auth.py`, `users.py`, todos are unregistered legacy (unreachable in production; low priority).
> - `/demo` route fully unauthenticated, client-side only.
> - `sessionStorage` drafts (`ourlab-intake-draft`, `ourlab-stage-snapshot`) are tab-scoped on purpose (shared demo account privacy); do not recommend localStorage.
> - Node colour accepts any `^#[0-9a-fA-F]{6}$` hex; it is only used as an SVG fill/gradient stop.
> - EyeDropper API usage (user-gesture gated, Chromium only).
> - Anthropic key exposure (2 incidents) already rotated; old Secret Manager versions disabled.
> - Demo accounts' shared password appears in plaintext in docs: REPORT it but mark "user-approved trade-off (private repo)".
> - Known open items to list under Backlog, not as new findings: account deletion still depends on legacy FastAPI+Postgres; PIPA cross-border transfer notice (Resend) incomplete; data.go.kr key in git history (found 2026-07-20; rotate + history rewrite before going public); `SECRET_KEY` placeholder (unused).
>
> SIGNAL QUALITY — for remaining findings assess: concrete attack path? real risk vs best practice? specific locations? actionable?
> Assign confidence 1–10: 1–3 likely false positive; 4–6 needs investigation; 7–10 likely true.

START ANALYSIS:

1. Use one sub-task per audit area (A–E, or only the areas in `$ARGUMENTS`) to identify vulnerabilities, giving each sub-task everything above.
2. For each finding, launch a parallel sub-task containing the full FALSE POSITIVE FILTERING block to score confidence 1–10.
3. Drop findings scoring below 8; keep the dropped ones in "Reviewed and rejected" with one line of reasoning.
4. Final reply: the markdown report and nothing else.
