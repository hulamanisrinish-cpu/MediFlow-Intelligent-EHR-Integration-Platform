# Security Policy

## Supported versions

MediFlow is a demonstration project. Security fixes are applied to the `main` branch only.
There are no maintained release branches.

## Reporting a vulnerability

**Do not open a public issue for a security problem.**

Use GitHub's private vulnerability reporting on this repository:

1. Open the **Security** tab.
2. Select **Report a vulnerability**.
3. Include affected endpoints/files, reproduction steps, impact, and any suggested fix.

If private reporting is unavailable, contact the repository owner through the contact
method on their GitHub profile and ask for a private channel. Do not include secrets,
patient data, or exploit details in a public issue.

You can expect an acknowledgement within 7 days and a remediation plan within 30 days.
This is a best-effort process for a portfolio project, not a commercial SLA.

## Scope

In scope:

- Authentication, session handling, RBAC, and audit logging.
- CORS, security headers, rate limiting, and request validation.
- Injection, XSS, SSRF, and secret exposure in application code.
- FHIR mapping/sync flaws that could leak data or send malformed resources.
- Dependency vulnerabilities in production packages.

Out of scope:

- The synthetic patient data itself (it is fabricated).
- Denial of service through the in-memory rate limiter (documented limitation).
- Missing HIPAA/GDPR certification (this project does not claim compliance).
- Issues requiring access to the owner's Cloudflare, Turso, or Gemini accounts.

## Secret handling

- Never commit `.dev.vars`, `.env`, API keys, database tokens, or reset credentials.
- `backend/.dev.vars.example` contains placeholders only.
- CI runs `npm run check:secrets`; the check is a safety net, not a substitute for review.
- If a secret is exposed, rotate it immediately. Removing it from the latest commit does
  not remove it from git history.

## Demo mode warning

`AUTH_MODE=demo` disables identity checks so the synthetic demo can run without a login.
It must never be enabled for a deployment that contains real data. The application logs a
warning at startup when demo mode is active.

## Known limitations

- Rate limiting is per Worker isolate, not global.
- The project has not been penetration-tested or clinically validated.
- FHIR integration has been tested against mocks, not a live sandbox.
