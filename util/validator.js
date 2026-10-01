// Shared validation logic for is-a.dev domain registration files.
// Pure functions returning arrays of human-readable error strings.
// Used by scripts/validate.js (contributor CLI) and mirrored by tests/json.test.js
// and tests/records.test.js (which assert the same rules across all files).
"use strict";

const path = require("path");

const GITHUB_USERNAME_REGEX = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/;
const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const HOSTNAME_REGEX =
    /^(?=.{1,253}$)(?:(?:[_a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)\.)+[a-zA-Z]{2,63}$/;
const IPV4_REGEX =
    /^(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])(\.(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])){3}$/;
const IPV6_REGEX =
    /^(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$|^::(?:[0-9a-fA-F]{1,4}:){0,6}[0-9a-fA-F]{1,4}$|^(?:[0-9a-fA-F]{1,4}:){1,7}:$|^(?:[0-9a-fA-F]{1,4}:){0,6}::(?:[0-9a-fA-F]{1,4}:){0,5}[0-9a-fA-F]{1,4}$/;
const HEX_REGEX = /^[0-9a-fA-F]+$/;
const CUSTOM_PATH_REGEX = /^\/[a-zA-Z0-9\-_./]+(?<!\/)$/;

const VALID_RECORD_TYPES = new Set([
    "A",
    "AAAA",
    "CAA",
    "CNAME",
    "DS",
    "MX",
    "NS",
    "SRV",
    "TLSA",
    "TXT",
    "URL"
]);

const REQUIRED_FIELDS = ["owner", "records"];
const OPTIONAL_FIELDS = ["proxied", "redirect_config"];
const REQUIRED_OWNER_FIELDS = ["username"];
const OPTIONAL_OWNER_FIELDS = ["email"];
const BLOCKED_FIELDS = ["domain", "internal", "proxy", "reserved", "services", "subdomain", "nested", "record"];

const ARRAY_RECORD_TYPES = ["A", "AAAA", "MX", "NS", "CAA", "DS", "SRV", "TLSA"];

function loadJson(relPath) {
    return require(path.join(__dirname, relPath));
}

let _reserved = null;
let _internal = null;
let _disallowedCnames = null;
function reservedDomains() {
    if (!_reserved) _reserved = loadJson("reserved.json");
    return _reserved;
}
function internalDomains() {
    if (!_internal) _internal = loadJson("internal.json");
    return _internal;
}
function disallowedCNAMEs() {
    if (!_disallowedCnames) _disallowedCnames = loadJson("disallowed-cnames.json");
    return _disallowedCnames;
}

function expandIPv6(ip) {
    let segments = ip.split(":");
    const emptyIndex = segments.indexOf("");

    if (emptyIndex !== -1) {
        const nonEmptySegments = segments.filter((seg) => seg !== "");
        const missingSegments = 8 - nonEmptySegments.length;

        segments = [
            ...nonEmptySegments.slice(0, emptyIndex),
            ...Array(missingSegments).fill("0000"),
            ...nonEmptySegments.slice(emptyIndex)
        ];
    }

    return segments.map((segment) => segment.padStart(4, "0")).join(":");
}

function isPublicIPv4(ip, proxied) {
    const parts = ip.split(".").map(Number);
    if (parts.length !== 4 || parts.some((part) => isNaN(part) || part < 0 || part > 255)) return false;
    if (ip === "192.0.2.1" && proxied) return true;

    return !(
        parts[0] === 10 ||
        (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
        (parts[0] === 192 && parts[1] === 168) ||
        (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) ||
        (parts[0] === 169 && parts[1] === 254) ||
        (parts[0] === 192 && parts[1] === 0 && parts[2] === 0) ||
        (parts[0] === 192 && parts[1] === 0 && parts[2] === 2) ||
        (parts[0] === 198 && parts[1] === 18) ||
        (parts[0] === 198 && parts[1] === 51 && parts[2] === 100) ||
        (parts[0] === 203 && parts[1] === 0 && parts[2] === 113) ||
        parts[0] >= 224
    );
}

function isPublicIPv6(ip) {
    const lower = ip.toLowerCase();
    return !(
        lower.startsWith("fc") ||
        lower.startsWith("fd") ||
        lower.startsWith("fe80") ||
        lower.startsWith("::1") ||
        lower.startsWith("2001:db8")
    );
}

// Detect duplicate keys in raw JSON text (JSON.parse silently keeps the last one).
function findDuplicateKeys(jsonString) {
    const duplicateKeys = new Set();
    const keyStack = [];
    const keyRegex = /"((?:[^"\\]|\\.)*)"\s*:/g;
    let i = 0;

    while (i < jsonString.length) {
        const char = jsonString[i];

        if (char === "{") {
            keyStack.push({});
            i++;
            continue;
        }

        if (char === "}") {
            keyStack.pop();
            i++;
            continue;
        }

        keyRegex.lastIndex = i;
        const match = keyRegex.exec(jsonString);
        if (match && match.index === i && keyStack.length > 0) {
            const key = match[1];
            const currentScope = keyStack[keyStack.length - 1];

            if (currentScope[key]) {
                duplicateKeys.add(key);
            } else {
                currentScope[key] = true;
            }

            i = keyRegex.lastIndex;
        } else {
            i++;
        }
    }

    return [...duplicateKeys];
}

