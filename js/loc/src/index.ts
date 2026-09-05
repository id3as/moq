/**
 * Low Overhead Container (LOC): codec bitstreams framed with per-frame timing
 * carried as MOQ Object Properties, per draft-ietf-moq-loc-04.
 *
 * LOC has two property scopes and only one of them is ours to write. §6.1 puts
 * the *Public* Properties — Timestamp (0x10), Timescale (0x08), VideoConfig
 * (0x0D) — in the **MOQ Object Properties on the object header**, and leaves the
 * object payload as the bare codec bitstream. The *Private* Properties block that
 * rides inside the payload belongs to Secure Objects (§3.1.3), not to plain LOC.
 *
 * This module used to do the opposite: it wrote a length-prefixed property block
 * into the payload and parsed one back out. Nothing that follows the draft could
 * read it, and it double-stamped — moq-net already writes an object-header
 * Timestamp for any frame carrying one, so the timestamp went on the wire twice
 * and a conformant receiver read the header copy and then handed the leftover
 * property block to its decoder as codec bytes.
 *
 * shaka-player (`lib/msf/loc_parser.js`) reads the header properties and passes
 * the payload through untouched, and documents removing its own in-payload strip
 * because such a block **cannot be distinguished from codec data**: the first byte
 * of a stereo AAC-LC `raw_data_block` reads as a plausible property count, so
 * stripping silently truncates good media. We follow it.
 *
 * @module
 */

import * as Moq from "@moq/net";
import { Time } from "@moq/net";

/** A decoded LOC frame: the codec bitstream plus its timing metadata. */
export interface Frame {
	/** The codec bitstream payload, exactly as it arrived. */
	payload: Uint8Array;
	/** Presentation timestamp in microseconds. */
	timestamp: Time.Micro;
	/** True if this frame can be decoded without any preceding frames. */
	keyframe: boolean;
}

/**
 * Decoder for LOC (draft-ietf-moq-loc-04).
 *
 * The timing is read from the object header, which moq-net has already decoded
 * into {@link Moq.Frame.timestamp} — it accepts the registered Timestamp id 0x10
 * and draft-02's 0x06, and honours an object-scope Timescale (0x08) as an
 * override. The payload is returned unchanged.
 */
export class Format {
	/** Decode one moq-net frame into its LOC frames. */
	decode(frame: Moq.Group.Frame): Frame[] {
		// NOTE: this cannot detect an object that carried no Timestamp at all.
		// moq-net's IETF subscriber substitutes `Timestamp.now()` for a missing one
		// (`ietf/subscriber.ts`), so by the time a frame reaches here the timing is
		// always present and may be wall-clock rather than media time. shaka-player
		// instead falls back to `group x frameDuration` from the catalog, which is
		// the better behaviour and needs the group number plumbed through to here.
		return [
			{
				payload: frame.payload,
				timestamp: frame.timestamp.asMicros() as Time.Micro,
				keyframe: false,
			},
		];
	}
}

/** A payload that can be copied into a buffer without first materializing a Uint8Array. */
export interface Source {
	/** Size in bytes of the payload. */
	byteLength: number;
	/** Copy the payload into the provided buffer. */
	copyTo(buffer: Uint8Array): void;
}

/**
 * Encoder that writes frames to a moq-net track as LOC.
 *
 * The payload written is the bare codec bitstream; the Timestamp rides the object
 * header, written by moq-net from the frame's timestamp.
 *
 * **The track must declare a microsecond timescale.** moq-net converts a frame's
 * timestamp into the *track's* timescale before writing the property and does not
 * write a Timescale of its own, so a track left on the default of milliseconds
 * puts a millisecond count on the wire under an id that means microseconds. Pass
 * `{ timescale: Time.Timescale.MICRO }` to `accept()`; {@link Producer} asserts it.
 */
export class Producer {
	#track: Moq.Track.Producer;
	#group?: Moq.Group.Producer;

	constructor(track: Moq.Track.Producer) {
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

		this.#group?.writeFrame({
			payload: data instanceof Uint8Array ? data : copy(data),
			timestamp: Time.Timestamp.fromMicros(timestamp),
		});
	}

	/** Close the current group and the underlying track, optionally with an error. */
	close(err?: Error) {
		this.#group?.close();
		this.#track.close(err);
	}
}

function copy(source: Source): Uint8Array {
	const out = new Uint8Array(source.byteLength);
	source.copyTo(out);
	return out;
}
