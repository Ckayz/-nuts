import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { RailTabs, TabHeading, tabKey } from "@/components/feed/rail-tabs";
import { CalloutTabs } from "@/components/feed/callout-tabs";
import { trending, ending, settled } from "../view-data";
test("rail tabs render initial list and ARIA linkage", () => {
 const html = renderToStaticMarkup(<RailTabs {...{ trending, ending, settled }} />);
 expect(html).toContain('role="tablist"');
 expect(html.match(/role="tab"/g)).toHaveLength(3);
 expect(html.match(/aria-selected="true"/g)).toHaveLength(1);
 expect(html).toContain('role="tabpanel"');
 expect(html).toContain(`/t/${trending[0]!.slug}`);
 expect(html).toContain("Ending"); expect(html).toContain("Settled");
});
test("callout tabs render the named labels without a wallet", () => {
 const html = renderToStaticMarkup(<CalloutTabs theses={[]} following={[]} top={[]} signedIn={false} databaseMode={false} />);
 for (const label of ["Callouts", "Following", "Top"]) expect(html).toContain(label);
 expect(html.match(/role="tab"/g)).toHaveLength(3);
});
for (const labels of [["Trending", "Ending", "Settled"], ["Callouts", "Following", "Top"]]) {
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
