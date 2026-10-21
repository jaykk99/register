#!/usr/bin/env node
// Interactive wizard that generates a new, validator-clean domain file.
//
//   node scripts/scaffold.js
//
// Walks through subdomain name, owner, and records, validates every answer
// with util/validator.js as you go, and writes domains/<name>.json only when
// the result passes the full validateDomainFile check. Refuses to overwrite
// an existing file.
//
// Non-interactive use (for scripting):
//   node scripts/scaffold.js --name mysite --username octocat \
//     --email octo@example.com --cname octocat.github.io [--proxied]
"use strict";

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const {
    validateFileName,
    validateOwner,
    validateRecordValues,
    validateDomainFile
} = require("../util/validator");

const DOMAINS_DIR = path.resolve(__dirname, "..", "domains");

const RECORD_CHOICES = [
    { key: "CNAME", hint: "hostname, e.g. octocat.github.io", multi: false },
    { key: "A", hint: "public IPv4, e.g. 192.0.2.1", multi: true },
    { key: "AAAA", hint: "public IPv6", multi: true },
    { key: "URL", hint: "https://example.com redirect target", multi: false },
    { key: "TXT", hint: "text value", multi: true },
    { key: "MX", hint: "mail server hostname", multi: true },
    { key: "NS", hint: "nameserver hostname", multi: true }
];

function ask(rl, question, fallback) {
    return new Promise((resolve) => {
        const suffix = fallback !== undefined ? ` [${fallback}]` : "";
        rl.question(`${question}${suffix}: `, (answer) => {
            const trimmed = answer.trim();
            resolve(trimmed === "" && fallback !== undefined ? fallback : trimmed);
        });
    });
}

function checkFatal(errors, what) {
    if (errors.length) {
        console.error(`\n${what} is not valid:`);
        errors.forEach((e) => console.error(`  - ${e}`));
        return true;
    }
    return false;
}

// Pure builder: returns { file, data }. Throws an Error listing problems.
function buildDomainFile({ subdomain, username, email, records, proxied }) {
    const problems = [];

    problems.push(
        ...validateFileName(`${subdomain}.json`).map((e) => `file name: ${e}`)
    );
    problems.push(...validateOwner({ username, ...(email ? { email } : {}) }));
    problems.push(...validateRecordValues(subdomain, records, proxied));

    const data = {
        owner: { username, ...(email ? { email } : {}) },
        records,
        ...(proxied ? { proxied: true } : {})
    };
    problems.push(...validateDomainFile(`${subdomain}.json`, data));

    // De-dupe identical messages that surface from both layers.
    const unique = [...new Set(problems)];
    if (unique.length) throw new Error(unique.join("\n"));

    return { file: `${subdomain}.json`, data };
}

function parseCliArgs(args) {
    const out = { records: {}, cli: false };
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        const next = () => args[++i];
        if (a === "--name") {
            out.subdomain = next().toLowerCase();
            out.cli = true;
        } else if (a === "--username") {
            out.username = next();
            out.cli = true;
        } else if (a === "--email") {
            out.email = next();
            out.cli = true;
        } else if (a === "--proxied") {
            out.proxied = true;
            out.cli = true;
        } else if (a === "--cname" || a === "--url") {
            out.records[a.slice(2).toUpperCase()] = next();
            out.cli = true;
        } else if (a === "--a" || a === "--aaaa" || a === "--txt" || a === "--mx" || a === "--ns") {
            const key = a.slice(2).toUpperCase();
            out.records[key] = (out.records[key] || []).concat(next().split(",").map((s) => s.trim()).filter(Boolean));
            out.cli = true;
        } else if (a === "-h" || a === "--help") {
            console.log(`Usage:
  node scripts/scaffold.js                                   # interactive wizard
  node scripts/scaffold.js --name <sub> --username <gh-user> [--email <addr>]
      [--cname <host> | --url <https-url> | --a <ip,...> | --aaaa <ip,...> |
       --txt <text,...> | --mx <host,...> | --ns <host,...>] [--proxied]

Writes domains/<sub>.json after validating it with the registry rules.
Refuses to overwrite an existing file.`);
            process.exit(0);
        } else {
            console.error(`Unknown argument: ${a}`);
            process.exit(1);
        }
    }
    return out;
}

