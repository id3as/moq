import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type * as Catalog from "@moq/hang/catalog";
import { Signal } from "@moq/signals";
import type { Decoder } from "./decoder";
import { Renderer } from "./renderer";

const flush = () => new Promise<void>((resolve) => queueMicrotask(resolve));

async function settle(): Promise<void> {
	for (let i = 0; i < 5; i++) await flush();
}

describe("Renderer", () => {
	let callbacks: Map<number, FrameRequestCallback>;
	let nextCallback: number;
	let originalRequest: PropertyDescriptor | undefined;
	let originalCancel: PropertyDescriptor | undefined;

	beforeEach(() => {
		callbacks = new Map();
		nextCallback = 0;
		originalRequest = Object.getOwnPropertyDescriptor(globalThis, "requestAnimationFrame");
		originalCancel = Object.getOwnPropertyDescriptor(globalThis, "cancelAnimationFrame");

		Object.defineProperty(globalThis, "requestAnimationFrame", {
			configurable: true,
			value: (callback: FrameRequestCallback) => {
				const id = ++nextCallback;
				callbacks.set(id, callback);
				return id;
			},
		});
		Object.defineProperty(globalThis, "cancelAnimationFrame", {
			configurable: true,
			value: (id: number) => callbacks.delete(id),
		});
	});

	afterEach(() => {
		if (originalRequest) Object.defineProperty(globalThis, "requestAnimationFrame", originalRequest);
		else Reflect.deleteProperty(globalThis, "requestAnimationFrame");

		if (originalCancel) Object.defineProperty(globalThis, "cancelAnimationFrame", originalCancel);
		else Reflect.deleteProperty(globalThis, "cancelAnimationFrame");
	});

	function paint(): number {
		const pending = [...callbacks.values()];
		callbacks.clear();
		for (const callback of pending) callback(0);
		return pending.length;
	}

	it("repaints the current frame when presentation metadata changes", async () => {
		const transforms: number[][] = [];
		const draws: unknown[][] = [];
		let context: CanvasRenderingContext2D;
		const canvas = {
			width: 640,
			height: 360,
			getContext: () => context,
		} as unknown as HTMLCanvasElement;

		context = {
			canvas,
			fillStyle: "",
			save: () => {},
			restore: () => {},
			fillRect: () => {},
			scale: () => {},
			translate: () => {},
			setTransform: (...matrix: number[]) => transforms.push(matrix),
			drawImage: (...args: unknown[]) => draws.push(args),
		} as unknown as CanvasRenderingContext2D;

		const frame = {
			timestamp: 1_000,
			clone() {
				return this;
			},
			close() {},
		} as unknown as VideoFrame;
		const catalog = new Signal<Catalog.Video | undefined>({ renditions: {}, rotation: 0 });
		const decoder = {
			out: {
				display: new Signal({ width: 640, height: 360 }),
				frame: new Signal<VideoFrame | undefined>(frame),
			},
			source: { out: { catalog } },
		} as unknown as Decoder;
		const renderer = new Renderer({ decoder, canvas, visible: "never" });

		try {
			await settle();
			expect(paint()).toBe(1);
			expect(draws).toHaveLength(1);

			catalog.set({ renditions: {}, rotation: 90 });
			await settle();

			expect(paint()).toBe(1);
			expect(draws).toHaveLength(2);
			expect(transforms.at(-1)).toEqual([0, 1, -1, 0, 640, 0]);
			expect(draws.at(-1)?.slice(1)).toEqual([0, 0, 360, 640]);
		} finally {
			renderer.close();
		}
	});

	// "tab" downloads wherever the canvas is (Studio's off-screen monitor tiles
	// need that) but, unlike "always", stops once the tab has been hidden for
	// the grace, so a backgrounded player does not build a backlog to
	// fast-forward through on return.
	describe('visible "tab"', () => {
		class FakeDoc extends EventTarget {
			hidden = false;
			set(hidden: boolean) {
				this.hidden = hidden;
				this.dispatchEvent(new Event("visibilitychange"));
			}
		}
		const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
		const decoder = () =>
			({
				out: { display: new Signal(undefined), frame: new Signal<VideoFrame | undefined>(undefined) },
				source: { out: { catalog: new Signal(undefined) } },
			}) as unknown as Decoder;

		it("downloads while the tab is visible, and stops once it has been hidden for the grace", async () => {
			const doc = new FakeDoc();
			const renderer = new Renderer({ decoder: decoder(), visible: "tab", document: doc, hiddenGrace: 20 });
			try {
				await settle();
				expect(renderer.out.visible.peek()).toBe(true);
				doc.set(true);
				await wait(5);
				expect(renderer.out.visible.peek()).toBe(true);
				await wait(40);
				expect(renderer.out.visible.peek()).toBe(false);
				doc.set(false);
				await settle();
				expect(renderer.out.visible.peek()).toBe(true);
			} finally {
				renderer.close();
			}
		});

		it('"always" still ignores the tab', async () => {
			const doc = new FakeDoc();
			doc.hidden = true;
			const renderer = new Renderer({ decoder: decoder(), visible: "always", document: doc, hiddenGrace: 1 });
			try {
				await wait(10);
				expect(renderer.out.visible.peek()).toBe(true);
			} finally {
				renderer.close();
			}
		});
	});
});
