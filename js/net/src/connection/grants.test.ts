import { expect, test } from "bun:test";
import * as Path from "../path.ts";
import { grantedPrefixes, narrowPrefixes } from "./grants.ts";

// Unsigned on purpose: the client only reads the claims, it never verifies them.
function jwt(claims: unknown): string {
	const part = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
	return `${part({ alg: "EdDSA", kid: "k", typ: "JWT" })}.${part(claims)}.c2ln`;
}

function url(token: string, path = "/"): URL {
	const u = new URL(`https://relay.example${path}`);
	u.searchParams.set("jwt", token);
	return u;
}

// The valid_guest case from norsk's shared moq-auth vectors (sdk/test/moq/fixtures/moq-auth-vectors.json).
const GUEST =
	"eyJhbGciOiJFZERTQSIsImtpZCI6InJ0MS1rZXkiLCJ0eXAiOiJKV1QifQ.eyJhdWQiOiJtb3EiLCJleHAiOjE4MDAwMDA2MDAsImdldCI6WyJzbG90MS9hYmMvbW9uaXRvciIsInByb2dyYW0iXSwiaWF0IjoxNzk5OTk5OTkwLCJpc3MiOiJzdHVkaW86cnQxIiwicHV0IjpbInNsb3QxL2FiYy9taWMtY29tbWVudGFyeSIsInNsb3QxL2FiYy9taWMtY29tbXMiXSwicm9vdCI6InRlbmFudHMvdDEvcnQxL2NvbW1lbnRhcnkvYzEiLCJzaWQiOiJhYmMiLCJzdWIiOiJndWVzdDpzbG90MSJ9.fz8vlSXgQFRVXw9C_9lrCUPCCfwIw3ZlCTych8uYnQNmvr8M1qt_5Vb1GHoWFXW30IN29TEzpBnd8dr_jVXTAg";

test("no token leaves discovery unrestricted", () => {
	expect(grantedPrefixes(new URL("https://relay.example/anon?other=1"))).toBeUndefined();
});

test("a root-only token discovers under its root", () => {
	expect(grantedPrefixes(url(jwt({ root: "tenants/t1/rt1" })))).toEqual([Path.from("tenants/t1/rt1")]);
});

test("get grants are suffixes under root", () => {
	expect(grantedPrefixes(url(GUEST))).toEqual([
		Path.from("tenants/t1/rt1/commentary/c1/program"),
		Path.from("tenants/t1/rt1/commentary/c1/slot1/abc/monitor"),
	]);
	// "" grants all of root, and swallows the narrower grants beside it.
	expect(grantedPrefixes(url(jwt({ root: "r", get: ["", "x"] })))).toEqual([Path.from("r")]);
	// An empty get grants nothing to discover.
	expect(grantedPrefixes(url(jwt({ root: "r", get: [] })))).toEqual([]);
});

test("a token that can't be read grants no discovery", () => {
	expect(grantedPrefixes(url("not-a-jwt"))).toEqual([]);
	expect(grantedPrefixes(url("a.%%%.c"))).toEqual([]);
	expect(grantedPrefixes(url(jwt(["root"])))).toEqual([]);
	expect(grantedPrefixes(url(jwt({ sub: "nobody" })))).toEqual([]);
});

test("grants are rebased onto a URL path that scopes the session (moq-relay)", () => {
	// The URL path is the root: the session sees paths relative to it.
	expect(grantedPrefixes(url(jwt({ root: "room", get: [""] }), "/room"))).toEqual([Path.empty()]);
	expect(grantedPrefixes(url(jwt({ root: "room", get: ["alice"] }), "/room"))).toEqual([Path.from("alice")]);
	// A URL path beneath the grant is covered whole.
	expect(grantedPrefixes(url(jwt({ root: "room" }), "/room/alice"))).toEqual([Path.empty()]);
	// An unrelated URL path doesn't scope anything (Norsk): the grant stands as written.
	expect(grantedPrefixes(url(jwt({ root: "room" }), "/moq"))).toEqual([Path.from("room")]);
});

test("interests narrow to the grants", () => {
	const all = [Path.empty()];
	expect(narrowPrefixes(all, [Path.from("a/b"), Path.from("c")])).toEqual([Path.from("a/b"), Path.from("c")]);
	expect(narrowPrefixes([Path.from("a/b/c"), Path.from("d")], [Path.from("a")])).toEqual([Path.from("a/b/c")]);
	expect(narrowPrefixes([Path.from("d")], [Path.from("a")])).toEqual([]);
});
