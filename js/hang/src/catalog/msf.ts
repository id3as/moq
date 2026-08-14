/**
 * CMSF catalog encoding for a hang publisher.
 *
 * hang publishes its own catalog — kixelated's `{audio, video}` shape carried in a
 * moq-json snapshot on `catalog.json`. Norsk's MoQ ingest does not read that: it
 * subscribes to the track named `catalog` and expects an MSF/CMSF document
 * (draft-ietf-moq-msf-01 + -cmsf-01), so a hang publisher cannot be ingested by
 * Norsk without publishing one.
 *
 * @moq/msf already owns the wire format — {@link Msf.encode} hoists inline init
 * payloads into a deduplicated root `initDataList` and references them per-track
 * with `initRef`, which is what CMSF-01 §3.1 requires. This module is the small
 * amount on top: the normative track name, sane publisher defaults, and a shape a
 * caller can fill in without knowing the draft.
 *
 * Serve the bytes as a single object on {@link MSF_CATALOG_TRACK}. Norsk parses
 * the object payload as JSON directly, so it must NOT be wrapped in a moq-json
 * snapshot.
 *
 * This replaced an encodeWarpCatalog() that emitted the older
 * draft-ietf-moq-catalogformat-01 (`version: 1`, on `.catalog`). Norsk removed
 * that format entirely on 2026-09-04 — MSF-01 §5 makes `catalog` the normative
 * track name and every player we target reads it — so the WARP encoder now
 * targets a catalog nothing consumes.
 *
 * @module
 */

import * as Msf from "@moq/msf";

/**
 * The catalog track name. MSF-01 §5: "The catalog track MUST have a
 * case-sensitive Track Name of `catalog`."
 */
export const MSF_CATALOG_TRACK = "catalog";

/** Per-track packaging. CMSF-01 §3.5.1 adds "cmaf" to the MSF set. */
export type MsfPackaging = Msf.Packaging;

/**
 * One track to advertise. Mirrors {@link Msf.Track} but leaves the fields a
 * publisher should not have to think about — `packaging`, `isLive` — optional.
 */
export interface MsfCatalogTrack extends Omit<Msf.Track, "packaging" | "isLive"> {
	/** Defaults to the catalog's common packaging. */
	packaging?: MsfPackaging;
	/** Defaults to true: a hang publisher is live by definition. */
	isLive?: boolean;
}

/** Options for {@link encodeMsfCatalog}. */
export interface MsfCatalogOptions {
	/** Packaging shared by all tracks. Defaults to "cmaf". */
	packaging?: MsfPackaging;
	/** The tracks to advertise. */
	tracks: MsfCatalogTrack[];
}

/**
 * Encode a CMSF catalog to raw UTF-8 JSON bytes, ready to serve as one object on
 * {@link MSF_CATALOG_TRACK}.
 *
 * `initData` is base64 of the track's initialisation header (ftyp+moov for CMAF).
 * Tracks sharing identical bytes collapse to one `initDataList` entry, which is
 * the sharing `initRef` exists for.
 */
export function encodeMsfCatalog(options: MsfCatalogOptions): Uint8Array {
	const packaging = options.packaging ?? "cmaf";

	return Msf.encode({
		tracks: options.tracks.map((track) => ({
			...track,
			packaging: track.packaging ?? packaging,
			isLive: track.isLive ?? true,
		})),
	});
}
