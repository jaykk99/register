const t = require("ava");
const {
    findDuplicateKeys,
    validateDomainFile,
    validateOwner,
    validateFileName
} = require("../util/validator");
const { matches } = require("../scripts/query");
const { toCsv } = require("../scripts/export");

const validDomain = {
    owner: { username: "octocat", email: "octo@example.com" },
    records: { CNAME: "octocat.github.io" }
};

t("validateDomainFile accepts a valid domain file", (t) => {
    t.deepEqual(validateDomainFile("my-site.json", validDomain), []);
});

t("validateDomainFile rejects missing required fields", (t) => {
    const errors = validateDomainFile("my-site.json", { owner: { username: "octocat" } });
    t.true(errors.some((e) => e.includes("Missing required field: records")));
});

t("validateDomainFile rejects invalid GitHub usernames", (t) => {
    for (const bad of ["Aryan Tavish", "not specified, refer to discord.", "Lakiś", "1k24bytes.github.io", ""]) {
        const errors = validateDomainFile("my-site.json", {
            owner: { username: bad },
            records: { CNAME: "octocat.github.io" }
        });
        t.true(errors.some((e) => e.includes("GitHub username")), `should reject username ${JSON.stringify(bad)}`);
    }
});

t("validateDomainFile rejects empty emails", (t) => {
    const errors = validateDomainFile("my-site.json", {
        owner: { username: "octocat", email: "" },
        records: { CNAME: "octocat.github.io" }
    });
    t.true(errors.some((e) => e.includes("must not be empty")));
});

t("validateDomainFile rejects malformed emails and noreply addresses", (t) => {
    for (const bad of ["not-an-email", "a@b", "octocat@users.noreply.github.com"]) {
        const errors = validateDomainFile("my-site.json", {
            owner: { username: "octocat", email: bad },
            records: { CNAME: "octocat.github.io" }
        });
        t.true(errors.length > 0, `should reject email ${JSON.stringify(bad)}`);
    }
});

t("validateDomainFile catches bad records", (t) => {
    const cases = [
        [{ A: ["999.1.1.1"] }, "invalid IPv4"],
        [{ A: ["10.0.0.1"] }, "not a public"],
        [{ CNAME: "not a hostname" }, "invalid hostname"],
        [{ CNAME: "my-site.is-a.dev" }, "cannot point to itself"],
        [{ URL: "ftp://example.com" }, "http:// or https://"],
        [{ TXT: ["has trailing space "] }, "whitespace"],
        [{ CNAME: "a.com", A: ["1.1.1.1"] }, "cannot be combined"],
        [{ NS: ["ns1.example.com"], A: ["1.1.1.1"] }, "NS records cannot be combined"],
        [{ DS: [{ key_tag: 1, algorithm: 8, digest_type: 2, digest: "abc123" }] }, "must be combined with NS"]
    ];
    for (const [records, expected] of cases) {
        const errors = validateDomainFile("my-site.json", {
            owner: { username: "octocat" },
            records
        });
        t.true(
            errors.some((e) => e.includes(expected)),
            `${JSON.stringify(records)} should fail with "${expected}", got: ${errors.join("; ")}`
        );
    }
});

t("validateDomainFile flags TXT with leading/trailing whitespace", (t) => {
    const errors = validateDomainFile("my-site.json", {
        owner: { username: "octocat" },
        records: { TXT: ["v=DKIM1; k=rsa; "] }
    });
    t.true(errors.some((e) => e.includes("whitespace")));
});

t("findDuplicateKeys detects repeated keys", (t) => {
    const dupes = findDuplicateKeys('{"a": 1, "b": {"a": 2}, "a": 3}');
    t.deepEqual(dupes, ["a"]);
    t.deepEqual(findDuplicateKeys('{"a": 1, "b": 2}'), []);
});

t("validateOwner requires username and accepts email-less owners", (t) => {
    t.true(validateOwner({}).some((e) => e.includes("owner.username")));
    t.deepEqual(validateOwner({ username: "octocat" }), []);
});

t("validateFileName enforces naming rules", (t) => {
    t.deepEqual(validateFileName("my-cool-site-123.json"), []);
    t.true(validateFileName("Example.json").some((e) => e.includes("lowercase")));
    t.true(validateFileName("a--b.json").some((e) => e.includes("consecutive hyphens")));
    t.true(validateFileName("api.json").some((e) => e.includes("reserved")));
});

t("query matches() filters entries", (t) => {
    const entry = {
        subdomain: "blog",
        owner: "octocat",
        types: ["CNAME"],
        targets: ["octocat.github.io"],
        proxied: true
    };
    t.true(matches(entry, { name: "blo" }));
    t.false(matches(entry, { name: "shop" }));
    t.true(matches(entry, { owner: "OctoCat" }));
    t.false(matches(entry, { owner: "someone" }));
    t.true(matches(entry, { type: "CNAME" }));
    t.false(matches(entry, { type: "A" }));
    t.true(matches(entry, { target: "github.io" }));
    t.false(matches(entry, { target: "vercel.app" }));
    t.true(matches(entry, { proxied: true }));
    t.false(matches(entry, { proxied: false }));
    t.true(matches(entry, { name: "blog", type: "CNAME", proxied: true }));
    t.false(matches(entry, { name: "blog", type: "A" }));
});

t("export toCsv escapes and formats rows", (t) => {
    const csv = toCsv([
        { subdomain: "a.is-a.dev", owner: "octocat", email: "", record_types: "CNAME", targets: 'x "quoted"', proxied: "no" }
    ]);
    const lines = csv.trim().split("\n");
    t.is(lines.length, 2);
    t.true(lines[0].startsWith("subdomain,owner,email,record_types,targets,proxied"));
    t.true(lines[1].includes('"x ""quoted"""'));
});
