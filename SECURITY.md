# Security Policy

This policy applies to all repositories under [@learningequality](https://github.com/learningequality).

## Reporting

Use the **Report a vulnerability** button on the affected repository's Security tab to open a private report. If that's not available, email `security@learningequality.org`. Please don't open a public issue, PR, or forum post for security reports.

## Scope

In scope: source code in Learning Equality-maintained repositories, and official builds and packages we publish.

Out of scope: third-party deployments of our software, third-party plugins or forks, dependency vulnerabilities (report those upstream), and findings that require physical access or an already-authenticated admin doing what admins are documented to do.

**Do not test against Learning Equality-operated services** (e.g. anything under a `learningequality.org` subdomain). Reproduce locally — our projects are straightforward to install and run, and we'll help if you get stuck.

## What to include

- The affected component (repository, file, endpoint, version) and how to reproduce.
- A working proof of concept for **each claimed impact**. If you assert exfiltration, RCE, or privilege escalation, demonstrate it — don't just demonstrate the precondition. Hypothesised follow-on impact is fine, but label it as such.
- The deployment context you tested against. Many impact claims depend on environment — cloud metadata exfiltration only matters for cloud-hosted instances, for example.

Reports will be triaged at the level of impact actually shown.

## Response

We'll acknowledge within 5 business days and give an initial assessment within 14. Learning Equality is a small team; response times may slip during holidays or release freezes.

## Disclosure

Coordinated disclosure. We develop a fix privately, ship it, and publish a GitHub Security Advisory at release. Target window is 90 days from confirmation, faster for severe issues. Please hold public write-ups until the advisory is out — we're happy to link to them from the advisory once it is.

## Credit and bounties

No paid bounty — Learning Equality is a non-profit. Reporters are credited in the advisory and release notes unless they ask not to be.

## Safe harbour

We won't pursue legal action against good-faith research that follows this policy.
