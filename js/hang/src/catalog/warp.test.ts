import { describe, expect, it } from "bun:test";
import { encodeWarpCatalog } from "./warp";

describe("encodeWarpCatalog", () => {
	it("emits a version:1 WARP catalog norsk ingest accepts", () => {
		const bytes = encodeWarpCatalog({
			namespace: "norsk/spike",
			tracks: [
				{
					name: "audio.m4s",
					initTrack: "audio.mp4",
					selectionParams: { codec: "opus", samplerate: 48000 },
				},
			],
		});
		const catalog = JSON.parse(new TextDecoder().decode(bytes));

		// The version gate is an integer 1, not "1" or "draft-01".
		expect(catalog.version).toBe(1);
		expect(typeof catalog.version).toBe("number");

		expect(catalog.commonTrackFields).toEqual({
			namespace: "norsk/spike",
			packaging: "cmaf",
			renderGroup: 1,
		});
		expect(catalog.tracks).toEqual([
			{
				name: "audio.m4s",
				selectionParams: { codec: "opus", samplerate: 48000 },
				initTrack: "audio.mp4",
			},
		]);
	});

	it("omits optional track fields when unset and honours overrides", () => {
		const bytes = encodeWarpCatalog({
			namespace: "ns",
			packaging: "loc",
			renderGroup: 2,
			tracks: [{ name: "a", initData: "AAAA" }],
		});
		const catalog = JSON.parse(new TextDecoder().decode(bytes));

		expect(catalog.commonTrackFields.packaging).toBe("loc");
		expect(catalog.commonTrackFields.renderGroup).toBe(2);
		expect(catalog.tracks[0]).toEqual({ name: "a", initData: "AAAA" });
		expect("initTrack" in catalog.tracks[0]).toBe(false);
	});
});
