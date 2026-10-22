/** A decoder a decode loop owns, and keeps decoding through a chunk it refuses. */
export interface AudioDecodeLoopProps {
	/** Make a new (unconfigured) decoder; called again to replace one an error has closed. */
	create: () => AudioDecoder;
	/** What every decoder is configured with, and reconfigured with after a reset. */
	config: AudioDecoderConfig;
	/** Where a refused chunk is reported. */
	warn?: (message: string, detail: Record<string, unknown>) => void;
}

/** One audio frame to decode. */
export interface AudioDecodeFrame {
	payload: Uint8Array;
	timestamp: number;
}

/**
 * Keeps an audio decode loop decoding.
 *
 * `decode()` throws synchronously on a chunk it will not take (a DataError for a
 * malformed one, or a delta where a key chunk is required), and a fatal decode
 * error closes the decoder. Either used to end the loop, and with it playback,
 * while audio kept arriving. Here a refused chunk is reported and skipped with
 * the decoder reset, and a closed decoder is replaced before the next frame.
 *
 * Every chunk is fed as a key chunk: an audio frame decodes on its own, so a
 * reset never leaves the decoder refusing frames while it waits for one.
 */
export class AudioDecodeLoop {
	#props: AudioDecodeLoopProps;
	#decoder: AudioDecoder;
	#closed = false;

	constructor(props: AudioDecodeLoopProps) {
		this.#props = props;
		this.#decoder = this.#open();
	}

	/** Drop decoder state, for a new epoch (a discontinuity or rewind). */
	reset(): void {
		if (this.#decoder.state === "closed") {
			this.#decoder = this.#open();
			return;
		}
		this.#decoder.reset();
		this.#decoder.configure(this.#props.config);
	}

	/** Decode one frame, surviving a refusal. Does nothing once closed. */
	decode(frame: AudioDecodeFrame): void {
		if (this.#closed) return;
		if (this.#decoder.state === "closed") this.#decoder = this.#open();
		const chunk = new EncodedAudioChunk({ type: "key", data: frame.payload, timestamp: frame.timestamp });
		try {
			this.#decoder.decode(chunk);
		} catch (error) {
			const { config } = this.#props;
			(this.#props.warn ?? defaultWarn)("audio decode refused a chunk; skipping it", {
				error: String(error),
				bytes: frame.payload.byteLength,
				head: toHex(frame.payload.subarray(0, 16)),
				timestamp: frame.timestamp,
				state: this.#decoder.state,
				codec: config.codec,
				sampleRate: config.sampleRate,
				numberOfChannels: config.numberOfChannels,
				description: config.description ? toHex(bytesOf(config.description)) : undefined,
			});
			this.reset();
		}
	}

	/** Close the decoder for good. */
	close(): void {
		this.#closed = true;
		if (this.#decoder.state !== "closed") this.#decoder.close();
	}

	#open(): AudioDecoder {
		const decoder = this.#props.create();
		decoder.configure(this.#props.config);
		return decoder;
	}
}

function defaultWarn(message: string, detail: Record<string, unknown>): void {
	console.warn(message, JSON.stringify(detail));
}

function bytesOf(source: AllowSharedBufferSource): Uint8Array {
	if (source instanceof Uint8Array) return source;
	if (ArrayBuffer.isView(source)) return new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
	return new Uint8Array(source);
}

function toHex(bytes: Uint8Array): string {
	return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
