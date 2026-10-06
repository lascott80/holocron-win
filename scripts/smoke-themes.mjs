// Smoke script: every colour theme on a showcase note (sidebar and inspector
// visible), Settings › Appearance with the theme cards, and Quick Open over Dark+.
//
//   node scripts/smoke.mjs <shots> --script scripts/smoke-themes.mjs [--out <build>]
import fs from "node:fs";
import path from "node:path";

const fence = "```";
const NOTE = `# Theme Showcase

Some **bold text**, *italic*, ~~struck~~, ==highlighted==, \`inline code\`, a [[Welcome]] link, an [external link](https://example.com) and a #tag.
Math too: $x^2 + y^2 = z^2$.

## Lists and tasks

- First item with a #project/alpha tag
- Second item
  - Nested item
- [ ] An open task
- [x] A finished task

> A quotation: the quick brown fox jumps over the lazy dog.

> [!note] A note callout
> Blue family.

> [!tip] A tip callout
> Green family.

> [!warning] A warning callout
> Yellow family.

> [!danger] A danger callout
> Red family.

> [!example] An example callout
> Purple family.

| Theme | Kind | Accent |
| --- | --- | --- |
| Dark+ | dark | #007ACC |
| Light+ | light | #005FB8 |

${fence}js
// Fetch a note and count its words.
import { readFile } from "node:fs/promises";
export async function countWords(path, { limit = 10 } = {}) {
  const text = await readFile(path, "utf8");
  if (/^\\s*$/.test(text)) return 0;
  return text.split(/\\s+/).length * limit;
}
${fence}

${fence}python
@dataclass
class Note:
    title: str = "Untitled"
    def words(self) -> int:
        return len(self.title.split())  # a comment
${fence}

${fence}powershell
$notes = Get-ChildItem -Path "C:\\Vault" -Filter *.md
foreach ($n in $notes) { Write-Host $n.Name -ForegroundColor Cyan }
${fence}

${fence}mermaid
flowchart LR
  A[Write] --> B{Diagram?}
  B -- yes --> C[Render]
  B -- no --> D[Text]
${fence}
`;

const THEMES = [
  ["dark", "holocron-dark"], ["dark", "dark-plus"], ["dark", "one-dark"], ["dark", "dracula"], ["dark", "nord"],
  ["dark", "github-dark"], ["dark", "solarized-dark"],
  ["light", "holocron-light"], ["light", "light-plus"], ["light", "github-light"], ["light", "solarized-light"],
];

export default async function ({ page, shot, vault }) {
  const set = (key, value) => page.evaluate(([k, v]) => window.holocronHost.call("setSetting", k, v), [key, value]);
  const key = (combo) => page.keyboard.press(combo);
  fs.writeFileSync(path.join(vault, "Theme Showcase.md"), NOTE);
  await page.waitForTimeout(800);
  await set("showSidebar", true);
  await set("showInspector", true);
  await page.evaluate(() => window.holocronHost.call("open", "Theme Showcase.md"));
  await page.waitForTimeout(3500);

  for (const [appearance, theme] of THEMES) {
    await set("appearance", appearance);
    await set(appearance === "dark" ? "darkTheme" : "lightTheme", theme);
    await set("accent", "theme");
    await page.waitForTimeout(1800);
    const info = await page.evaluate(() => {
      const css = getComputedStyle(document.documentElement);
      return {
        theme: css.getPropertyValue("--hc-theme").trim(),
        bg: css.getPropertyValue("--hc-bg").trim(),
        mermaid: document.querySelectorAll(".cm-mermaid svg").length,
        light: document.documentElement.classList.contains("hc-light"),
      };
    });
    console.log(theme, JSON.stringify(info));
    await shot(`theme-${theme}`);
    // The callouts, table and code blocks, then the diagram at the end.
    const scrollTo = (top) => page.evaluate((y) => {
      const scroller = document.querySelector(".cm-scroller");
      if (scroller) scroller.scrollTop = y < 0 ? scroller.scrollHeight : y;
    }, top);
    await scrollTo(1180);
    await page.waitForTimeout(700);
    await shot(`theme-${theme}-code`);
    await scrollTo(-1);
    await page.waitForTimeout(900);
    await shot(`theme-${theme}-diagram`);
    await page.evaluate(() => {
      const scroller = document.querySelector(".cm-scroller");
      if (scroller) scroller.scrollTop = 0;
    });
  }

  // Settings › Appearance, dark (Dark+) then light (Light+), with a crystal.
  await set("appearance", "dark");
  await set("darkTheme", "dark-plus");
  await set("lightTheme", "light-plus");
  await set("accent", "theme");
  await set("settingsTab", "appearance");
  await page.waitForTimeout(800);
  await key("Control+,");
  await page.waitForTimeout(900);
  await shot("settings-appearance-dark-plus");
  await page.getByRole("radiogroup", { name: "Crystal" }).scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await shot("settings-appearance-dark-plus-scrolled");
  // Clicking a card applies it immediately.
  await page.getByRole("radio", { name: /Dracula/ }).click();
  await page.waitForTimeout(900);
  await shot("settings-click-dracula");
  await set("appearance", "light");
  await set("accent", "sith");
  await page.waitForTimeout(1200);
  await shot("settings-appearance-light-plus-sith");
  await page.getByRole("radiogroup", { name: "Light theme" }).scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await shot("settings-light-themes-sith");
  await key("Escape");
  await page.waitForTimeout(400);

  // Quick Open and the command palette over Dark+.
  await set("appearance", "dark");
  await set("darkTheme", "dark-plus");
  await set("accent", "theme");
  await page.waitForTimeout(1200);
  await key("Control+o");
  await page.waitForTimeout(500);
  await shot("quick-open-dark-plus");
  await key("Escape");
  await key("Control+Shift+p");
  await page.waitForTimeout(400);
  await page.keyboard.type("theme:");
  await page.waitForTimeout(500);
  await shot("palette-themes-dark-plus");
  // "Theme: GitHub Light" from the palette switches the appearance to Light.
  await page.keyboard.type(" github light");
  await page.waitForTimeout(300);
  await key("Enter");
  await page.waitForTimeout(1500);
  console.log("after palette:", JSON.stringify(await page.evaluate(() => ({
    theme: getComputedStyle(document.documentElement).getPropertyValue("--hc-theme").trim(),
    light: document.documentElement.classList.contains("hc-light"),
  }))));
  await shot("palette-chose-github-light");
}