function validateFileName(file) {
    const errors = [];
    const subdomain = file.replace(/\.json$/, "");

    if (!file.endsWith(".json")) errors.push("File does not have .json extension");
    if (file.includes(".is-a.dev")) errors.push("File name should not contain .is-a.dev");
    if (file !== file.toLowerCase()) errors.push("File name should be all lowercase");
    if (file.includes("--")) errors.push("File name should not contain consecutive hyphens");
    if (!HOSTNAME_REGEX.test(`${subdomain}.is-a.dev`))
        errors.push("FQDN must be 1-253 characters, letters/numbers/dots/non-consecutive hyphens");

    const reserved = reservedDomains();
    const internal = internalDomains();
    if (internal.includes(subdomain)) errors.push("Subdomain name is registered internally");
    if (reserved.includes(subdomain)) errors.push("Subdomain name is reserved");
    if (internal.some((d) => subdomain.endsWith(`.${d}`)))
        errors.push("Subdomain name is registered internally");
    if (reserved.some((r) => subdomain.endsWith(`.${r}`)))
        errors.push("Subdomain name is reserved");

    const rootSubdomain = subdomain.split(".").pop();
    if (rootSubdomain.startsWith("_")) errors.push("Root subdomains should not start with an underscore");

    return errors;
}

function validateOwner(owner) {
    const errors = [];

    if (!owner || typeof owner !== "object" || Array.isArray(owner)) {
        return ["owner must be an object"];
    }

    for (const field of REQUIRED_OWNER_FIELDS) {
        if (!owner.hasOwnProperty(field)) errors.push(`Missing required field: owner.${field}`);
    }

    if (owner.hasOwnProperty("username")) {
        if (typeof owner.username !== "string") {
            errors.push("owner.username should be a string");
        } else if (!GITHUB_USERNAME_REGEX.test(owner.username)) {
            errors.push(
                `owner.username "${owner.username}" must be a valid GitHub username ` +
                    "(alphanumeric and hyphens, max 39 chars)"
            );
        }
    }

    if (owner.hasOwnProperty("email")) {
        if (typeof owner.email !== "string" || owner.email.length === 0) {
            errors.push("owner.email must not be empty (omit the field instead)");
        } else {
            if (!EMAIL_REGEX.test(owner.email)) errors.push(`owner.email "${owner.email}" is not a valid email address`);
            if (owner.email.endsWith("@users.noreply.github.com"))
                errors.push("owner.email should not be a GitHub no-reply email");
        }
    }

    for (const field of OPTIONAL_OWNER_FIELDS) {
        if (owner.hasOwnProperty(field) && typeof owner[field] !== "string")
            errors.push(`owner.${field} should be a string`);
    }

    return errors;
}

