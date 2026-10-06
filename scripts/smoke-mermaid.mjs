// Smoke script: Mermaid diagrams render (dark and light), errors show a message, clicking edits.
import fs from "node:fs";
import path from "node:path";

const NOTE = `# Diagrams

\`\`\`mermaid
flowchart LR
  A[Write a note] --> B{Has a diagram?}
  B -- yes --> C[Render it]
  B -- no --> D[Plain text]
\`\`\`

Some text between.

\`\`\`mermaid
sequenceDiagram
  Editor->>Main: change
  Main-->>Disk: atomic write
\`\`\`

\`\`\`mermaid
this is not a diagram
\`\`\`
`;

export default async function ({ page, shot, vault }) {
  fs.writeFileSync(path.join(vault, "Diagrams.md"), NOTE);
  await page.waitForTimeout(800);
  await page.evaluate(() => window.holocronHost.call("open", "Diagrams.md"));
  await page.waitForTimeout(4000);
  console.log("diagrams rendered:", await page.locator(".cm-mermaid svg").count());
  console.log("error boxes:", await page.locator(".cm-mermaid-error").count());
  await shot("mermaid-dark");
  await page.evaluate(() => window.holocronHost.call("setSetting", "appearance", "light"));
  await page.waitForTimeout(2500);
  await shot("mermaid-light");
  await page.evaluate(() => window.holocronHost.call("setSetting", "accent", "sith"));
  await page.waitForTimeout(2500);
  await shot("mermaid-light-sith");
  await page.locator(".cm-mermaid").first().click();
  await page.waitForTimeout(600);
  console.log("after click, raw lines visible:", (await page.locator(".cm-line", { hasText: "flowchart LR" }).count()) > 0);
  await shot("mermaid-editing");
}
