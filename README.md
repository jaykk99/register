<!-- <p align="center">
   <img alt="is-a.dev Banner" src="https://raw.githubusercontent.com/is-a-dev/register/main/media/banner.png">
</p> -->

<p align="center">
   <img height="350" alt="is-a.dev Banner" src="https://raw.githubusercontent.com/is-a-dev/register/main/media/banner.png">
</p>

<p align="center">
   <img alt="Domains" src="https://img.shields.io/github/directory-file-count/is-a-dev/register/domains?color=5c46eb&label=domains&style=for-the-badge">
   <img alt="Open Pull Requests" src="https://img.shields.io/github/issues-raw/is-a-dev/register?color=5c46eb&label=issues&style=for-the-badge">
   <img alt="Open Issues" src="https://img.shields.io/github/issues-pr-raw/is-a-dev/register?color=5c46eb&label=pull%20requests&style=for-the-badge">
   <br>
</p>

<h1 align="center">is-a.dev</h1>

<p align="center"><strong>is-a.dev</strong> is a service that allows developers to get a sweet-looking <code>.is-a.dev</code> subdomain for their personal websites.</p>

---

## Announcements
Please join our [Discord server](https://discord.gg/is-a-dev-830872854677422150) for announcements, service updates, and downtime notifications regarding the service.

Not all announcements are posted on GitHub[^1], however they will always be posted in our Discord server.

[^1]: We only post announcements on GitHub in the case of a serious incident, which you'll see at the top of this README.

# Register
> If you want a visual guide, check out [this blog post](https://blog.wharrison.com.au/2024/07/is-a-dev/).

- [Fork](https://github.com/is-a-dev/register/fork) the repository.
- Follow the instructions on our [documentation](https://docs.is-a.dev).
- Once you open your pull request (PR), it will be reviewed. *Keep an eye on it in case changes are needed!*
   - If changes have been requested, please make the specified changes otherwise **you will be rejected**.
- Once your PR is merged, your DNS records should be published with-in a few minutes.
- Enjoy your new `.is-a.dev` subdomain! Please consider leaving a star ⭐️ to help support us!

## Registry tooling

Beyond the registration docs, this repo ships tooling for working with the registry data itself:

- **Validation** — `npm run validate` checks every file in `domains/` against the same rules the CI tests enforce (file naming, JSON shape, owner username/email format, record values and combinations). Use `npm run validate:changed` to check only files changed in your branch, or `node scripts/validate.js domains/yourname.json` for a single file with friendly error output.
- **Query** — `npm run query -- --owner <github-user>`, `--name <text>`, `--type <CNAME|A|URL|...>`, `--target <text>`, `--proxied` / `--no-proxied`. Combine filters with AND; add `--json` for machine-readable output. See `node scripts/query.js --help`.
- **Export** — `npm run export -- --stats` prints registry aggregates (record-type counts, top owners, proxied share). `--format json|csv --out <file>` writes a compact index of every domain (subdomain, owner, record types, targets) for analysis.
- **Schema** — `util/schema.json` documents the canonical domain-file format (editors can use it for autocomplete/validation); `util/validator.js` is the single source of truth for the validation rules shared by the tests and the CLI.

The automated checks (`npm test`) validate all ~12k domain files: file names, required/optional fields, owner identity format (GitHub username rules, valid non-empty emails), every record value (IP ranges, hostnames, URL schemes, record-type combinations), nested-subdomain parentage, and proxy rules.

## Spam Pull Requests
With the recent rising of invalid PRs, including PRs generated with AI, we reserve the right to:

- Close these PRs without explanation.
- Block or limit the author's ability to interact with is-a.dev's repositories and resources.
- Remove any existing domains owned by the author if connected to TOS-violating content.

## Report Abuse
If you find any subdomains being abused or breaking our [ToS](https://is-a.dev/terms), please report them by [creating an issue](https://github.com/is-a-dev/register/issues/new?assignees=&labels=report-abuse&projects=&template=report-abuse.md&title=Report+abuse) with relevant evidence.

---

We are supported by Cloudflare's [Project Alexandria](https://www.cloudflare.com/lp/project-alexandria) sponsorship program, we would not be able to operate without their help!

<a href="https://www.cloudflare.com">
   <img alt="Cloudflare Logo" src="https://raw.githubusercontent.com/is-a-dev/register/main/media/cloudflare.png" height="48">
</a>
