// Smoke script: type → autosave reaches disk; an outside edit merges into the open note.
import fs from "node:fs";
import path from "node:path";

export default async function ({ page, shot, vault }) {
  const file = path.join(vault, "Linked Note.md");
  await page.evaluate(() => window.holocronHost.call("open", "Linked Note.md"));
  await page.waitForTimeout(1000);
  await page.click(".cm-content");
  await page.keyboard.press("Control+End");
  await page.keyboard.type("\n\nTyped in the editor.");
  await page.waitForTimeout(1800);
  const saved = fs.readFileSync(file, "utf8");
  console.log("autosaved:", saved.includes("Typed in the editor."));

  // Unsaved edit at the end + outside edit at the top → should merge.
  await page.keyboard.type(" More.");
  fs.writeFileSync(file, saved.replace("# Linked Note", "# Linked Note\n\nAdded outside."));
  await page.waitForTimeout(2500);
  const text = await page.evaluate(() => window.holocron.getText());
  console.log("merged in editor:", text.includes("Added outside.") && text.includes("Typed in the editor. More."));
  console.log("merged on disk:", fs.readFileSync(file, "utf8").includes("Added outside.") && fs.readFileSync(file, "utf8").includes("More."));
  await shot("merged");
}
