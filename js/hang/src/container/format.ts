import type { Frame } from "./types";

/** A container format that decodes raw MoQ frames into media frames. */
export interface Format {
	/**
	 * Parse one MoQ frame into decoded media frames. `extensions` carries the raw
	 * MOQ Object Properties bytes (undefined when the object had none) — LOC reads
	 * its per-frame Timestamp from there (draft-ietf-moq-loc-03 §2.3); other
	 * formats ignore it.
	 */
	decode(frame: Uint8Array, extensions?: Uint8Array): Frame[];
}
