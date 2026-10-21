#!/usr/bin/env node
// Find existing subdomains that look confusingly similar to a candidate name.
// A moderation helper for reviewing registration PRs: typosquats and
// look-alike names (e.g. "goggle" vs "google") are a classic spam vector.
//
//   node scripts/similar.js --name goggle
//   node scripts/similar.js --name paypa1 --distance 2 --limit 20
//   node scripts/similar.js --name example --json
//
// Distance is case-insensitive Levenshtein over the subdomain part only
// (the ".is-a.dev" suffix is ignored). Default max distance is 2.
"use strict";

const fs = require("fs");
const path = require("path");

const DOMAINS_DIR = path.resolve(__dirname, "..", "domains");

// Classic DP Levenshtein; inputs are short subdomain labels so the
// straightforward O(n*m) table is fine.
function levenshtein(a, b) {
    const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
        let diag = prev[0];
        prev[0] = i;
        for (let j = 1; j <= b.length; j++) {
            const temp = prev[j];
            prev[j] = Math.min(
                prev[j] + 1,
                prev[j - 1] + 1,
                diag + (a[i - 1] === b[j - 1] ? 0 : 1)
            );
            diag = temp;
        }
    }
    return prev[b.length];
}

function loadSubdomains() {
    return fs
        .readdirSync(DOMAINS_DIR)
        .filter((f) => f.endsWith(".json"))
        .map((f) => f.replace(/\.json$/, ""));
}

// Returns [{ subdomain, distance, owner }] sorted by distance then name.
function findSimilar(candidate, subdomains, maxDistance) {
    const needle = candidate.toLowerCase();
    const hits = [];
    for (const subdomain of subdomains) {
        const hay = subdomain.toLowerCase();
        if (hay === needle) continue; // exact match is not "similar"
        // Cheap pre-filter: labels that differ wildly in length cannot be close.
        if (Math.abs(hay.length - needle.length) > maxDistance) continue;
        const distance = levenshtein(needle, hay);
        if (distance <= maxDistance) hits.push({ subdomain, distance });
    }
    return hits.sort((a, b) => a.distance - b.distance || a.subdomain.localeCompare(b.subdomain));
}

function ownerOf(subdomain) {
    try {
        const data = JSON.parse(
            fs.readFileSync(path.join(DOMAINS_DIR, `${subdomain}.json`), "utf8")
        );
        return (data.owner && data.owner.username) || "(unknown)";
    } catch {
        return "(unknown)";
    }
}

function main() {
    const args = process.argv.slice(2);
    let name = null;
    let maxDistance = 2;
    let limit = 20;
    let asJson = false;

    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        const next = () => args[++i];
        if (a === "--name") name = String(next()).toLowerCase();
        else if (a === "--distance") maxDistance = parseInt(next(), 10);
        else if (a === "--limit") limit = parseInt(next(), 10);
        else if (a === "--json") asJson = true;
        else if (a === "-h" || a === "--help") {
            console.log(`Usage: node scripts/similar.js --name <candidate> [--distance N] [--limit N] [--json]

Finds registered subdomains within Levenshtein distance N of the candidate
name (default N=2). Exact matches are excluded.`);
            process.exit(0);
        } else {
            console.error(`Unknown argument: ${a}`);
            process.exit(1);
        }
    }

    if (!name) {
        console.error("--name <candidate> is required. See --help.");
        process.exit(1);
    }
    if (!Number.isInteger(maxDistance) || maxDistance < 1 || maxDistance > 5) {
        console.error("--distance must be an integer between 1 and 5.");
        process.exit(1);
    }

    const hits = findSimilar(name, loadSubdomains(), maxDistance);
    const shown = hits.slice(0, limit);

    if (asJson) {
        console.log(
            JSON.stringify(
                shown.map((h) => ({ ...h, owner: ownerOf(h.subdomain) })),
                null,
                2
            )
        );
        return;
    }

    if (shown.length === 0) {
        console.log(`No subdomains within distance ${maxDistance} of "${name}".`);
        return;
    }
    for (const h of shown) {
        console.log(`${h.subdomain}.is-a.dev  (distance ${h.distance})  @${ownerOf(h.subdomain)}`);
    }
    console.log(
        `\n${hits.length} similar name(s)${hits.length > shown.length ? `, showing ${shown.length}` : ""}.`
    );
}

if (require.main === module) main();

module.exports = { levenshtein, findSimilar };
