/**
 * WARP catalog (draft-ietf-moq-catalogformat-01): the flat `version: 1` JSON
 * catalog that norsk's MoQ ingest reads on the `.catalog` track. Unlike the hang
 * {@link Producer} (kixelated's `{audio, video}` catalog carried over a moq-json
 * snapshot), this is a single raw-JSON object: build it with
 * {@link encodeWarpCatalog} and serve the bytes as one object on `.catalog`
 * (norsk parses the object payload as JSON directly, so it must NOT be wrapped in
 * a moq-json snapshot).
 *
 * @module
 */

/** Per-track packaging, as named by draft-ietf-moq-catalogformat-01. */
export type WarpPackaging = "cmaf" | "loc";

/** One entry in the WARP catalog `tracks` array. */
export interface WarpTrack {
	/** Data track name (the MoQ track a consumer subscribes to). */
	name: string;
	/** CMAF init track name carrying ftyp+moov, when packaging is "cmaf". */
	initTrack?: string;
	/** Base64 inline init bytes, as an alternative to {@link WarpTrack.initTrack}. */
	initData?: string;
	/** Packaging override for this track; defaults to the catalog's common packaging. */
	packaging?: WarpPackaging;
	/** Selection hints (codec, samplerate, ...); optional for CMAF, sniffed from the init. */
	selectionParams?: Record<string, string | number>;
	/** Render group for this track; defaults to the common render group. */
	renderGroup?: number;
}

/** Options for {@link encodeWarpCatalog}. */
export interface WarpCatalogOptions {
	/** Broadcast namespace, "/"-joined (becomes `commonTrackFields.namespace`). */
	namespace: string;
	/** Packaging shared by all tracks. Defaults to "cmaf". */
	packaging?: WarpPackaging;
	/** Render group shared by all tracks. Defaults to 1. */
	renderGroup?: number;
	/** The tracks to advertise. */
	tracks: WarpTrack[];
}

/**
 * Encode a WARP `version: 1` catalog to raw UTF-8 JSON bytes. Serve the result as
 * a single object on the `.catalog` track; norsk decodes the object payload as
 * JSON directly and rejects anything whose `version` is not the integer 1.
 */
export function encodeWarpCatalog(options: WarpCatalogOptions): Uint8Array {
	const packaging = options.packaging ?? "cmaf";
	const renderGroup = options.renderGroup ?? 1;

	const catalog = {
		version: 1,
		streamingFormat: 1,
		streamingFormatVersion: "0.2",
		supportsDeltaUpdates: false,
		commonTrackFields: { namespace: options.namespace, packaging, renderGroup },
		tracks: options.tracks.map((track) => {
			const entry: Record<string, unknown> = { name: track.name };
			if (track.selectionParams) entry.selectionParams = track.selectionParams;
			if (track.packaging) entry.packaging = track.packaging;
			if (track.initTrack !== undefined) entry.initTrack = track.initTrack;
			if (track.initData !== undefined) entry.initData = track.initData;
			if (track.renderGroup !== undefined) entry.renderGroup = track.renderGroup;
			return entry;
		}),
	};

	return new TextEncoder().encode(JSON.stringify(catalog));
}
