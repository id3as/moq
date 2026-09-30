import { expect, test } from "bun:test";
import { AudioConfigSchema } from "./audio.ts";

test("pcm codec is accepted", () => {
	const config = AudioConfigSchema.parse({
		codec: "pcm",
		container: { kind: "legacy" },
		sampleRate: 48_000,
		numberOfChannels: 2,
		bitrate: 3_072_000,
	});

	expect(config.codec).toBe("pcm");
});

test("keeps an audio rendition's language (RFC 5646), for a player to choose by", () => {
	const config = AudioConfigSchema.parse({
		codec: "mp4a.40.2",
		container: { kind: "legacy" },
		sampleRate: 48_000,
		numberOfChannels: 2,
		language: "spa",
	});
	expect(config.language).toBe("spa");
	const none = AudioConfigSchema.parse({
		codec: "mp4a.40.2",
		container: { kind: "legacy" },
		sampleRate: 48_000,
		numberOfChannels: 2,
	});
	expect(none.language).toBeUndefined();
});
