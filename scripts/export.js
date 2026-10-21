#!/usr/bin/env node
// Export a compact machine-readable index of the registry, or print aggregate stats.
//
//   node scripts/export.js --format json --out registry-index.json
//   node scripts/export.js --format csv --out registry-index.csv
//   node scripts/export.js --format ndjson --out registry-index.ndjson
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
            proxied: data.proxied === true ? "yes" : "no",
            redirect:
                typeof data.redirect_config === "object" && data.redirect_config !== null
                    ? "yes"
                    : "no"
        });
    }
    return rows.sort((a, b) => a.subdomain.localeCompare(b.subdomain));
}

function toCsv(rows) {
    const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;
    const header = ["subdomain", "owner", "email", "record_types", "targets", "proxied", "redirect"];
    return [header.join(","), ...rows.map((r) => header.map((h) => esc(r[h])).join(","))].join("\n") + "\n";
}

function toNdjson(rows) {
    return rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
}

// Last two labels of a hostname, e.g. "user.github.io" -> "github.io".
// Used to see which hosting providers the registry points at.
// IP literals are grouped under "(ip)" instead of a meaningless octet pair.
function hostSuffix(host) {
    let h = String(host || "").toLowerCase().trim();
    h = h.replace(/^[a-z][a-z0-9+.-]*:\/\//, ""); // strip scheme
    h = h.split(/[\/?#]/)[0]; // strip path/query/fragment
    if (h.startsWith("[")) return "(ip)"; // [ipv6] literal
    if ((h.match(/:/g) || []).length > 1) return "(ip)"; // unbracketed IPv6 literal
    const withoutPort = h.split(":")[0]; // strip :port
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(withoutPort)) return "(ip)";
    const clean = withoutPort.replace(/\.$/, "");
    if (!clean.includes(".")) return clean || "(none)";
    return clean.split(".").slice(-2).join(".");
}

function targetHosts(targets) {
    return targets
        .split(" | ")
        .map((t) => t.trim())
        .filter(Boolean)
        .map((t) => {
            if (/^https?:\/\//i.test(t)) {
                try {
                    return new URL(t).hostname;
                } catch {
                    return t;
                }
            }
            return t.split(" ")[0];
        });
}

function topEntries(counts, n) {
    return Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, n);
}

function printStats(rows) {
    const typeCounts = {};
    const ownerCounts = {};
    const targetCounts = {};
    const suffixCounts = {};
    const emailDomainCounts = {};
    let proxied = 0;
    let nested = 0;
    let withRedirect = 0;

    for (const r of rows) {
        for (const t of r.record_types.split(",").filter(Boolean))
            typeCounts[t] = (typeCounts[t] || 0) + 1;
        if (r.owner) ownerCounts[r.owner] = (ownerCounts[r.owner] || 0) + 1;
        if (r.proxied === "yes") proxied++;
        if (r.subdomain.split(".").length > 3) nested++;
        if (r.redirect === "yes") withRedirect++;
        for (const host of targetHosts(r.targets)) {
            targetCounts[host] = (targetCounts[host] || 0) + 1;
            const suffix = hostSuffix(host);
            suffixCounts[suffix] = (suffixCounts[suffix] || 0) + 1;
        }
        const emailDomain = (r.email.split("@")[1] || "").toLowerCase();
        if (emailDomain) emailDomainCounts[emailDomain] = (emailDomainCounts[emailDomain] || 0) + 1;
    }

    console.log(`Domains: ${rows.length}`);
    console.log(`Proxied: ${proxied} (${((proxied / rows.length) * 100).toFixed(1)}%)`);
    console.log(`Nested (a.b.is-a.dev): ${nested}`);
    console.log(`With redirect_config: ${withRedirect}`);
    console.log("\nRecord types:");
    topEntries(typeCounts, 20).forEach(([t, n]) => console.log(`  ${t.padEnd(6)} ${n}`));

    const multi = Object.entries(ownerCounts).filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]);
    console.log(`\nOwners with more than one domain: ${multi.length}`);
    multi.slice(0, 10).forEach(([u, n]) => console.log(`  @${u}: ${n}`));

    console.log("\nTop target hosts:");
    topEntries(targetCounts, 10).forEach(([h, n]) => console.log(`  ${h}: ${n}`));

    console.log("\nTop target host suffixes (hosting providers):");
    topEntries(suffixCounts, 10).forEach(([s, n]) => console.log(`  ${s}: ${n}`));

    console.log("\nTop owner email domains:");
    topEntries(emailDomainCounts, 10).forEach(([d, n]) => console.log(`  ${d}: ${n}`));
}

function main() {
    const args = process.argv.slice(2);
    if (args.includes("-h") || args.includes("--help")) {
        console.log(`Usage:
  node scripts/export.js --format json|csv|ndjson --out <file>
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
    if (!["json", "csv", "ndjson"].includes(fmt)) {
        console.error(`Unknown format: ${fmt}`);
        process.exit(1);
    }

    const body =
        fmt === "json"
            ? JSON.stringify(rows, null, 2) + "\n"
            : fmt === "csv"
              ? toCsv(rows)
              : toNdjson(rows);
    fs.writeFileSync(out, body);
    console.log(`Wrote ${rows.length} domains to ${out} (${fmt}).`);
}

if (require.main === module) main();

module.exports = { buildRows, toCsv, toNdjson, hostSuffix, targetHosts };
