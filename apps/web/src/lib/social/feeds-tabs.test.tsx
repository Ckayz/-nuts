import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { TabHeading, tabKey } from "@/components/feed/tabs";
import { CalloutTabs } from "@/components/feed/callout-tabs";
import type { RankedTheses } from "@/lib/page-data";

const EMPTY: RankedTheses = { trending: [], ending: [], settled: [] };

// Round-1 fold items 4 and 5: ONE post list under both controls, and the first
// audience tab reads "All" as the mockup writes it — not "Callouts".
test("the feed renders both controls: audience tabs and ranking pills", () => {
 const html = renderToStaticMarkup(<CalloutTabs ranked={EMPTY} following={[]} top={[]} signedIn={false} databaseMode={false} />);
 for (const label of ["All", "Following", "Top", "Trending", "Ending", "Settled"]) expect(html).toContain(label);
 expect(html).not.toContain("Callouts");
 expect(html.match(/role="tablist"/g)).toHaveLength(1);
 expect(html.match(/role="tab"/g)).toHaveLength(3);
 expect(html.match(/aria-selected="true"/g)).toHaveLength(1);
 expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
 expect(html.match(/aria-pressed="false"/g)).toHaveLength(2);
 // ONE list: a single panel, not one per control.
 expect(html.match(/role="tabpanel"/g)).toHaveLength(1);
});
for (const labels of [["Trending", "Ending", "Settled"], ["All", "Following", "Top"]]) {
 test(`${labels[0]} keyboard wraps and handles Home/End with roving tabindex`, () => {
  let selected = 0;
  for (const [key, expected] of [["ArrowLeft", 2], ["ArrowRight", 0], ["End", 2], ["Home", 0], ["ArrowRight", 1]] as const) {
   const next = tabKey(key, selected, labels.length);
   expect(next).toBe(expected); selected = next!;
   const html = renderToStaticMarkup(<TabHeading id="test" labels={labels} selected={selected} onSelect={() => {}} />);
   expect(html).toContain(`id="test-tab-${expected}" role="tab" aria-selected="true" aria-controls="test-panel" tabindex="0"`);
   expect(html.match(/tabindex="-1"/g)).toHaveLength(2);
  }
  expect(tabKey("Tab", selected, labels.length)).toBeNull();
  expect(tabKey("Enter", selected, labels.length)).toBeNull();
 });
}

test("actual tab handlers select on click and move focus on keyboard navigation", () => {
 let selected = 0;
 let focused = -1;
 let prevented = false;
 const labels = ["Trending", "Ending", "Settled"];
 const heading = TabHeading({ id: "handlers", labels, selected, onSelect: index => { selected = index; } });
 const event = {
  key: "ArrowLeft", preventDefault: () => { prevented = true; },
  currentTarget: { parentElement: { querySelectorAll: () => labels.map((_, index) => ({ focus: () => { focused = index; } })) } },
 };
 // A structural event fixture supplies exactly the fields this handler reads.
 const buttons: import("react").ReactElement<{ onKeyDown: (input: typeof event) => void; onClick: () => void }>[] = heading.props.children;
 buttons[0]?.props.onKeyDown?.(event);
 expect(selected).toBe(2); expect(focused).toBe(2); expect(prevented).toBe(true);
 buttons[1]?.props.onClick?.();
 expect(selected).toBe(1);
});


test("db feed omits the fixture new-post banner", () => {
 const html = renderToStaticMarkup(<CalloutTabs ranked={EMPTY} following={[]} top={[]} signedIn databaseMode />);
 expect(html).not.toContain("9 new");
 expect(html).not.toContain('class="newbar"');
});
