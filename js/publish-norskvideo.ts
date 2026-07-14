#!/usr/bin/env bun
/**
 * Publish the Norsk fork of the moq-dev/moq JS packages to the @norskvideo npm
 * scope. Run manually whenever the fork changes:
 *
 *   bun run publish-norskvideo.ts --version 0.1.0             # DRY RUN (npm pack only)
 *   bun run publish-norskvideo.ts --version 0.1.0 --publish   # actually publish
 *
 * What it does, for each forked package (in dependency order):
 *   1. Build it with its normal build (dist/ with the upstream @moq/* names).
 *   2. Rewrite the built dist/ to the @norskvideo scope:
 *        - package name        @moq/<pkg>       → @norskvideo/moq-<pkg>
 *        - forked inter-deps    @moq/<forked>    → @norskvideo/moq-<forked>@^VERSION
 *        - import specifiers in the built .js / .d.ts (bare + subpath)
 *      External @moq deps (e.g. @moq/qmux, which we do NOT fork) are left as-is.
 *   3. Stamp every package at the same --version, so the inter-dep ^ranges line up.
 *   4. npm publish --access public  (or npm pack --dry-run without --publish).
 *
 * Prereqs: `bun install` in js/ (so tsc can resolve @moq/qmux etc.), and
 * `npm login` for the @norskvideo scope before using --publish.
 *
 * Consuming side: import the published packages as @norskvideo/moq-* (they
 * reference each other by that name, so importing them directly de-dupes the
 * shared singletons like @norskvideo/moq-signals — don't mix with @moq/* aliases).
 */

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Resolve package dirs relative to THIS file (the js/ workspace root), so the
// script works regardless of the cwd it's invoked from.
const JS_DIR = import.meta.dir;

// Forked packages IN DEPENDENCY (publish) ORDER. Dir name === @moq/<dir>.
// External deps not listed here (notably @moq/qmux) are left on the @moq scope.
const FORKED = ["signals", "flate", "net", "json", "loc", "msf", "hang", "watch"] as const;

const SCOPE = "@norskvideo";
const newName = (dir: string) => `${SCOPE}/moq-${dir}`; // @moq/net -> @norskvideo/moq-net

// ── args ─────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const doPublish = args.includes("--publish");
const vIdx = args.indexOf("--version");
const VERSION = vIdx >= 0 ? args[vIdx + 1] : undefined;
if (!VERSION || VERSION.startsWith("--")) {
	console.error("usage: bun run publish-norskvideo.ts --version X.Y.Z [--publish]");
	process.exit(1);
}

// Match a FORKED @moq specifier (bare or subpath), never an external one like
// @moq/qmux. Boundary is the specifier terminator: quote, backtick or slash.
const forkedRe = new RegExp(`@moq/(${FORKED.join("|")})(?=["'\`/])`, "g");
const rename = (s: string) => s.replace(forkedRe, (_m, dir: string) => newName(dir));

function walkFiles(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		const p = join(dir, entry);
		if (statSync(p).isDirectory()) walkFiles(p, out);
		else if (/\.js$/.test(entry) || /\.d\.ts$/.test(entry)) out.push(p);
	}
	return out;
}

// ── phase 1: build everything with the upstream @moq names ───────────
// Build all BEFORE rewriting any dist/, so tsc project references keep reading
// unmodified sibling declaration output.
console.log("── building all packages ──");
for (const dir of FORKED) {
	console.log(`\n▶ build ${dir}`);
	execFileSync("bun", ["run", "build"], { cwd: join(JS_DIR, dir), stdio: "inherit" });
}

// ── phase 2: rewrite each dist/ to @norskvideo, then publish ─────────
console.log(`\n── ${doPublish ? "publishing" : "DRY RUN (npm pack)"} @ ${VERSION} ──`);
for (const dir of FORKED) {
	const distDir = join(JS_DIR, dir, "dist");
	const pkgPath = join(distDir, "package.json");
	const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));

	pkg.name = newName(dir);
	pkg.version = VERSION;

	for (const field of ["dependencies", "peerDependencies"] as const) {
		const deps: Record<string, string> | undefined = pkg[field];
		if (!deps) continue;
		for (const key of Object.keys(deps)) {
			const m = key.match(/^@moq\/([a-z-]+)$/);
			if (m && (FORKED as readonly string[]).includes(m[1])) {
				delete deps[key];
				deps[newName(m[1])] = `^${VERSION}`;
			}
		}
	}
	writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

	// Rewrite import specifiers in the built output.
	for (const f of walkFiles(distDir)) {
		const src = readFileSync(f, "utf8");
		const out = rename(src);
		if (out !== src) writeFileSync(f, out);
	}

	console.log(`\n▶ ${doPublish ? "publish" : "pack"} ${pkg.name}@${VERSION}`);
	const npmArgs = doPublish ? ["publish", "--access", "public"] : ["pack", "--dry-run"];
	execFileSync("npm", npmArgs, { cwd: distDir, stdio: "inherit" });
}

console.log(`\n✅ ${doPublish ? "Published" : "Dry-ran"} ${FORKED.length} packages @ ${VERSION}`);
if (!doPublish) console.log("   (re-run with --publish to actually publish)");
