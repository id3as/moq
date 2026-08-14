import { describe, expect, it } from "bun:test";
import { encodeMsfCatalog, MSF_CATALOG_TRACK } from "./msf";

// These assertions are the wire contract with Norsk's moq_catalog_msf:decode/1,
// which refuses a document whose `version` it does not understand and resolves
// `initRef` against the root `initDataList`. Assert the JSON, not just a
// round-trip through @moq/msf, so a change to the wire shape fails here rather
// than in an interop run.
describe("encodeMsfCatalog", () => {
	it("emits a draft-01 CMSF catalog with init hoisted behind initRef", () => {
		const bytes = encodeMsfCatalog({
			tracks: [
				{
					name: "audio.m4s",
					role: "audio",
					codec: "opus",
					samplerate: 48000,
					channelConfig: "2",
					initData: "AAAA",
				},
			],
		});
		const catalog = JSON.parse(new TextDecoder().decode(bytes));

		// The version gate is the string "draft-01" (MSF-01 §5.1.1's draft-XX
		// convention), NOT the integer 1 the retired WARP catalog used.
		expect(catalog.version).toBe("draft-01");
		expect(typeof catalog.version).toBe("string");

		expect(catalog.tracks).toHaveLength(1);
		expect(catalog.tracks[0]).toMatchObject({
			name: "audio.m4s",
			packaging: "cmaf",
			isLive: true,
			role: "audio",
			codec: "opus",
			samplerate: 48000,
			channelConfig: "2",
		});

		// CMSF-01 §3.1: the header is an initDataList entry referenced by initRef,
		// never inline on the track.
		expect(catalog.tracks[0].initData).toBeUndefined();
		expect(catalog.initDataList).toEqual([{ id: catalog.tracks[0].initRef, type: "inline", data: "AAAA" }]);
	});

	it("shares one initDataList entry between tracks with identical headers", () => {
		const bytes = encodeMsfCatalog({
			tracks: [
				{ name: "v-high.m4s", role: "video", codec: "avc1.640028", initData: "SAME" },
				{ name: "v-low.m4s", role: "video", codec: "avc1.640028", initData: "SAME" },
				{ name: "a.m4s", role: "audio", codec: "opus", initData: "OTHER" },
			],
		});
		const catalog = JSON.parse(new TextDecoder().decode(bytes));

		expect(catalog.initDataList).toHaveLength(2);
		expect(catalog.tracks[0].initRef).toBe(catalog.tracks[1].initRef);
		expect(catalog.tracks[2].initRef).not.toBe(catalog.tracks[0].initRef);
	});

	it("defaults packaging and isLive, and honours per-track overrides", () => {
		const bytes = encodeMsfCatalog({
			packaging: "loc",
			tracks: [
				{ name: "a", codec: "opus" },
				{ name: "b", codec: "avc1.640028", packaging: "cmaf", isLive: false },
			],
		});
		const catalog = JSON.parse(new TextDecoder().decode(bytes));

		expect(catalog.tracks[0]).toMatchObject({ packaging: "loc", isLive: true });
		expect(catalog.tracks[1]).toMatchObject({ packaging: "cmaf", isLive: false });
		// No init anywhere means no initDataList at all, not an empty one.
		expect("initDataList" in catalog).toBe(false);
	});

	it("names the normative catalog track", () => {
		// MSF-01 §5, case-sensitive. Norsk's ingest subscribes to exactly this.
		expect(MSF_CATALOG_TRACK).toBe("catalog");
	});
});
