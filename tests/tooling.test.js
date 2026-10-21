const t = require("ava");
const {
    findDuplicateKeys,
    findCnameCycles,
    validateDomainFile,
    validateOwner,
    validateFileName,
    validateRedirectConfig
} = require("../util/validator");
const { matches } = require("../scripts/query");
const { toCsv, toNdjson, hostSuffix, targetHosts } = require("../scripts/export");
const { buildDomainFile, parseCliArgs } = require("../scripts/scaffold");
const { levenshtein, findSimilar } = require("../scripts/similar");

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

t("validator rejects TXT strings longer than 255 characters", (t) => {
    const long = "x".repeat(256);
    const errors = validateDomainFile("my-site.json", {
        owner: { username: "octocat" },
        records: { TXT: ["short", long] }
    });
    t.true(errors.some((e) => e.includes("TXT[1]") && e.includes("255")));
    t.false(errors.some((e) => e.includes("TXT[0]") && e.includes("255")));
    // 255 exactly is fine
    const ok = validateDomainFile("my-site.json", {
        owner: { username: "octocat" },
        records: { TXT: ["x".repeat(255)] }
    });
    t.false(ok.some((e) => e.includes("255")));
});

t("validator enforces redirect_config field types", (t) => {
    const base = (redirect_config) => ({
        owner: { username: "octocat" },
        records: { URL: "https://example.com" },
        redirect_config
    });
    t.true(
        validateRedirectConfig("my-site", base({ redirect_paths: "yes" })).some((e) =>
            e.includes("redirect_paths should be a boolean")
        )
    );
    t.true(
        validateRedirectConfig("my-site", base({ redirect_paths: true })).length === 0
    );
    t.true(
        validateRedirectConfig("my-site", base({ custom_paths: ["/a"] })).some((e) =>
            e.includes("custom_paths should be an object")
        )
    );
    t.true(
        validateRedirectConfig(
            "my-site",
            base({ custom_paths: { "/go": "https://example.com/go" } })
        ).length === 0
    );
});

t("findCnameCycles detects loops and ignores acyclic chains", (t) => {
    const cycles = findCnameCycles([
        { subdomain: "a", cname: "b.is-a.dev" },
        { subdomain: "b", cname: "c.is-a.dev" },
        { subdomain: "c", cname: "a.is-a.dev" },
        { subdomain: "d", cname: "e.is-a.dev" },
        { subdomain: "e", cname: "example.com" },
        { subdomain: "f", cname: "f.is-a.dev" } // self-loop
    ]);
    t.is(cycles.length, 2);
    const sorted = cycles.map((c) => [...c].sort().join(",")).sort();
    t.deepEqual(sorted, ["a,b,c", "f"]);

    t.deepEqual(
        findCnameCycles([
            { subdomain: "x", cname: "y.is-a.dev" },
            { subdomain: "y", cname: "example.org" }
        ]),
        []
    );
    // case-insensitive target matching
    t.is(
        findCnameCycles([
            { subdomain: "p", cname: "Q.IS-A.DEV" },
            { subdomain: "q", cname: "p.is-a.dev" }
        ]).length,
        1
    );
});

t("query matches() supports the new email/nested/redirect filters", (t) => {
    const entry = {
        subdomain: "api.blog",
        owner: "octocat",
        email: "octo@example.com",
        types: ["A"],
        targets: ["192.0.2.1"],
        proxied: false,
        nested: true,
        hasRedirect: true
    };
    t.true(matches(entry, { email: "example.com" }));
    t.true(matches(entry, { email: "OCTO@" }));
    t.false(matches(entry, { email: "other.com" }));
    t.true(matches(entry, { nested: true }));
    t.false(matches(entry, { nested: false }));
    t.true(matches(entry, { hasRedirect: true }));
    t.false(matches(entry, { hasRedirect: false }));
    t.true(matches(entry, { email: "example.com", nested: true, hasRedirect: true, type: "A" }));
    t.false(matches(entry, { email: "example.com", nested: false }));
    // missing email field degrades gracefully
    t.false(matches({ ...entry, email: "" }, { email: "example.com" }));
});