async function promptRecordValues(rl, subdomain, proxied) {
    const records = {};
    console.log("\nPick a record type for your domain:");
    RECORD_CHOICES.forEach((c, i) => console.log(`  ${i + 1}) ${c.key} — ${c.hint}`));

    for (;;) {
        const choice = await ask(rl, "Record type (number, empty when done)", "");
        if (choice === "") break;
        const picked = RECORD_CHOICES[parseInt(choice, 10) - 1];
        if (!picked) {
            console.log("  Pick a number from the list.");
            continue;
        }
        const values = [];
        for (;;) {
            const v = await ask(rl, `  ${picked.key} value (${picked.hint})`, "");
            if (v === "") break;
            values.push(v);
            if (!picked.multi) break;
            const more = await ask(rl, "  Add another value? (y/N)", "n");
            if (more.toLowerCase() !== "y") break;
        }
        if (values.length === 0) {
            console.log("  No values entered, skipping.");
            continue;
        }
        records[picked.key] = picked.multi ? values : values[0];

        const errors = validateRecordValues(subdomain, records, proxied);
        if (checkFatal(errors, `${picked.key} record`)) {
            delete records[picked.key];
            continue;
        }
        const more = await ask(rl, "Add another record type? (y/N)", "n");
        if (more.toLowerCase() !== "y") break;
    }
    return records;
}

async function interactive() {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    console.log("is-a.dev domain file wizard — answers are validated as you go.\n");

    let subdomain;
    for (;;) {
        subdomain = (await ask(rl, "Subdomain (e.g. mysite for mysite.is-a.dev)")).toLowerCase();
        if (checkFatal(validateFileName(`${subdomain}.json`), "Subdomain")) continue;
        if (fs.existsSync(path.join(DOMAINS_DIR, `${subdomain}.json`))) {
            console.log(`\ndomains/${subdomain}.json already exists — pick another name.`);
            continue;
        }
        break;
    }

    let username;
    let email = "";
    for (;;) {
        username = await ask(rl, "GitHub username");
        email = await ask(rl, "Contact email (optional)", "");
        if (checkFatal(validateOwner({ username, ...(email ? { email } : {}) }), "Owner")) continue;
        break;
    }

    const proxiedAnswer = await ask(rl, "Proxy through Cloudflare? (y/N)", "n");
    const proxied = proxiedAnswer.toLowerCase() === "y";

    const records = await promptRecordValues(rl, subdomain, proxied);
    rl.close();

    if (Object.keys(records).length === 0) {
        console.error("\nNo records entered — nothing to write.");
        process.exit(1);
    }

    writeFile(subdomain, { subdomain, username, email, records, proxied });
}

function writeFile(subdomain, answers) {
    const target = path.join(DOMAINS_DIR, `${subdomain}.json`);
    if (fs.existsSync(target)) {
        console.error(`\nRefusing to overwrite existing ${target}.`);
        process.exit(1);
    }

    let built;
    try {
        built = buildDomainFile(answers);
    } catch (err) {
        console.error("\nGenerated file failed validation:");
        err.message.split("\n").forEach((e) => console.error(`  - ${e}`));
        process.exit(1);
    }

    fs.writeFileSync(target, JSON.stringify(built.data, null, 2) + "\n");
    console.log(`\nWrote ${target} — valid. Open a PR to register it.`);
}

function main() {
    const cli = parseCliArgs(process.argv.slice(2));
    if (!cli.cli) {
        interactive().catch((err) => {
            console.error(err.message);
            process.exit(1);
        });
        return;
    }
    if (!cli.subdomain || !cli.username) {
        console.error("--name and --username are required in non-interactive mode. See --help.");
        process.exit(1);
    }
    if (Object.keys(cli.records).length === 0) {
        console.error("At least one record (--cname, --url, --a, ...) is required. See --help.");
        process.exit(1);
    }
    writeFile(cli.subdomain, {
        subdomain: cli.subdomain,
        username: cli.username,
        email: cli.email || "",
        records: cli.records,
        proxied: cli.proxied === true
    });
}

if (require.main === module) main();

module.exports = { buildDomainFile, parseCliArgs };