function validateRecordValues(subdomain, records, proxied) {
    const errors = [];

    for (const [key, value] of Object.entries(records)) {
        if (!VALID_RECORD_TYPES.has(key)) {
            errors.push(`Invalid record type: ${key}`);
            continue;
        }

        if (ARRAY_RECORD_TYPES.includes(key)) {
            if (!Array.isArray(value)) {
                errors.push(`${key} record value should be an array`);
                continue;
            }
            if (value.length === 0) {
                errors.push(`${key} record array must not be empty`);
                continue;
            }

            const seen = new Set();
            value.forEach((record, idx) => {
                const label = `${key}[${idx}]`;
                const fingerprint = typeof record === "string" ? record : JSON.stringify(record);
                if (seen.has(fingerprint)) errors.push(`Duplicate value in ${label}`);
                seen.add(fingerprint);

                if (key === "A") {
                    if (!IPV4_REGEX.test(record)) errors.push(`${label}: invalid IPv4 address "${record}"`);
                    else if (!isPublicIPv4(record, proxied))
                        errors.push(`${label}: IPv4 address "${record}" is not a public address`);
                } else if (key === "AAAA") {
                    const expanded = expandIPv6(record);
                    if (!IPV6_REGEX.test(expanded)) errors.push(`${label}: invalid IPv6 address "${record}"`);
                    else if (!isPublicIPv6(expanded))
                        errors.push(`${label}: IPv6 address "${record}" is not a public address`);
                } else if (key === "MX") {
                    if (typeof record === "string") {
                        if (!HOSTNAME_REGEX.test(record)) errors.push(`${label}: invalid hostname "${record}"`);
                    } else if (record && typeof record === "object") {
                        if (!HOSTNAME_REGEX.test(record.target || ""))
                            errors.push(`${label}: invalid MX target "${record.target}"`);
                        if (!Number.isInteger(record.priority) || record.priority < 0 || record.priority > 65535)
                            errors.push(`${label}: MX priority must be an integer 0-65535`);
                    } else {
                        errors.push(`${label}: MX record should be a string or an object`);
                    }
                } else if (key === "NS") {
                    if (!HOSTNAME_REGEX.test(record)) errors.push(`${label}: invalid hostname "${record}"`);
                } else if (key === "CAA") {
                    if (!record || typeof record !== "object") {
                        errors.push(`${label}: CAA record should be an object`);
                    } else {
                        if (!["issue", "issuewild", "iodef"].includes(record.tag))
                            errors.push(`${label}: invalid CAA tag "${record.tag}"`);
                        if (typeof record.value !== "string")
                            errors.push(`${label}: CAA value should be a string`);
                        else if (!HOSTNAME_REGEX.test(record.value) && record.value !== ";")
                            errors.push(`${label}: CAA value must be a hostname or ";"`);
                    }
                } else if (key === "DS") {
                    if (!record || typeof record !== "object") {
                        errors.push(`${label}: DS record should be an object`);
                    } else {
                        if (!Number.isInteger(record.key_tag) || record.key_tag < 0 || record.key_tag > 65535)
                            errors.push(`${label}: DS key_tag must be an integer 0-65535`);
                        if (!Number.isInteger(record.algorithm) || record.algorithm < 0 || record.algorithm > 255)
                            errors.push(`${label}: DS algorithm must be an integer 0-255`);
                        if (!Number.isInteger(record.digest_type) || record.digest_type < 0 || record.digest_type > 255)
                            errors.push(`${label}: DS digest_type must be an integer 0-255`);
                        if (typeof record.digest !== "string" || !HEX_REGEX.test(record.digest))
                            errors.push(`${label}: DS digest must be hexadecimal`);
                    }
                } else if (key === "SRV") {
                    if (!record || typeof record !== "object") {
                        errors.push(`${label}: SRV record should be an object`);
                    } else {
                        for (const f of ["priority", "weight", "port"]) {
                            if (!Number.isInteger(record[f]) || record[f] < 0 || record[f] > 65535)
                                errors.push(`${label}: SRV ${f} must be an integer 0-65535`);
                        }
                        if (!HOSTNAME_REGEX.test(record.target || ""))
                            errors.push(`${label}: invalid SRV target "${record.target}"`);
                    }
                } else if (key === "TLSA") {
                    if (!record || typeof record !== "object") {
                        errors.push(`${label}: TLSA record should be an object`);
                    } else {
                        for (const f of ["usage", "selector", "matching_type"]) {
                            if (!Number.isInteger(record[f]) || record[f] < 0 || record[f] > 255)
                                errors.push(`${label}: TLSA ${f} must be an integer 0-255`);
                        }
                        if (typeof record.certificate !== "string" || !HEX_REGEX.test(record.certificate))
                            errors.push(`${label}: TLSA certificate must be hexadecimal`);
                    }
                }
            });
        }

        if (key === "CNAME" || key === "URL") {
            if (typeof value !== "string") {
                errors.push(`${key} record value should be a string`);
                continue;
            }
            if (value.length === 0) {
                errors.push(`${key} record value must not be empty`);
                continue;
            }

            if (key === "CNAME") {
                if (!HOSTNAME_REGEX.test(value)) errors.push(`CNAME: invalid hostname "${value}"`);
                if (value === `${subdomain}.is-a.dev`) errors.push("CNAME cannot point to itself");
                if (value === "is-a.dev") errors.push("CNAME cannot point to is-a.dev");
                for (const disallowed of disallowedCNAMEs()) {
                    if (disallowed.startsWith(".")) {
                        if (value.endsWith(disallowed))
                            errors.push(`CNAME cannot end with disallowed suffix "${disallowed}"`);
                    } else if (value === disallowed) {
                        errors.push(`CNAME cannot be "${disallowed}"`);
                    }
                }
            } else {
                if (!value.startsWith("http://") && !value.startsWith("https://"))
                    errors.push('URL record must start with http:// or https://');
                try {
                    const host = new URL(value).host;
                    if (host === `${subdomain}.is-a.dev`) errors.push("URL cannot point to itself");
                } catch {
                    errors.push(`URL record is not a valid URL: "${value}"`);
                }
            }
        }

        if (key === "TXT") {
            const values = Array.isArray(value) ? value : [value];
            if (values.length === 0) {
                errors.push("TXT record array must not be empty");
            }
            values.forEach((record, idx) => {
                if (typeof record !== "string") errors.push(`TXT[${idx}]: value should be a string`);
                else if (record !== record.trim())
                    errors.push(`TXT[${idx}]: value has leading/trailing whitespace`);
            });
        }
    }

    // Record type combination rules
    const recordKeys = Object.keys(records);
    if (recordKeys.includes("CNAME")) {
        if (!proxied && recordKeys.length !== 1)
            errors.push("CNAME records cannot be combined with other records unless proxied");
        if (proxied && (recordKeys.includes("A") || recordKeys.includes("AAAA")))
            errors.push("CNAME records cannot be combined with A or AAAA records");
    }
    if (recordKeys.includes("NS")) {
        if (!(recordKeys.length === 1 || (recordKeys.length === 2 && recordKeys.includes("DS"))))
            errors.push("NS records cannot be combined with other records, except for DS records");
    }
    if (recordKeys.includes("DS") && !recordKeys.includes("NS"))
        errors.push("DS records must be combined with NS records");
    if (recordKeys.includes("URL")) {
        if (recordKeys.includes("A") || recordKeys.includes("AAAA") || recordKeys.includes("CNAME"))
            errors.push("URL records cannot be combined with A, AAAA, or CNAME records");
    }

    return errors;
}