t("export toNdjson emits one JSON object per line", (t) => {
    const rows = [
        { subdomain: "a.is-a.dev", owner: "octocat", redirect: "no" },
        { subdomain: "b.is-a.dev", owner: "hubot", redirect: "yes" }
    ];
    const lines = toNdjson(rows).trim().split("\n");
    t.is(lines.length, 2);
    t.deepEqual(JSON.parse(lines[0]), rows[0]);
    t.deepEqual(JSON.parse(lines[1]), rows[1]);
});

t("export hostSuffix groups hosting providers and IPs", (t) => {
    t.is(hostSuffix("octocat.github.io"), "github.io");
    t.is(hostSuffix("my-app.vercel.app"), "vercel.app");
    t.is(hostSuffix("https://Example.COM:8080/x"), "example.com");
    t.is(hostSuffix("192.0.2.1"), "(ip)");
    t.is(hostSuffix("2001:db8::1"), "(ip)");
    t.is(hostSuffix("localhost"), "localhost");
    t.is(hostSuffix(""), "(none)");
});

t("export targetHosts extracts searchable hosts from targets", (t) => {
    t.deepEqual(targetHosts("octocat.github.io | https://example.com/go?x=1"), [
        "octocat.github.io",
        "example.com"
    ]);
    t.deepEqual(targetHosts("v=spf1 mx ~all"), ["v=spf1"]);
    t.deepEqual(targetHosts(""), []);
});

t("scaffold buildDomainFile builds valid files and rejects bad input", (t) => {
    const { file, data } = buildDomainFile({
        subdomain: "mynewsite",
        username: "octocat",
        email: "octo@example.com",
        records: { CNAME: "octocat.github.io" },
        proxied: false
    });
    t.is(file, "mynewsite.json");
    t.deepEqual(data, {
        owner: { username: "octocat", email: "octo@example.com" },
        records: { CNAME: "octocat.github.io" }
    });
    t.deepEqual(validateDomainFile(file, data), []);

    // email omitted when empty, proxied included when true
    const minimal = buildDomainFile({
        subdomain: "s2",
        username: "octocat",
        email: "",
        records: { A: ["192.0.2.1"] },
        proxied: true
    });
    t.false("email" in minimal.data.owner);
    t.true(minimal.data.proxied);

    t.throws(() => buildDomainFile({
        subdomain: "Bad Name",
        username: "octocat",
        email: "",
        records: { CNAME: "x.io" },
        proxied: false
    }));
    t.throws(() => buildDomainFile({
        subdomain: "okname",
        username: "not a user!!",
        email: "",
        records: { CNAME: "x.io" },
        proxied: false
    }));
    t.throws(() => buildDomainFile({
        subdomain: "okname",
        username: "octocat",
        email: "",
        records: { A: ["10.0.0.1"] },
        proxied: false
    }));
});

t("scaffold parseCliArgs parses non-interactive flags", (t) => {
    const parsed = parseCliArgs([
        "--name", "mysite",
        "--username", "octocat",
        "--email", "o@e.com",
        "--cname", "octocat.github.io",
        "--proxied"
    ]);
    t.is(parsed.subdomain, "mysite");
    t.is(parsed.username, "octocat");
    t.deepEqual(parsed.records, { CNAME: "octocat.github.io" });
    t.true(parsed.proxied);

    const multi = parseCliArgs(["--name", "s", "--username", "u", "--a", "192.0.2.1,192.0.2.2"]);
    t.deepEqual(multi.records, { A: ["192.0.2.1", "192.0.2.2"] });
});

t("similar levenshtein computes edit distance", (t) => {
    t.is(levenshtein("kitten", "sitting"), 3);
    t.is(levenshtein("google", "google"), 0);
    t.is(levenshtein("google", "goggle"), 1);
    t.is(levenshtein("", "abc"), 3);
});

t("similar findSimilar ranks near-misses and skips exact matches", (t) => {
    const subs = ["google", "goggle", "gooogle", "facebook", "go"];
    const hits = findSimilar("google", subs, 2);
    const names = hits.map((h) => h.subdomain);
    t.false(names.includes("google"));
    t.true(names.includes("goggle"));
    t.true(names.includes("gooogle"));
    t.false(names.includes("facebook"));
    t.is(hits[0].subdomain, "goggle");
    t.is(hits[0].distance, 1);
    t.deepEqual(findSimilar("zzzqqq", subs, 1), []);
});
