import { describe, expect, it } from "bun:test";
import { TabVisible } from "./tab-visible";

// A throttled background tab kept receiving video it could not render in time,
// and on return the player fast-forwarded through the backlog. Video stops once
// the tab has been hidden for the grace, and a quick flip away and back within
// it does not interrupt playback at all.
class FakeDoc extends EventTarget {
	hidden = false;
	set(hidden: boolean) {
		this.hidden = hidden;
		this.dispatchEvent(new Event("visibilitychange"));
	}
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("TabVisible", () => {
	it("is visible while the tab is", async () => {
		const tab = new TabVisible({ doc: new FakeDoc(), grace: 20 });
		await wait(5);
		expect(tab.visible.peek()).toBe(true);
		tab.close();
	});

	it("turns invisible only once the tab has been hidden for the grace", async () => {
		const doc = new FakeDoc();
		const tab = new TabVisible({ doc, grace: 30 });
		doc.set(true);
		await wait(10);
		expect(tab.visible.peek()).toBe(true);
		await wait(40);
		expect(tab.visible.peek()).toBe(false);
		tab.close();
	});

	it("a quick flip away and back stays visible", async () => {
		const doc = new FakeDoc();
		const tab = new TabVisible({ doc, grace: 30 });
		doc.set(true);
		await wait(10);
		doc.set(false);
		await wait(50);
		expect(tab.visible.peek()).toBe(true);
		tab.close();
	});

	it("is visible again as soon as the tab is shown", async () => {
		const doc = new FakeDoc();
		const tab = new TabVisible({ doc, grace: 10 });
		doc.set(true);
		await wait(30);
		doc.set(false);
		await wait(5);
		expect(tab.visible.peek()).toBe(true);
		tab.close();
	});

	// Nothing is playing yet, so there is nothing to hold on to.
	it("a tab hidden from the start is invisible at once", async () => {
		const doc = new FakeDoc();
		doc.hidden = true;
		const tab = new TabVisible({ doc, grace: 1000 });
		await wait(5);
		expect(tab.visible.peek()).toBe(false);
		tab.close();
	});
});
