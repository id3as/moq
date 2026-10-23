/**
 * The namespaces a session's token lets it discover, so the forwarder asks for those rather
 * than for everything and having the request refused.
 *
 * @module
 */
import * as Path from "../path.ts";

/**
 * The prefixes the `?jwt=` token on `url` grants SUBSCRIBE_NAMESPACE under, as session paths,
 * or undefined when the URL carries no token (discovery is then unrestricted, as before).
 *
 * The payload is decoded, never verified: the peer verifies, and this only avoids asking for
 * what it would refuse. Claims follow moq-token: `root` is the absolute prefix ("/"-joined)
 * and each `get` entry is a suffix under it (`""` = all of `root`). Without `get` the token
 * is taken to scope by `root` alone. A relay that scopes the session to the URL path
 * (moq-relay, where the path is the token's root) sees paths relative to it, so a grant
 * overlapping the URL path is rebased onto it; one that doesn't is used as it stands.
 *
 * A token that can't be decoded, or that names neither `root` nor `get`, grants nothing: an
 * empty list, so the caller skips discovery rather than send a request that will be refused.
 */
export function grantedPrefixes(url: URL): Path.Valid[] | undefined {
	const token = url.searchParams.get("jwt");
	if (token === null) return undefined;

	const claims = decodePayload(token);
	if (!claims) return [];

	const root = typeof claims.root === "string" ? Path.from(claims.root) : undefined;
	const get = typeof claims.get === "string" ? [claims.get] : claims.get;
	const suffixes = Array.isArray(get) ? get.filter((s) => typeof s === "string") : undefined;
	if (root === undefined && suffixes === undefined) return [];

	const base = root ?? Path.empty();
	const grants = suffixes === undefined ? [base] : suffixes.map((suffix) => Path.join(base, Path.from(suffix)));
	const scope = urlScope(url);
	return outermost(grants.map((grant) => rebase(scope, grant)));
}

// A grant as a session path. Under the URL path it is relative to it; covering the URL path
// it is the whole session. Otherwise the peer doesn't scope by URL path (Norsk), so it stays.
function rebase(scope: Path.Valid, grant: Path.Valid): Path.Valid {
	if (Path.hasPrefix(grant, scope)) return Path.empty();
	return Path.stripPrefix(scope, grant) ?? grant;
}

/**
 * The parts of `interests` that also lie within `grants`: an interest inside a grant is kept,
 * and a grant inside an interest stands in for it.
 */
export function narrowPrefixes(interests: readonly Path.Valid[], grants: readonly Path.Valid[]): Path.Valid[] {
	const out: Path.Valid[] = [];
	for (const interest of interests) {
		for (const grant of grants) {
			if (Path.hasPrefix(grant, interest)) out.push(interest);
			else if (Path.hasPrefix(interest, grant)) out.push(grant);
		}
	}
	return outermost(out);
}

// Dedupe, dropping any prefix nested in another: the outer subscription already carries it.
function outermost(prefixes: Path.Valid[]): Path.Valid[] {
	const unique = [...new Set(prefixes)].sort();
	return unique.filter((p) => !unique.some((other) => other !== p && Path.hasPrefix(other, p)));
}

function urlScope(url: URL): Path.Valid {
	try {
		return Path.from(decodeURIComponent(url.pathname));
	} catch {
		return Path.from(url.pathname);
	}
}

function decodePayload(token: string): Record<string, unknown> | undefined {
	const parts = token.split(".");
	if (parts.length !== 3) return undefined;

	try {
		const b64 = (parts[1] ?? "").replace(/-/g, "+").replace(/_/g, "/");
		const bytes = Uint8Array.from(atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, "=")), (c) => c.charCodeAt(0));
		const claims: unknown = JSON.parse(new TextDecoder().decode(bytes));
		if (typeof claims !== "object" || claims === null || Array.isArray(claims)) return undefined;
		return claims as Record<string, unknown>;
	} catch {
		return undefined;
	}
}
