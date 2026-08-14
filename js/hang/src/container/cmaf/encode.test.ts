import { describe, expect, it } from "bun:test";
import type * as Catalog from "../../catalog";
import * as Hex from "../../util/hex";
import { createAudioInitSegment } from "./encode";

type AudioConfig = Catalog.AudioConfig;

// A WebCodecs Opus `decoderConfig.description`: the Ogg OpusHead (RFC 7845 §5.1)
// WITH the 8-byte "OpusHead" magic and LITTLE-endian multi-byte fields, exactly
// what Chrome's AudioEncoder emits. Version is 1 for the Ogg header.
function oggOpusHead(channels: number, sampleRate: number, preSkip = 312): string {
	const b = new Uint8Array(19);
	b.set([0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64], 0); // "OpusHead"
	const dv = new DataView(b.buffer);
	b[8] = 1; // version (Ogg OpusHead)
	b[9] = channels;
	dv.setUint16(10, preSkip, true); // PreSkip, little-endian
	dv.setUint32(12, sampleRate, true); // InputSampleRate, little-endian
	dv.setInt16(16, 0, true); // OutputGain, little-endian
	b[18] = 0; // ChannelMappingFamily
	return Hex.fromBytes(b);
}

// Extract the dOps box body (after the 8-byte size+type header) from an init segment.
function findDOpsBody(init: Uint8Array): Uint8Array {
	const dv = new DataView(init.buffer, init.byteOffset, init.byteLength);
	for (let i = 4; i + 4 <= init.length; i++) {
		if (init[i] === 0x64 && init[i + 1] === 0x4f && init[i + 2] === 0x70 && init[i + 3] === 0x73) {
			const boxStart = i - 4;
			const size = dv.getUint32(boxStart, false);
			return init.subarray(i + 4, boxStart + size);
		}
	}
	throw new Error("dOps box not found in init segment");
}

describe("createAudioInitSegment Opus dOps", () => {
	// The ISOBMFF OpusSpecificBox (dOps) is the RFC 7845 §5.1 fields WITHOUT the
	// "OpusHead" magic, big-endian, Version 0. A publisher that copies the
	// WebCodecs Ogg OpusHead verbatim produces a box a spec demuxer rejects.
	it("emits a spec dOps body from a WebCodecs OpusHead: no magic, big-endian, version 0", () => {
		const init = createAudioInitSegment({
			codec: "opus",
			container: { kind: "cmaf", init: "" },
			sampleRate: 48000 as AudioConfig["sampleRate"],
			numberOfChannels: 2 as AudioConfig["numberOfChannels"],
			description: oggOpusHead(2, 48000),
		});
		const body = findDOpsBody(init);
		const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);

		// The "OpusHead" magic must not leak into the dOps body.
		expect(Array.from(body.subarray(0, 8))).not.toEqual([0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64]);

		expect(body[0]).toBe(0); // Version 0
		expect(body[1]).toBe(2); // OutputChannelCount
		expect(dv.getUint16(2, false)).toBe(312); // PreSkip, big-endian
		expect(dv.getUint32(4, false)).toBe(48000); // InputSampleRate, big-endian
		expect(body[10]).toBe(0); // ChannelMappingFamily
	});
});
