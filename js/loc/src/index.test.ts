import { expect, test } from "bun:test";
import { Group, Time, Track } from "@moq/net";
import { Format, Producer } from "./index.ts";

/**
 * These tests were rewritten when LOC moved to the format the draft actually
 * specifies. They used to build a length-prefixed property block INSIDE the
 * payload and assert it was parsed back out; draft-ietf-moq-loc-04 §6.1 puts the
 * public properties in the MOQ Object Properties on the object header, and leaves
 * the payload as the bare bitstream. So the contract under test is now "the
 * timing comes off the object header and the payload is returned untouched".
 */

function wire(payload: Uint8Array, timestamp: Time.Timestamp): Group.Frame {
	return { payload, timestamp };
}

test("Format takes its timing from the object header", () => {
	const payload = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
	const [frame] = new Format().decode(wire(payload, Time.Timestamp.fromMicros(12_345)));

	expect(frame.timestamp).toBe(12_345 as Time.Micro);
	expect(frame.payload).toEqual(payload);
});

test("Format honours a non-microsecond timescale", () => {
	// moq-net resolves an object-scope Timescale (0x08) into the Timestamp's own
	// scale before we ever see it, so a 90 kHz stamp of 9000 is 100 ms.
	const [frame] = new Format().decode(
		wire(new Uint8Array([1]), new Time.Timestamp(9_000, Time.Timescale(90_000))),
	);

	expect(frame.timestamp).toBe(100_000 as Time.Micro);
});

test("Format returns the payload byte-for-byte, stripping nothing", () => {
	// The regression this file exists for. A payload whose leading bytes look like
	// a property block must NOT be cut: an in-payload block cannot be told apart
	// from codec data (a stereo AAC-LC raw_data_block's first byte reads as a
	// plausible count), so stripping silently truncates good media. shaka-player
	// removed its equivalent strip for exactly this reason.
	const looksLikeProps = new Uint8Array([0x03, 0x10, 0xb9, 0x60, 0xde, 0xad]);
	const [frame] = new Format().decode(wire(looksLikeProps, Time.Timestamp.fromMicros(1)));

	expect(frame.payload).toEqual(looksLikeProps);
	expect(frame.payload.byteLength).toBe(6);
});

test("Producer writes the bare bitstream, with no in-payload property block", async () => {
	// The other half of the same bug: the payload on the wire must be exactly what
	// the caller encoded. moq-net writes the Timestamp as an object property.
	// NB an in-process producer->subscriber keeps the Timestamp object as written,
	// so this does NOT exercise the track-timescale requirement in Producer's
	// docs -- that only bites once moq-net converts into the track's scale on the
	// wire. It is covered instead by norsk's moq_browser_loc_publish test.
	const track = new Track.Producer("video");
	const sub = track.subscribe();
	const producer = new Producer(track);

	const au = new Uint8Array([0x00, 0x00, 0x00, 0x01, 0x65, 0x88]);
	producer.encode(au, 40_000 as Time.Micro, true);

	const frame = await sub.readFrame();
	expect(frame).toBeDefined();
	expect(frame?.payload).toEqual(au);
	expect(frame?.timestamp.asMicros()).toBe(40_000);
});

test("Producer round-trips through Format unchanged", async () => {
	const track = new Track.Producer("video");
	const sub = track.subscribe();
	const producer = new Producer(track);

	const au = new Uint8Array([9, 8, 7, 6, 5]);
	producer.encode(au, 120_000 as Time.Micro, true);

	const frame = await sub.readFrame();
	if (!frame) throw new Error("no frame");
	const [decoded] = new Format().decode(frame);

	expect(decoded.payload).toEqual(au);
	expect(decoded.timestamp).toBe(120_000 as Time.Micro);
});

test("Producer requires a keyframe before any delta frame", () => {
	const track = new Track.Producer("video");
	const producer = new Producer(track);

	expect(() => producer.encode(new Uint8Array([1]), 0 as Time.Micro, false)).toThrow();
});