function validateRedirectConfig(subdomain, data) {
    const errors = [];
    const config = data.redirect_config;
    const recordKeys = Object.keys(data.records || {});

    if (!recordKeys.includes("URL") && !data.proxied)
        errors.push("redirect_config requires a URL record or proxied domain");
    if (config.redirect_paths && !recordKeys.includes("URL"))
        errors.push("redirect_config.redirect_paths requires a URL record");

    const customPaths = Object.keys(config.custom_paths || {});
    customPaths.forEach((customPath, idx) => {
        const target = config.custom_paths[customPath];
        if (!CUSTOM_PATH_REGEX.test(customPath))
            errors.push(
                `redirect_config custom path "${customPath}" must start with /, use only ` +
                    "alphanumerics/hyphens/underscores/periods/slashes, and not end with /"
            );
        if (customPath.length < 2 || customPath.length > 255)
            errors.push(`redirect_config custom path "${customPath}" should be 2-255 characters long`);
        if (data.records && data.records.URL === target)
            errors.push(`redirect_config custom path "${customPath}" must differ from the URL record`);
        if (typeof target !== "string" || (!target.startsWith("http://") && !target.startsWith("https://")))
            errors.push(`redirect_config custom path "${customPath}" must redirect to http(s)://`);
        else {
            try {
                const host = new URL(target).host;
                if (host === `${subdomain}.is-a.dev`)
                    errors.push(`redirect_config custom path "${customPath}" cannot point to itself`);
            } catch {
                errors.push(`redirect_config custom path "${customPath}" has an invalid URL`);
            }
        }
    });

    return errors;
}

