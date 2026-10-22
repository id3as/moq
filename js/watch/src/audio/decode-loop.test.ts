import { beforeAll, describe, expect, it } from "bun:test";
import { AudioDecodeLoop } from "./decode-loop";

// Bun has no WebCodecs: a chunk only needs to carry what it was made with.
beforeAll(() => {
	(globalThis as { EncodedAudioChunk?: unknown }).EncodedAudioChunk ??= class {
		type: string;
		timestamp: number;
		constructor(init: { type: string; timestamp: number }) {
			this.type = init.type;
			this.timestamp = init.timestamp;
		}
	};
});

type Chunk = { type: string; timestamp: number };

// Stands in for an AudioDecoder: records what it decodes, and can be told to
// refuse a chunk (decode() throws) or to fail fatally (it closes itself).
class FakeDecoder {
	state: "unconfigured" | "configured" | "closed" = "unconfigured";
	decoded: Chunk[] = [];
	refuse = new Set<number>();
	failAt = new Set<number>();
	configures = 0;
	resets = 0;

	configure(): void {
		this.state = "configured";
		this.configures++;
	}
	reset(): void {
		this.state = "unconfigured";
		this.resets++;
	}
	close(): void {
		this.state = "closed";
	}
	decode(chunk: Chunk): void {
		if (this.state !== "configured") throw new DOMException("not configured", "InvalidStateError");
		if (this.refuse.has(chunk.timestamp)) throw new DOMException("refused", "DataError");
		if (this.failAt.has(chunk.timestamp)) {
			this.close();
			return;
		}
		this.decoded.push(chunk);
	}
}

function setup() {
	const decoders: FakeDecoder[] = [];
	const warnings: Record<string, unknown>[] = [];
	const loop = new AudioDecodeLoop({
		create: () => {
			const d = new FakeDecoder();
			decoders.push(d);
			return d as unknown as AudioDecoder;
		},
		config: { codec: "mp4a.40.2", sampleRate: 48000, numberOfChannels: 2 },
		warn: (_message, detail) => warnings.push(detail),
	});
	const frame = (timestamp: number) => ({ payload: new Uint8Array([0x21, 0x19, timestamp & 0xff]), timestamp });
	const decoded = () => decoders.flatMap((d) => d.decoded.map((c) => c.timestamp));
	return { loop, decoders, warnings, frame, decoded };
}

describe("AudioDecodeLoop", () => {
	it("decodes every frame it is given, as key chunks", () => {
		const { loop, decoders, frame, decoded } = setup();
		for (const t of [0, 1, 2]) loop.decode(frame(t));
		expect(decoded()).toEqual([0, 1, 2]);
		expect(decoders[0].decoded.every((c) => c.type === "key")).toBe(true);
	});

	it("skips a chunk decode() refuses, reports it, and decodes the frames after it", () => {
		const { loop, decoders, warnings, frame, decoded } = setup();
		decoders[0].refuse.add(1);
		for (const t of [0, 1, 2, 3]) loop.decode(frame(t));
		expect(decoded()).toEqual([0, 2, 3]);
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toMatchObject({ timestamp: 1, bytes: 3, codec: "mp4a.40.2", head: "211901" });
		expect(String(warnings[0].error)).toContain("DataError");
	});

	it("replaces a decoder a fatal error has closed, and carries on", () => {
		const { loop, decoders, frame, decoded } = setup();
		decoders[0].failAt.add(1);
		for (const t of [0, 1, 2, 3]) loop.decode(frame(t));
		expect(decoders).toHaveLength(2);
		expect(decoded()).toEqual([0, 2, 3]);
	});

	it("reconfigures after a reset, so the next frame decodes", () => {
		const { loop, decoders, frame, decoded } = setup();
		loop.decode(frame(0));
		loop.reset();
		loop.decode(frame(1));
		expect(decoders[0].resets).toBe(1);
		expect(decoders[0].configures).toBe(2);
		expect(decoded()).toEqual([0, 1]);
	});

	it("does nothing once closed", () => {
		const { loop, decoders, frame, decoded } = setup();
		loop.close();
		loop.decode(frame(0));
		expect(decoders).toHaveLength(1);
		expect(decoded()).toEqual([]);
	});
});
