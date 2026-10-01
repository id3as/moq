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
 * An in-payload property block is therefore neither written nor parsed. A
 * conformant peer cannot read one, and moq-net already writes the object-header
 * Timestamp for every frame, so writing both put the timestamp on the wire twice
 * and handed the leftover block to a conformant receiver's decoder as codec bytes.
 * shaka-player (`lib/msf/loc_parser.js`) reads the header properties and passes
 * the payload through untouched, and documents removing its own in-payload strip
 * because such a block **cannot be distinguished from codec data**: the first
 * byte of a stereo AAC-LC `raw_data_block` reads as a plausible property count.
 *
 * @module
 */

import type * as Moq from "@moq/net";
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
 * into the frame's timestamp (in the track's declared timescale, or an
 * object-scope Timescale 0x08 override). The payload is returned unchanged.
 */
export class Format {
	/** The kind of content carried by the track. */
	readonly kind: "audio" | "video" | "data";

	/** Configure endpoint metadata for audio or video; opaque data is the default. */
	constructor(kind: "audio" | "video" | "data" = "data") {
		this.kind = kind;
	}

	/** Return the video-frame or audio-source endpoint for an empty codec payload. */
	end(frame: Frame): Time.Micro | undefined {
		return this.kind !== "data" && frame.payload.byteLength === 0 ? frame.timestamp : undefined;
	}

	/** Decode one moq-net frame into its LOC frames. */
	decode(frame: Moq.Group.Frame): Frame[] {
		// NOTE: this cannot detect an object that carried no Timestamp at all.
		// moq-net's IETF subscriber substitutes `Timestamp.now()` for a missing one
		// (`ietf/subscriber.ts`), so the timing is always present here and may be
		// wall-clock rather than media time. shaka-player instead falls back to
		// `group x frameDuration` from the catalog, which needs the group number
		// plumbed through to here.
		return [{ payload: frame.payload, timestamp: frame.timestamp.asMicros() as Time.Micro, keyframe: false }];
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
