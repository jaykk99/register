#!/usr/bin/env node
// Search the subdomain registry.
//
//   node scripts/query.js --name blog              # subdomain contains "blog"
//   node scripts/query.js --owner octocat           # owned by GitHub user "octocat"
//   node scripts/query.js --type CNAME              # has a CNAME record
//   node scripts/query.js --target vercel.app      # any record value contains "vercel.app"
//   node scripts/query.js --proxied                # proxied through Cloudflare
//   node scripts/query.js --type URL --json        # machine-readable output
//
// Filters combine with AND. Results default to a 50-row human table; --limit N
// changes that, --limit 0 removes it.
"use strict";

const fs = require("fs");
const path = require("path");

const DOMAINS_DIR = path.resolve(__dirname, "..", "domains");

function flattenTargets(records) {
    const out = [];
    for (const [type, value] of Object.entries(records || {})) {
        const vals = Array.isArray(value) ? value : [value];
        for (const v of vals) {
            if (typeof v === "string") out.push(v);
            else if (v && typeof v === "object")
                out.push(v.target || v.value || JSON.stringify(v));
        }
    }
    return out;
}

function buildIndex() {
    const files = fs.readdirSync(DOMAINS_DIR).filter((f) => f.endsWith(".json"));
    const index = [];
    for (const file of files) {
        const subdomain = file.replace(/\.json$/, "");
        let data;
        try {
            data = JSON.parse(fs.readFileSync(path.join(DOMAINS_DIR, file), "utf8"));
        } catch {
            continue; // broken JSON is the validator's job
        }
        const records = data.records && typeof data.records === "object" ? data.records : {};
        index.push({
            subdomain,
            fqdn: `${subdomain}.is-a.dev`,
            owner: (data.owner && data.owner.username) || "(unknown)",
            types: Object.keys(records),
            targets: flattenTargets(records),
            proxied: data.proxied === true
        });
    }
    return index;
}

function matches(entry, filters) {
    if (filters.name && !entry.subdomain.toLowerCase().includes(String(filters.name).toLowerCase())) return false;
    if (filters.owner && entry.owner.toLowerCase() !== String(filters.owner).toLowerCase()) return false;
    if (filters.type && !entry.types.includes(String(filters.type).toUpperCase())) return false;
    if (filters.target && !entry.targets.some((t) => t.toLowerCase().includes(String(filters.target).toLowerCase())))
        return false;
    if (filters.proxied === true && !entry.proxied) return false;
    if (filters.proxied === false && entry.proxied) return false;
    return true;
}

function parseArgs(args) {
    const filters = {};
    let limit = 50;
    let asJson = false;

    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        const next = () => args[++i];
        if (a === "--name") filters.name = next().toLowerCase();
        else if (a === "--owner") filters.owner = next().toLowerCase();
        else if (a === "--type") filters.type = next().toUpperCase();
        else if (a === "--target") filters.target = next().toLowerCase();
        else if (a === "--proxied") filters.proxied = true;
        else if (a === "--no-proxied") filters.proxied = false;
        else if (a === "--limit") limit = parseInt(next(), 10);
        else if (a === "--json") asJson = true;
        else if (a === "-h" || a === "--help") {
            console.log(`Usage: node scripts/query.js [filters] [--limit N] [--json]

Filters (combine with AND):
  --name <text>       subdomain contains text
  --owner <username>  exact GitHub username (case-insensitive)
  --type <TYPE>       has record type, e.g. CNAME, A, URL
  --target <text>     any record value contains text
  --proxied           only Cloudflare-proxied domains
  --no-proxied        only non-proxied domains`);
            process.exit(0);
        } else {
            console.error(`Unknown argument: ${a}`);
            process.exit(1);
        }
    }

    return { filters, limit, asJson };
}

function main() {
    const { filters, limit, asJson } = parseArgs(process.argv.slice(2));

    if (Object.keys(filters).length === 0) {
        console.error("Provide at least one filter. See --help.");
        process.exit(1);
    }

    const results = buildIndex()
        .filter((e) => matches(e, filters))
        .sort((a, b) => a.subdomain.localeCompare(b.subdomain));

    if (asJson) {
        console.log(JSON.stringify(limit === 0 ? results : results.slice(0, limit), null, 2));
        return;
    }

    const shown = limit === 0 ? results : results.slice(0, limit);
    for (const r of shown) {
        const types = r.types.join(",");
        const target = r.targets[0] ? ` -> ${r.targets[0].slice(0, 60)}` : "";
        console.log(`${r.fqdn}  [${types}]${r.proxied ? " (proxied)" : ""}  @${r.owner}${target}`);
    }
    console.log(`\n${results.length} match(es)${results.length > shown.length ? `, showing ${shown.length}` : ""}.`);
}

if (require.main === module) main();

module.exports = { buildIndex, matches, flattenTargets };
