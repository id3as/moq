import type * as Moq from "@moq/net";
import type { Time } from "@moq/net";
import type { Frame } from "./types";

/**
 * A container format that decodes MoQ frames into media frames.
 *
 * `decode` takes the whole {@link Moq.Frame}, not just its bytes, because a
 * container's timing may live in the MOQ Object Properties on the object header
 * rather than in the payload — which is exactly where draft-ietf-moq-loc-04 §6.1
 * puts LOC's. A `Uint8Array`-only signature cannot express that, and LOC used to
 * work around it by writing a property block into the payload, which no
 * conformant peer can read.
 */
export interface Format {
	/** Parse one MoQ frame — payload plus object-header timing — into media frames. */
	decode(frame: Moq.Group.Frame): Frame[];
	/** Return the exclusive media endpoint when `frame` is a container marker. */
	end?(frame: Frame): Time.Micro | undefined;
}
