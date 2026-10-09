# localbolt-ci

Fail CI before a translator — or a customer — finds the missing key.

You added a locale. You missed two strings in it. Nobody notices until a French user hits
checkout and sees English fallback text in the middle of a payment flow. `localbolt-ci` diffs
every locale file against your base locale (usually `en`) and exits non-zero the moment one is
incomplete, so the gap fails your build instead of your release.

```
$ node cli.js check --dir test/fixtures/locales
```

![CLI demo](media/cli-demo.svg)

That output is real — rendered against this repo's own `test/fixtures/locales`, not staged.

## Install

No registry account needed. Clone or install directly from GitHub:

```
npm install github:growaleaf/localbolt-ci
```

or just copy `cli.js` — it is a single dependency-free file (Node 18+ built-ins only: `fs`,
`path`, `os`, `crypto`). No `npm install` step, no supply-chain surface to audit beyond this
one file.

## Usage

```
node cli.js check [--dir <path>] [--base <locale>] [--json]
```

- Scans `<path>` (default: cwd) for locale files under a `locales/`, `i18n/`, `lang/`,
  `langs/`, or `translations/` directory — both `.json` and a read-only `.yaml`/`.yml` subset.
- Infers the base locale (`en`, if present) unless `--base` is given.
- Exit codes: `0` every locale is complete · `1` at least one locale is missing a key ·
  `2` a configuration or parse error · `3` missing or invalid Pro license.

## Pricing

**Pro — $19, one time.** No subscription, no per-seat pricing, no recurring charge, no
telemetry, no network call of any kind. Buy once: https://localbolt-ci.madeforthisday.com/buy

The license is checked **fully offline** — ECDSA-P256 signature verification against a public
key embedded in this file. Nothing phones home; your repository contents, file paths, and
locale keys never leave your machine. Set the key via the `LOCALBOLT_KEY` environment variable
(the right place for a CI secret) or `~/.localbolt/license`.

A Pro license purchased here also unlocks the Localbolt VS Code extension (in-editor
diagnostics, a completion dashboard, and this same CI export) once that listing is live — one
purchase, both surfaces.

## Why this exists instead of i18n Ally

i18n Ally is an excellent in-editor tool. It has no CI mode: nothing in its command surface
produces a process exit code a pipeline can gate on. `localbolt-ci` is the missing CI step —
use both, for different jobs.

## License

Proprietary — see [LICENSE](LICENSE). Source is readable for audit; a paid license is required
to run it. Refunds: email support within 14 days of purchase for a full refund, no questions
asked — see purchase receipt for the contact address.
