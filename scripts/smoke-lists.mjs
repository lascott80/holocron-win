// Smoke script: nested lists render with clear, consistent indentation.
import fs from "node:fs";
import path from "node:path";

const NOTE = [
  "# Lists",
  "",
  "- First item",
  "  - Sub item (2 spaces)",
  "    - Sub-sub item (4 spaces)",
  "  - Another sub item with a long line that wraps around onto the next visual line to check the hanging indent works",
  "- Second item",
  "\t- Tab-indented sub item",
  "\t\t- Tab-indented sub-sub item",
  "",
  "1. Numbered",
  "   1. Nested numbered (3 spaces)",
  "   2. Second nested",
  "      - Bullet under numbered",
  "2. Numbered two",
  "",
  "- [ ] Task",
  "  - [ ] Sub task",
  "    - [x] Done sub-sub task",
  "",
].join("\n");

export default async function ({ page, shot, vault }) {
  fs.writeFileSync(path.join(vault, "Lists.md"), NOTE);
  await page.waitForTimeout(800);
  await page.evaluate(() => window.holocronHost.call("open", "Lists.md"));
  await page.waitForTimeout(1500);
  await page.evaluate(() => document.activeElement?.blur());
  await page.waitForTimeout(300);
  const lefts = await page.evaluate(() =>
    [...document.querySelectorAll(".cm-line")].slice(2, 21).map((line) => {
      const text = line.textContent.trim().slice(0, 28);
      const range = document.createRange();
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
      let node, first = null;
      while ((node = walker.nextNode())) if (node.textContent.trim()) { first = node; break; }
      if (!first) return { text, x: null };
      const offset = first.textContent.search(/\S/);
      range.setStart(first, offset); range.setEnd(first, offset + 1);
      return { text, x: Math.round(range.getBoundingClientRect().left) };
    }),
  );
  console.log(JSON.stringify(lefts, null, 0));
  await shot("lists");
  await page.locator(".cm-line", { hasText: "Sub-sub item" }).first().click();
  await page.keyboard.press("End");
  await page.keyboard.type(" — edited");
  await page.keyboard.press("Enter");
  await page.keyboard.type("new sibling");
  await page.waitForTimeout(400);
  console.log("after editing:", JSON.stringify((await page.evaluate(() => window.holocron.getText())).split("\n").slice(4, 6)));
  await shot("lists-editing");
  await page.evaluate(() => window.holocronHost.call("setSetting", "editorMode", "reading"));
  await page.waitForTimeout(600);
  await shot("lists-reading");
}
