/**
 * Low Overhead Container (LOC): encode and decode codec bitstreams framed with
 * per-frame timestamp and timescale metadata for MoQ.
 *
 * @module
 */
import type { Time } from "@moq/net";
import * as Moq from "@moq/net";

/** A decoded LOC frame: the codec bitstream plus its timing metadata. */
export interface Frame {
	/** The codec bitstream payload, with the LOC property block stripped. */
	data: Uint8Array;
	/** Presentation timestamp in microseconds. */
	timestamp: Time.Micro;
	/** True if this frame can be decoded without any preceding frames. */
	keyframe: boolean;
}

// In-payload (pre-loc-03) Timestamp id vs the loc-03 object-header Timestamp id.
// Timescale (0x08) is the same in both. draft-ietf-moq-loc-03 §2.3.1.
const PROP_TIMESTAMP = 0x06;
const PROP_TIMESTAMP_HEADER = 0x0a;
const PROP_TIMESCALE = 0x08;

const DEFAULT_TIMESCALE = 1_000_000;

/**
 * Decoder for the Low Overhead Container (LOC) defined in
 * draft-ietf-moq-loc.
 *
 * Each MoQ frame is a small property block (timestamp, optional per-frame
 * timescale) followed by the codec bitstream payload. Frames without a 0x08
 * timescale property are interpreted as microseconds.
 */
export class Format {
	/** Decode one moq-net frame into its LOC frames. Throws on malformed input. */
	decode(frame: Uint8Array, extensions?: Uint8Array): Frame[] {
		// draft-ietf-moq-loc-03 §2.3: the per-frame properties (Timestamp 0x0A,
		// Timescale 0x08) ride in the MOQ Object header extensions and the payload
		// is the bare codec frame. When there are no header extensions, fall back
		// to the older in-payload block ([propsLen][delta-KVP][codec], Timestamp
		// 0x06). norsk negotiates draft-16 with hang (ALPN moqt-16), whose object
		// extension headers DELTA-encode the type ids (§1.4.3, deltaEncoded true) —
		// same as the in-payload block. (draft-14 would key them absolute; net
		// tops out at draft-16 and norsk prefers 16, so we don't hit that here. If
		// the negotiated draft is ever surfaced to this decoder, switch on it.)
		if (extensions !== undefined && extensions.byteLength > 0) {
			const { timestamp, timescale } = parseProps(extensions, PROP_TIMESTAMP_HEADER, false);
			return [{ data: frame, timestamp: toMicros(timestamp, timescale), keyframe: false }];
		}

		const [propsLen, afterLen] = Moq.Varint.decode(frame);
		if (afterLen.byteLength < propsLen) {
			throw new Error("loc: properties_length exceeds frame size");
		}
		const props = afterLen.subarray(0, propsLen);
		const payload = afterLen.subarray(propsLen);
		const { timestamp, timescale } = parseProps(props, PROP_TIMESTAMP, true);
		return [{ data: payload, timestamp: toMicros(timestamp, timescale), keyframe: false }];
	}
}

/**
 * Walk a count-less KVP block: each entry is a type id then a value (even type →
 * varint; odd type → length-prefixed bytes). When `deltaEncoded` the type ids
 * are delta-encoded against the previous (draft §1.4.3 / draft-16+ and the
 * in-payload block); otherwise they are absolute (draft-14 §1.4.2 object
 * extension headers). `timestampId` selects which even property is the timestamp.
 */
function parseProps(
	bytes: Uint8Array,
	timestampId: number,
	deltaEncoded: boolean,
): { timestamp: number; timescale: number | undefined } {
	let timestamp: number | undefined;
	let timescale: number | undefined;
	let prevType = 0;
	let first = true;
	let cursor = bytes;

	while (cursor.byteLength > 0) {
		const [type, afterType] = Moq.Varint.decode(cursor);
		const abs = deltaEncoded ? (first ? type : prevType + type) : type;
		first = false;
		prevType = abs;
		cursor = afterType;

		if (abs % 2 === 0) {
			const [value, afterValue] = Moq.Varint.decode(cursor);
			cursor = afterValue;
			if (abs === timestampId) {
				timestamp = value;
			} else if (abs === PROP_TIMESCALE) {
				if (value === 0) {
					throw new Error("loc: timescale property must be non-zero");
				}
				timescale = value;
			}
		} else {
			const [len, afterLenInner] = Moq.Varint.decode(cursor);
			if (afterLenInner.byteLength < len) {
				throw new Error("loc: property length exceeds remaining bytes");
			}
			cursor = afterLenInner.subarray(len);
		}
	}

	if (timestamp === undefined) {
		throw new Error("loc: frame missing required timestamp property");
	}
	return { timestamp, timescale };
}

/** Convert a timestamp in `timescale` units (default µs) to microseconds. */
function toMicros(timestamp: number, timescale: number | undefined): Time.Micro {
	const activeTimescale = timescale ?? DEFAULT_TIMESCALE;
	return Math.round((timestamp * DEFAULT_TIMESCALE) / activeTimescale) as Time.Micro;
}

/** A payload that can be copied into a buffer without first materializing a Uint8Array. */
export interface Source {
	/** Size in bytes of the payload. */
	byteLength: number;
	/** Copy the payload into the provided buffer. */
	copyTo(buffer: Uint8Array): void;
}

/**
 * Encoder that packages frames as LOC and writes them to a moq-net track.
 *
 * Each call to {@link encode} produces one moq-net frame containing a
 * property block with the 0x06 timestamp (in microseconds) and the codec
 * bitstream payload.
 */
export class Producer {
	#track: Moq.Track;
	#group?: Moq.Group;

	constructor(track: Moq.Track) {
		this.#track = track;
	}

	/** Encode one frame and write it to the track. Keyframes start a new group. */
	encode(data: Uint8Array | Source, timestamp: Time.Micro, keyframe: boolean) {
		if (keyframe) {
			this.#group?.close();
			this.#group = this.#track.appendGroup();
		} else if (!this.#group) {
			throw new Error("must start with a keyframe");
		}

		this.#group?.writeFrame(this.#encode(data, timestamp));
	}

	#encode(source: Uint8Array | Source, timestamp: Time.Micro): Uint8Array {
		const propTypeBytes = Moq.Varint.encode(PROP_TIMESTAMP);
		const propValueBytes = Moq.Varint.encode(timestamp);
		const propsLen = propTypeBytes.byteLength + propValueBytes.byteLength;

		const propsLenBytes = Moq.Varint.encode(propsLen);

		const payloadSize = source.byteLength;
		const total = propsLenBytes.byteLength + propsLen + payloadSize;
		const out = new Uint8Array(total);

		let offset = 0;
		out.set(propsLenBytes, offset);
		offset += propsLenBytes.byteLength;
		out.set(propTypeBytes, offset);
		offset += propTypeBytes.byteLength;
		out.set(propValueBytes, offset);
		offset += propValueBytes.byteLength;

		const payloadView = out.subarray(offset);
		if (source instanceof Uint8Array) {
			payloadView.set(source);
		} else {
			source.copyTo(payloadView);
		}

		return out;
	}

	/** Close the current group and the underlying track, optionally with an error. */
	close(err?: Error) {
		this.#group?.close();
		this.#track.close(err);
	}
}