// Validate a fully parsed domain file. `file` is the file name (e.g. "example.json").
function validateDomainFile(file, data) {
    const errors = [];
    const subdomain = file.replace(/\.json$/, "");

    if (!data || typeof data !== "object" || Array.isArray(data)) {
        return ["File must contain a JSON object"];
    }

    for (const field of REQUIRED_FIELDS) {
        if (!data.hasOwnProperty(field)) errors.push(`Missing required field: ${field}`);
    }
    if (typeof data.proxied !== "undefined" && typeof data.proxied !== "boolean")
        errors.push("proxied should be a boolean");
    if (typeof data.redirect_config !== "undefined" && (typeof data.redirect_config !== "object" || data.redirect_config === null))
        errors.push("redirect_config should be an object");

    for (const field of BLOCKED_FIELDS) {
        if (data.hasOwnProperty(field)) errors.push(`Disallowed field: ${field}`);
    }

    errors.push(...validateFileName(file).map((e) => `File name: ${e}`));

    if (data.hasOwnProperty("owner")) errors.push(...validateOwner(data.owner));

    if (data.hasOwnProperty("records")) {
        if (!data.records || typeof data.records !== "object" || Array.isArray(data.records)) {
            errors.push("records must be an object");
        } else {
            if (Object.keys(data.records).length === 0) errors.push("Missing DNS records");
            errors.push(...validateRecordValues(subdomain, data.records, data.proxied));
            const usable = ["A", "AAAA", "CNAME", "MX", "NS", "URL"];
            const isRoot = !subdomain.includes(".") && !subdomain.startsWith("_");
            if (isRoot && !usable.some((r) => data.records.hasOwnProperty(r)))
                errors.push("Root subdomains must have at least one A, AAAA, CNAME, MX, NS, or URL record");
        }
    }

    if (data.redirect_config) errors.push(...validateRedirectConfig(subdomain, data));

    return errors;
}

module.exports = {
    GITHUB_USERNAME_REGEX,
    EMAIL_REGEX,
    HOSTNAME_REGEX,
    IPV4_REGEX,
    IPV6_REGEX,
    VALID_RECORD_TYPES,
    findDuplicateKeys,
    validateFileName,
    validateOwner,
    validateRecordValues,
    validateRedirectConfig,
    validateDomainFile
};
