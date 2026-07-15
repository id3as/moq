import { Effect, type Getter, getter, type Inputs, type Readonlys, readonlys, Signal } from "@moq/signals";
import type { Decoder } from "./decoder";

const MIN_GAIN = 0.001;
const FADE_TIME = 0.2;

export type EmitterInput = {
	volume: Getter<number>;

	// Silences the audio and stops the download. Muted samples aren't worth the bandwidth,
	// and the decoder keeps the AudioContext warm so unmuting is still instant.
	muted: Getter<boolean>;

	// Pauses playback, which also stops the download.
	paused: Getter<boolean>;
};

type EmitterOutput = {
	// Whether audio should be downloaded. Wired into the decoder's `enabled` input by the owner.
	enabled: Signal<boolean>;
};

// A helper that emits audio directly to the speakers.
export class Emitter {
	readonly source: Decoder;

	readonly in: Readonlys<EmitterInput>;

	readonly #out: EmitterOutput = {
		enabled: new Signal<boolean>(false),
	};
	readonly out = readonlys(this.#out);

	#signals = new Effect();

	// The gain node used to adjust the volume.
	#gain = new Signal<GainNode | undefined>(undefined);

	constructor(source: Decoder, props?: Inputs<EmitterInput>) {
		this.source = source;
		this.in = {
			volume: getter(props?.volume ?? 0.5),
			muted: getter(props?.muted ?? false),
			paused: getter(props?.paused ?? false),
		};

		// Only download while playing. `paused` gates whether we download/decode
		// audio at all; `muted` only silences the gain (see the field comments).
		// Folding `muted` in here would disable the source, freezing the audio
		// clock — and, once audio is the sync reference, stalling the video on a
		// spinner.
		this.#signals.run((effect) => {
			const enabled = !effect.get(this.in.paused);
			this.#out.enabled.set(enabled);
		});

		this.#signals.run((effect) => {
			const root = effect.get(this.source.out.root);
			if (!root) return;

			const gain = new GainNode(root.context, { gain: effect.get(this.in.volume) });
			root.connect(gain);

			effect.set(this.#gain, gain);

			effect.run((inner) => {
				// We only connect/disconnect when enabled to save power.
				// Otherwise the worklet keeps running in the background returning 0s.
				const enabled = inner.get(this.#out.enabled);
				if (!enabled) return;

				gain.connect(root.context.destination); // speakers
				inner.cleanup(() => gain.disconnect());
			});
		});

		// Resume the AudioContext when unmuted. Browsers block autoplay until a
		// user gesture, and unmuting is that gesture. We keep the source enabled
		// through mute (so the sync clock never stalls the video), which means the
		// decoder's enable-driven resume no longer re-fires on unmute — so drive
		// the resume from the mute state here instead.
		this.#signals.run((effect) => {
			const root = effect.get(this.source.out.root);
			if (!root) return;
			if (effect.get(this.in.muted)) return;
			// root.context is typed BaseAudioContext; the decoder always creates a
			// full AudioContext, which is the one with resume().
			const context = root.context as AudioContext;
			if (context.state === "suspended") void context.resume();
		});

		this.#signals.run((effect) => {
			const gain = effect.get(this.#gain);
			if (!gain) return;

			// Cancel any scheduled transitions on change.
			effect.cleanup(() => gain.gain.cancelScheduledValues(gain.context.currentTime));

			const volume = effect.get(this.in.volume);
			if (volume < MIN_GAIN) {
				gain.gain.exponentialRampToValueAtTime(MIN_GAIN, gain.context.currentTime + FADE_TIME);
				gain.gain.setValueAtTime(0, gain.context.currentTime + FADE_TIME + 0.01);
			} else {
				gain.gain.exponentialRampToValueAtTime(volume, gain.context.currentTime + FADE_TIME);
			}
		});
	}

	close() {
		this.#signals.close();
	}
}
