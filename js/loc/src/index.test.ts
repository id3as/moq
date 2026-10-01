import { expect, test } from "bun:test";
import { type Group, Time, Track } from "@moq/net";
import { Format, Producer } from "./index.ts";

/**
 * draft-ietf-moq-loc-04 §6.1 puts LOC's public properties in the MOQ Object
 * Properties on the object header and leaves the payload as the bare bitstream.
 * So the contract under test is "the timing comes off the object header and the
 * payload is returned untouched"; moq-net's own tests cover decoding the header.
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
	// moq-net resolves the track's timescale (or an object-scope 0x08 override) into
	// the Timestamp's own scale before we see it, so a 90 kHz stamp of 9000 is 100 ms.
	const [frame] = new Format().decode(wire(new Uint8Array([1]), new Time.Timestamp(9_000, Time.Timescale(90_000))));

	expect(frame.timestamp).toBe(100_000 as Time.Micro);
});

test("Format returns the payload byte-for-byte, stripping nothing", () => {
	// A payload whose leading bytes look like a property block must NOT be cut: an
	// in-payload block cannot be told apart from codec data (a stereo AAC-LC
	// raw_data_block's first byte reads as a plausible count), so stripping silently
	// truncates good media. shaka-player removed its equivalent strip for this reason.
	const looksLikeProps = new Uint8Array([0x03, 0x10, 0xb9, 0x60, 0xde, 0xad]);
	const [frame] = new Format().decode(wire(looksLikeProps, Time.Timestamp.fromMicros(1)));

	expect(frame.payload).toEqual(looksLikeProps);
	expect(frame.payload.byteLength).toBe(6);
});

test("Format treats an empty payload as a duration marker", () => {
	const fmt = new Format("video");
	const [decoded] = fmt.decode(wire(new Uint8Array(), Time.Timestamp.fromMicros(33_000)));
	expect(decoded.payload.byteLength).toBe(0);
	expect(fmt.end(decoded)).toBe(33_000 as Time.Micro);
});

test("Format preserves empty data payloads", () => {
	const fmt = new Format();
	const [decoded] = fmt.decode(wire(new Uint8Array(), Time.Timestamp.fromMicros(33_000)));
	expect(decoded.payload.byteLength).toBe(0);
	expect(fmt.end(decoded)).toBeUndefined();
});

test("Producer writes the bare bitstream, with no in-payload property block", async () => {
	// The payload on the wire must be exactly what the caller encoded; moq-net
	// writes the Timestamp as an object property.
	const track = new Track.Producer("video");
	const sub = track.subscribe().ordered();
	const producer = new Producer(track);

	const au = new Uint8Array([0x00, 0x00, 0x00, 0x01, 0x65, 0x88]);
	producer.encode(au, 40_000 as Time.Micro, true);

	const frame = await sub.readFrame();
	expect(frame).toBeDefined();
	expect(frame?.payload).toEqual(au);
	expect(frame?.timestamp.asMicros()).toBe(40_000);
});

test("Producer copies a Source payload", async () => {
	const track = new Track.Producer("video");
	const sub = track.subscribe().ordered();
	const producer = new Producer(track);

	const bytes = new Uint8Array([1, 2, 3]);
	producer.encode({ byteLength: bytes.byteLength, copyTo: (out) => out.set(bytes) }, 0 as Time.Micro, true);

	expect((await sub.readFrame())?.payload).toEqual(bytes);
});

test("Producer round-trips through Format unchanged", async () => {
	const track = new Track.Producer("video");
	const sub = track.subscribe().ordered();
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
