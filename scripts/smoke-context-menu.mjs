// Smoke script: the editor / text-field right-click menu. Spelling
// suggestions and Add to Dictionary, rich Copy through the menu, link, tag,
// diagram and image items, reading view (no Cut/Paste), the sidebar search
// field (edit items only) and the file tree's own menu.
import fs from "node:fs";
import path from "node:path";

const NOTE = `# Context menu

Spelling:

Dictionary:

See [[Linked Note]] and #project/alpha and [a link](https://example.com).

Plain words for **copying** here.

\`\`\`mermaid
flowchart LR
  A[Right-click] --> B[Menu]
\`\`\`

![[dot.png|120]]

Last line.
`;


export default async function ({ app, page, shot, vault }) {
  fs.writeFileSync(path.join(vault, "Context.md"), NOTE);
  fs.writeFileSync(path.join(vault, "Spelling.md"), "# Spelling\n\nSpelling:\n\nDictionary:\n\nLast line.\n");
  fs.copyFileSync(path.resolve("resources/icon.png"), path.join(vault, "dot.png"));
  await page.waitForTimeout(800);
  // Spelling first, in a short note: in a note taller than the window with a
  // diagram and an image, Chromium didn't mark typed misspellings at all.
  await page.evaluate(() => window.holocronHost.call("open", "Spelling.md"));
  await page.waitForTimeout(2000);

  const results = [];
  const check = (name, ok, detail = "") => {
    results.push(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  };
  const labels = () => page.evaluate(() => [...document.querySelectorAll(".menu .menu-item .menu-label")].map((el) => el.textContent));
  const menuOpen = () => page.evaluate(() => document.querySelector(".menu") !== null);
  const closeMenu = async () => {
    if (await menuOpen()) await page.keyboard.press("Escape");
    await page.waitForTimeout(150);
  };
  const clickItem = async (label) => {
    const box = await page.evaluate((label) => {
      const item = [...document.querySelectorAll(".menu .menu-item")].find((el) => el.querySelector(".menu-label")?.textContent === label);
      if (!item) return null;
      const r = item.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, label);
    if (!box) throw new Error(`No menu item “${label}”: ${(await labels()).join(" | ")}`);
    await page.mouse.move(box.x, box.y);
    await page.waitForTimeout(150);
    await page.mouse.click(box.x, box.y);
    await page.waitForTimeout(300);
  };
  /** Centre of `word`'s first occurrence in the editor's text. */
  const wordAt = (word) =>
    page.evaluate((word) => {
      const walker = document.createTreeWalker(document.querySelector("#editor .cm-content"), NodeFilter.SHOW_TEXT);
      for (let node; (node = walker.nextNode()); ) {
        const i = node.data.indexOf(word);
        if (i < 0) continue;
        const range = document.createRange();
        range.setStart(node, i);
        range.setEnd(node, i + word.length);
        const r = range.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      }
      return null;
    }, word);
  const rightClickWord = async (word) => {
    const at = await wordAt(word);
    if (!at) throw new Error(`“${word}” not on screen`);
    await page.mouse.click(at.x, at.y, { button: "right" });
    await page.waitForTimeout(400);
  };
  const text = () => page.evaluate(() => window.holocron.getText());
  // Electron's clipboard is asynchronous (W3C-style ClipboardItems).
  const readClipboard = () =>
    app.evaluate(async ({ clipboard }) => {
      const text = await clipboard.readText();
      let html = "";
      let image = false;
      for (const item of await clipboard.read()) {
        if (item.types.includes("text/html")) html = await (await item.getType("text/html")).text();
        if (item.types.some((type) => type.startsWith("image/"))) image = true;
      }
      return { text, html, image };
    });
  const resetClipboard = () => app.evaluate(({ clipboard }) => clipboard.writeText("(before)"));

  // Type the misspellings: Chromium checks what's typed (it doesn't sweep text a
  // note opened with in CodeMirror, whose lines it re-renders).
  const typeAtEndOf = async (word, typed) => {
    await page.mouse.click(...Object.values(await wordAt(word)));
    await page.keyboard.press("End");
    await page.keyboard.type(typed, { delay: 15 });
  };
  await typeAtEndOf("Spelling:", " I will recieve the package.");
  await typeAtEndOf("Dictionary:", " The zorblax engine hums.");
  await page.mouse.click(...Object.values(await wordAt("Last line")));
  await page.waitForTimeout(1500);
  await shot("typed-misspellings");
  /** Types `word` over itself, so a spell checker that wasn't ready yet sees it typed. */
  const retype = async (word) => {
    const at = await wordAt(word);
    await page.mouse.dblclick(at.x, at.y);
    await page.keyboard.type(word + " ", { delay: 15 });
    await page.keyboard.press("Backspace");
    await page.mouse.click(...Object.values(await wordAt("Last line")));
  };

  // 1. Spelling suggestions (the dictionary may take a moment to load).
  let spelling = [];
  for (let attempt = 0; attempt < 15; attempt++) {
    await rightClickWord("recieve");
    spelling = await labels();
    if (spelling.includes("receive")) break;
    await closeMenu();
    await retype("recieve");
    await page.waitForTimeout(700);
  }
  check("misspelled word offers “receive”", spelling.includes("receive"), spelling.join(" | "));
  check("Add to Dictionary offered", spelling.includes("Add “recieve” to Dictionary"));
  check("edit items follow", ["Cut", "Copy", "Copy as Markdown", "Paste", "Select All"].every((l) => spelling.includes(l)));
  await shot("spelling-suggestions");
  if (spelling.includes("receive")) {
    await clickItem("receive");
    await page.waitForTimeout(300);
    check("choosing a suggestion fixes the text", (await text()).includes("Spelling: I will receive the package."), (await text()).split("\n")[2]);
  }

  // 2. Add to Dictionary.
  let zorb = [];
  for (let attempt = 0; attempt < 6; attempt++) {
    await rightClickWord("zorblax");
    zorb = await labels();
    if (zorb.includes("Add “zorblax” to Dictionary")) break;
    await closeMenu();
    await retype("zorblax");
    await page.waitForTimeout(700);
  }
  check("unknown word offers Add to Dictionary", zorb.includes("Add “zorblax” to Dictionary"), zorb.join(" | "));
  if (zorb.includes("Add “zorblax” to Dictionary")) await clickItem("Add “zorblax” to Dictionary");
  await page.waitForTimeout(1000);
  await shot("after-add-to-dictionary");
  await rightClickWord("zorblax");
  const zorbAfter = await labels();
  check("added word is no longer misspelled", !zorbAfter.some((l) => l.startsWith("Add “")), zorbAfter.join(" | "));
  await closeMenu();

  await page.evaluate(() => window.holocronHost.call("open", "Context.md"));
  await page.waitForTimeout(3000);

  // 3. Copy through the menu puts rich HTML on the clipboard (live preview).
  await resetClipboard();
  await page.evaluate(() => window.holocron.selectInLine(9, 0, 200));
  await page.waitForTimeout(200);
  await rightClickWord("words");
  const copyMenu = await labels();
  check("selection in editor shows Format submenu", copyMenu.includes("Format"), copyMenu.join(" | "));
  await shot("selection-menu");
  await clickItem("Copy");
  await page.waitForTimeout(800);
  const copied = await readClipboard();
  check("menu Copy: markdown text", copied.text.includes("Plain words for **copying** here."), JSON.stringify(copied.text));
  check("menu Copy: text/html with formatting", /<strong>copying<\/strong>|<b>copying<\/b>/.test(copied.html), copied.html.slice(0, 160));

  // 4. Format submenu: Bold on a selected word.
  await page.evaluate(() => window.holocron.selectInLine(18, 0, 4)); // "Last"
  await page.waitForTimeout(200);
  await rightClickWord("Last");
  const formatBox = await page.evaluate(() => {
    const item = [...document.querySelectorAll(".menu .menu-item")].find((el) => el.querySelector(".menu-label")?.textContent === "Format");
    const r = item?.getBoundingClientRect();
    return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
  });
  if (formatBox) {
    await page.mouse.move(formatBox.x, formatBox.y);
    await page.waitForTimeout(400);
    await shot("format-submenu");
    const submenu = await labels();
    check("Format submenu lists Bold…Link", ["Bold", "Italic", "Strikethrough", "Highlight", "Inline Code", "Link"].every((l) => submenu.includes(l)), (await labels()).join(" | "));
    await clickItem("Bold");
    check("Format › Bold wraps the selection", (await text()).includes("**Last** line."), (await text()).split("\n").slice(-2).join(" / "));
  } else check("Format submenu present", false);
  await closeMenu();

  // 5. Wikilink.
  await page.locator("#editor .cm-wikilink").first().click({ button: "right" });
  await page.waitForTimeout(400);
  const linkMenu = await labels();
  check("wikilink: Open Link / Open in New Tab", linkMenu[0] === "Open Link" && linkMenu[1] === "Open in New Tab", linkMenu.join(" | "));
  await shot("wikilink-menu");
  const tabsBefore = (await page.evaluate(() => window.holocronHost.call("getState"))).vault.tabs.length;
  await clickItem("Open in New Tab");
  await page.waitForTimeout(800);
  const after = (await page.evaluate(() => window.holocronHost.call("getState"))).vault;
  check("Open in New Tab opened Linked Note", after.tabs.length === tabsBefore + 1 && after.doc?.path === "Linked Note.md", `${after.tabs.length} tabs, ${after.doc?.path}`);
  await page.evaluate(() => window.holocronHost.call("closeActiveTab"));
  await page.waitForTimeout(800);

  // 6. Markdown link.
  await page.locator("#editor .cm-md-link").first().click({ button: "right" });
  await page.waitForTimeout(400);
  const urlMenu = await labels();
  check("URL: Open Link / Copy Link Address", urlMenu[0] === "Open Link" && urlMenu[1] === "Copy Link Address", urlMenu.join(" | "));
  await clickItem("Copy Link Address");
  check("Copy Link Address", (await readClipboard()).text === "https://example.com");

  // 7. Tag.
  await page.locator("#editor .cm-tag").first().click({ button: "right" });
  await page.waitForTimeout(400);
  const tagMenu = await labels();
  check("tag: Search for #project/alpha", tagMenu[0] === "Search for #project/alpha", tagMenu.join(" | "));
  await shot("tag-menu");
  await clickItem("Search for #project/alpha");
  await page.waitForTimeout(500);
  const quickOpenQuery = await page.evaluate(() => (document.activeElement instanceof HTMLInputElement ? document.activeElement.value : null));
  check("tag search opens Quick Open with #tag", quickOpenQuery === "#project/alpha", String(quickOpenQuery));
  await shot("tag-quick-open");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  // 8. Diagram.
  await page.locator("#editor .cm-mermaid svg").first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await resetClipboard();
  await page.locator("#editor .cm-mermaid").first().click({ button: "right", position: { x: 20, y: 20 } });
  await page.waitForTimeout(400);
  const diagramMenu = await labels();
  check("diagram: Expand Diagram / Copy Image", diagramMenu[0] === "Expand Diagram" && diagramMenu[1] === "Copy Image", diagramMenu.join(" | "));
  await shot("diagram-menu");
  await clickItem("Copy Image");
  await page.waitForTimeout(1500);
  check("diagram Copy Image puts a PNG on the clipboard", (await readClipboard()).image);
  await page.locator("#editor .cm-mermaid").first().click({ button: "right", position: { x: 20, y: 20 } });
  await page.waitForTimeout(400);
  await clickItem("Expand Diagram");
  await page.waitForTimeout(800);
  check("Expand Diagram opens the viewer", await page.evaluate(() => document.querySelector(".hc-diagram-viewer") !== null));
  await shot("diagram-viewer");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);

  // 9. Image.
  await page.locator("#editor img.cm-image").first().scrollIntoViewIfNeeded();
  await resetClipboard();
  await page.locator("#editor img.cm-image").first().click({ button: "right" });
  await page.waitForTimeout(400);
  const imageMenu = await labels();
  check("image: Copy Image / Open Image", imageMenu[0] === "Copy Image" && imageMenu[1] === "Open Image", imageMenu.join(" | "));
  await shot("image-menu");
  await clickItem("Copy Image");
  await page.waitForTimeout(800);
  check("image Copy Image puts an image on the clipboard", (await readClipboard()).image);

  // 10. Reading view: no Cut / Paste / Format; Select All + Copy copies the note.
  await page.evaluate(() => window.holocronHost.call("setSetting", "editorMode", "reading"));
  await page.waitForTimeout(1200);
  await page.locator("#editor .cm-scroller").first().evaluate((el) => (el.scrollTop = 0));
  await page.waitForTimeout(300);
  await rightClickWord("Plain");
  const readingMenu = await labels();
  check("reading view: no Cut or Paste", !readingMenu.includes("Cut") && !readingMenu.includes("Paste") && readingMenu.includes("Copy") && readingMenu.includes("Copy as Markdown"), readingMenu.join(" | "));
  await shot("reading-menu");
  await clickItem("Select All");
  await resetClipboard();
  await rightClickWord("Plain");
  await clickItem("Copy");
  await page.waitForTimeout(800);
  const readingCopy = await readClipboard();
  check("reading view: Select All + Copy copies the note", readingCopy.text.replace(/\r\n/g, "\n").includes("Plain words for **copying** here.") && readingCopy.html.length > 0, JSON.stringify(readingCopy.text.slice(0, 60)));
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  await page.evaluate(() => window.holocronHost.call("setSetting", "editorMode", "livePreview"));
  await page.waitForTimeout(800);

  // 11. Sidebar search field: edit items only (plus spelling).
  await page.keyboard.press("Control+Shift+f");
  await page.waitForTimeout(500);
  const search = page.locator(".search-panel input").first();
  await search.fill("kyber");
  await search.click({ button: "right" });
  await page.waitForTimeout(400);
  const searchMenu = await labels();
  check("search field: just edit items", JSON.stringify(searchMenu) === JSON.stringify(["Cut", "Copy", "Paste", "Select All"]), searchMenu.join(" | "));
  await shot("search-field-menu");
  await clickItem("Select All");
  const selected = await page.evaluate(() => {
    const input = document.activeElement;
    return input instanceof HTMLInputElement ? input.value.slice(input.selectionStart ?? 0, input.selectionEnd ?? 0) : null;
  });
  check("search field: Select All selects the text", selected === "kyber", String(selected));

  // 12. File tree rows keep their own menu.
  await page.locator(".segment", { hasText: "Files" }).click();
  await page.waitForTimeout(400);
  await page.locator(".file-tree .row", { hasText: "Context" }).first().click({ button: "right" });
  await page.waitForTimeout(500);
  const treeMenu = await labels();
  check("file tree row: its own menu", treeMenu.includes("Rename") && !treeMenu.includes("Cut") && !treeMenu.includes("Select All"), treeMenu.join(" | "));
  await shot("file-tree-menu");
  await closeMenu();

  // 13. Plain UI (title bar) shows nothing.
  await page.mouse.click(640, 400, { button: "right" }); // editor area → menu
  await closeMenu();
  const status = await page.locator(".sidebar .top").boundingBox();
  if (status) {
    await page.mouse.click(status.x + status.width - 6, status.y + 4, { button: "right" });
    await page.waitForTimeout(400);
    check("plain UI: no menu", !(await menuOpen()), (await labels()).join(" | "));
    await closeMenu();
  }

  console.log(results.join("\n"));
}
