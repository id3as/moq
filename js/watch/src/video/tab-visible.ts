import { Effect, type Getter, getter, Signal } from "@moq/signals";

/** What TabVisible watches: `document`, or a stand-in with the same event and flag. */
export type VisibilitySource = EventTarget & { readonly hidden: boolean };

/** Constructor properties for {@link TabVisible}. */
export type TabVisibleProps = {
	/** The document to watch. Defaults to the global `document`. */
	doc?: VisibilitySource;
	/** How long, in milliseconds, the tab must stay hidden before it counts as invisible. Defaults to 5000. */
	grace?: Getter<number> | number;
};

/**
 * Whether the tab counts as visible: true while it is shown, and false only once it has been
 * hidden for the grace period.
 *
 * A background tab is throttled, so video that keeps downloading cannot be rendered in time,
 * and on return the player fast-forwards through the backlog. Turning video off once the tab
 * has been away for a while means it comes back at the live edge, while the grace keeps a
 * quick flip to another tab and back from interrupting it.
 */
export class TabVisible {
	readonly visible: Signal<boolean>;

	readonly #hidden: Signal<boolean>;
	readonly #grace: Getter<number>;
	readonly #signals = new Effect();

	constructor(props: TabVisibleProps = {}) {
		const doc = props.doc ?? (globalThis.document as VisibilitySource | undefined);
		this.#hidden = new Signal(doc?.hidden ?? false);
		// Nothing is playing yet when the tab starts hidden, so there is nothing to hold on to.
		this.visible = new Signal(!this.#hidden.peek());
		this.#grace = getter(props.grace ?? 5000);

		if (doc) {
			this.#signals.event(doc, "visibilitychange", () => this.#hidden.set(doc.hidden));
		}

		this.#signals.run((effect) => {
			const hidden = effect.get(this.#hidden);
			if (!hidden) {
				this.visible.set(true);
				return;
			}
			effect.timer(() => this.visible.set(false), effect.get(this.#grace));
		});
	}

	close(): void {
		this.#signals.close();
	}
}
