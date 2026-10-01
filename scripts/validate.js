#!/usr/bin/env node
// Validate one or more domain files with contributor-friendly output.
//
//   node scripts/validate.js domains/example.json
//   node scripts/validate.js domains/a.json domains/b.json
//   node scripts/validate.js --all            # validate every file in domains/
//   node scripts/validate.js --changed        # validate files changed vs origin/main
//
// Exit code is 0 when everything is valid, 1 otherwise.
"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { findDuplicateKeys, validateDomainFile } = require("../util/validator");

const DOMAINS_DIR = path.resolve(__dirname, "..", "domains");

function listAll() {
    return fs
        .readdirSync(DOMAINS_DIR)
        .filter((f) => f.endsWith(".json"))
        .sort();
}

function listChanged() {
    try {
        const out = execSync("git diff --name-only origin/main -- domains/ && git diff --name-only --cached -- domains/", {
            cwd: path.resolve(__dirname, ".."),
            encoding: "utf8"
        });
        return [...new Set(out.split("\n").map((l) => l.trim()).filter(Boolean))]
            .map((p) => path.basename(p))
            .filter((f) => f.endsWith(".json"));
    } catch {
        console.error("Could not determine changed files (no origin/main?). Falling back to --all.");
        return listAll();
    }
}

function validateFile(file) {
    const filePath = path.join(DOMAINS_DIR, file);
    const errors = [];

    let raw;
    try {
        raw = fs.readFileSync(filePath, "utf8");
    } catch (err) {
        return [`Cannot read file: ${err.message}`];
    }

    let data;
    try {
        data = JSON.parse(raw);
    } catch (err) {
        return [`Invalid JSON: ${err.message}`];
    }

    const dupes = findDuplicateKeys(raw);
    if (dupes.length) errors.push(`Duplicate keys found: ${dupes.join(", ")}`);

    errors.push(...validateDomainFile(file, data));
    return errors;
}

function main() {
    const args = process.argv.slice(2);

    if (args.length === 0 || args.includes("-h") || args.includes("--help")) {
        console.log(`Usage:
  node scripts/validate.js <file...>   Validate specific domain files
  node scripts/validate.js --all       Validate every file in domains/
  node scripts/validate.js --changed   Validate files changed vs origin/main

Examples:
  node scripts/validate.js domains/example.json
  node scripts/validate.js --changed`);
        process.exit(args.length === 0 ? 1 : 0);
    }

    let files;
    if (args.includes("--all")) files = listAll();
    else if (args.includes("--changed")) files = listChanged();
    else
        files = args.map((a) =>
            a.endsWith(".json") ? path.basename(a) : `${path.basename(a)}.json`
        );

    if (files.length === 0) {
        console.log("No domain files to validate.");
        process.exit(0);
    }

    let failed = 0;
    const showAll = files.length <= 20;

    for (const file of files) {
        const errors = validateFile(file);
        if (errors.length) {
            failed++;
            console.log(`\n✖ ${file}`);
            errors.forEach((e) => console.log(`    - ${e}`));
        } else if (showAll) {
            console.log(`✔ ${file}`);
        }
    }

    const ok = files.length - failed;
    console.log(`\n${ok}/${files.length} file(s) valid${failed ? `, ${failed} failed` : ""}.`);
    process.exit(failed ? 1 : 0);
}

main();
