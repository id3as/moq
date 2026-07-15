import { Effect, Signal } from "@moq/signals";
import type { Decoder } from "./decoder";

const MIN_GAIN = 0.001;
const FADE_TIME = 0.2;

export type EmitterProps = {
	volume?: number | Signal<number>;
	muted?: boolean | Signal<boolean>;
	paused?: boolean | Signal<boolean>;
};

// A helper that emits audio directly to the speakers.
export class Emitter {
	source: Decoder;
	volume: Signal<number>;
	muted: Signal<boolean>;

	// Similar to muted, but controls whether we download audio at all.
	// That way we can be "muted" but also download audio for visualizations.
	paused: Signal<boolean>;

	#signals = new Effect();

	// The volume to use when unmuted.
	#unmuteVolume = 0.5;

	// The gain node used to adjust the volume.
	#gain = new Signal<GainNode | undefined>(undefined);

	constructor(source: Decoder, props?: EmitterProps) {
		this.source = source;
		this.volume = Signal.from(props?.volume ?? 0.5);
		this.muted = Signal.from(props?.muted ?? false);
		this.paused = Signal.from(props?.paused ?? props?.muted ?? false);

		// Set the volume to 0 when muted.
		this.#signals.run((effect) => {
			const muted = effect.get(this.muted);
			if (muted) {
				this.#unmuteVolume = this.volume.peek() || 0.5;
				this.volume.set(0);
			} else {
				this.volume.set(this.#unmuteVolume);
			}
		});

		this.#signals.run((effect) => {
			// `paused` gates whether we download/decode audio at all; `muted` only
			// silences the gain (see field comments above). Folding `muted` in here
			// would disable the source, freezing the audio clock — and, once audio
			// is the sync reference, stalling the video on a spinner.
			const enabled = !effect.get(this.paused);
			this.source.enabled.set(enabled);
		});

		// Set unmute when the volume is non-zero.
		this.#signals.run((effect) => {
			const volume = effect.get(this.volume);
			this.muted.set(volume === 0);
		});

		this.#signals.run((effect) => {
			const root = effect.get(this.source.root);
			if (!root) return;

			const gain = new GainNode(root.context, { gain: effect.get(this.volume) });
			root.connect(gain);

			effect.set(this.#gain, gain);

			effect.run((inner) => {
				// We only connect/disconnect when enabled to save power.
				// Otherwise the worklet keeps running in the background returning 0s.
				const enabled = inner.get(this.source.enabled);
				if (!enabled) return;

				gain.connect(root.context.destination); // speakers
				inner.cleanup(() => gain.disconnect());
			});
		});

		// Resume the AudioContext when unmuted. Browsers block autoplay until a
		// user gesture, and unmuting is that gesture. We keep `source.enabled`
		// true through mute (so the sync clock never stalls the video), which
		// means the decoder's enable-driven resume no longer re-fires on unmute —
		// so drive the resume from the mute state here instead.
		this.#signals.run((effect) => {
			const root = effect.get(this.source.root);
			if (!root) return;
			if (effect.get(this.muted)) return;
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

			const volume = effect.get(this.volume);
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
