#!/usr/bin/env node
// Export a compact machine-readable index of the registry, or print aggregate stats.
//
//   node scripts/export.js --format json --out registry-index.json
//   node scripts/export.js --format csv --out registry-index.csv
//   node scripts/export.js --stats
"use strict";

const fs = require("fs");
const path = require("path");
const { flattenTargets } = require("./query");

const DOMAINS_DIR = path.resolve(__dirname, "..", "domains");

function buildRows() {
    const files = fs.readdirSync(DOMAINS_DIR).filter((f) => f.endsWith(".json"));
    const rows = [];
    for (const file of files) {
        const subdomain = file.replace(/\.json$/, "");
        let data;
        try {
            data = JSON.parse(fs.readFileSync(path.join(DOMAINS_DIR, file), "utf8"));
        } catch {
            continue;
        }
        const records = data.records && typeof data.records === "object" ? data.records : {};
        rows.push({
            subdomain: `${subdomain}.is-a.dev`,
            owner: (data.owner && data.owner.username) || "",
            email: (data.owner && data.owner.email) || "",
            record_types: Object.keys(records).join(","),
            targets: flattenTargets(records).join(" | "),
            proxied: data.proxied === true ? "yes" : "no"
        });
    }
    return rows.sort((a, b) => a.subdomain.localeCompare(b.subdomain));
}

function toCsv(rows) {
    const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;
    const header = ["subdomain", "owner", "email", "record_types", "targets", "proxied"];
    return [header.join(","), ...rows.map((r) => header.map((h) => esc(r[h])).join(","))].join("\n") + "\n";
}

function printStats(rows) {
    const typeCounts = {};
    const ownerCounts = {};
    let proxied = 0;

    for (const r of rows) {
        for (const t of r.record_types.split(",").filter(Boolean))
            typeCounts[t] = (typeCounts[t] || 0) + 1;
        if (r.owner) ownerCounts[r.owner] = (ownerCounts[r.owner] || 0) + 1;
        if (r.proxied === "yes") proxied++;
    }

    console.log(`Domains: ${rows.length}`);
    console.log(`Proxied: ${proxied} (${((proxied / rows.length) * 100).toFixed(1)}%)`);
    console.log("\nRecord types:");
    Object.entries(typeCounts)
        .sort((a, b) => b[1] - a[1])
        .forEach(([t, n]) => console.log(`  ${t.padEnd(6)} ${n}`));

    const multi = Object.entries(ownerCounts).filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]);
    console.log(`\nOwners with more than one domain: ${multi.length}`);
    multi.slice(0, 10).forEach(([u, n]) => console.log(`  @${u}: ${n}`));
}

function main() {
    const args = process.argv.slice(2);
    if (args.includes("-h") || args.includes("--help")) {
        console.log(`Usage:
  node scripts/export.js --format json|csv --out <file>
  node scripts/export.js --stats`);
        process.exit(0);
    }

    const rows = buildRows();

    if (args.includes("--stats")) {
        printStats(rows);
        return;
    }

    const fmt = (args[args.indexOf("--format") + 1] || "json").toLowerCase();
    const out = args[args.indexOf("--out") + 1];

    if (!out) {
        console.error("--out <file> is required (or use --stats).");
        process.exit(1);
    }
    if (!["json", "csv"].includes(fmt)) {
        console.error(`Unknown format: ${fmt}`);
        process.exit(1);
    }

    fs.writeFileSync(out, fmt === "json" ? JSON.stringify(rows, null, 2) + "\n" : toCsv(rows));
    console.log(`Wrote ${rows.length} domains to ${out} (${fmt}).`);
}

if (require.main === module) main();

module.exports = { buildRows, toCsv };
