import type * as Moq from "@moq/net";
import type { Time } from "@moq/net";
import type { Format as ContainerFormat } from "../format";
import type { Frame } from "../types";
import { decodeDataSegment, type InitSegment } from "./decode";

/** CMAF container format: decodes each MoQ frame as a moof+mdat fragment using the parsed init segment. */
export class Format implements ContainerFormat {
	#init: InitSegment;

	/** Create a format bound to the given parsed init segment (timescale, codec defaults). */
	constructor(init: InitSegment) {
		this.#init = init;
	}

	/** Decode one CMAF fragment into its media frames. */
	decode(frame: Moq.Group.Frame): Frame[] {
		// CMAF timing comes from the moof, so the object-header timestamp is not used.
		return decodeDataSegment(frame.payload, this.#init).map((s) => ({
			payload: s.data,
			timestamp: s.timestamp as Time.Micro,
			keyframe: s.keyframe,
			duration: s.duration as Time.Micro,
		}));
	}
}
