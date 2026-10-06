// Smoke script: code-block languages (dark and light) and heading folding
// (chevron click, Ctrl+Shift+[ / ], the "…" pill, Fold All / Unfold All).
import fs from "node:fs";
import path from "node:path";

const fence = (lang, code) => "```" + lang + "\n" + code + "\n```\n";

const LANGUAGES = `# Languages

${fence("powershell", `# Clean old logs
$limit = (Get-Date).AddDays(-30)
Get-ChildItem -Path $env:TEMP -Recurse -Filter *.log |
  Where-Object { $_.LastWriteTime -lt $limit } |
  Remove-Item -Force -WhatIf
function Get-Greeting([string]$Name = "World") { return "Hello, $Name" }`)}
${fence("bat", `@echo off
REM Build the project
setlocal EnableDelayedExpansion
set CONFIG=Release
if "%1"=="debug" set CONFIG=Debug
for %%f in (*.txt) do echo Found %%f >> list.log
call :build !CONFIG!
goto :eof
:build
echo Building %~1 in %~dp0
exit /b 0`)}
${fence("php", `<?php
function greet(string $name): string {
    return "Hello, $name"; // comment
}
echo greet('world');`)}
${fence("makefile", `CC := gcc
CFLAGS = -O2 -Wall
.PHONY: all clean
all: app
app: $(wildcard src/*.c)
\t@echo "Linking $@"
\t$(CC) $(CFLAGS) -o $@ $^`)}
${fence("graphql", `query GetUser($id: ID!) {
  user(id: $id) @include(if: true) { name ...Fields }
}`)}
${fence("ini", `; settings
[server]
host = example.com
port = 8080`)}
${fence("md", `# Heading in a code block
Some **bold**, *italic*, \`code\` and a [link](https://example.com).
- item`)}
${fence("elixir", `defmodule Greeter do
  def hello(name), do: "Hello, #{name}" # comment
end`)}
${fence("r", `# mean of a vector
x <- c(1, 2, 3)
mean(x)`)}
${fence("haskell", `main :: IO ()
main = putStrLn "hi" -- comment`)}
${fence("latex", `\\section{Intro} % comment
$E = mc^2$`)}
${fence("nginx", `server {
  listen 80;
  location / { proxy_pass http://app; }
}`)}
`;

const FOLDING = `# Folding

Intro paragraph.

## First section

Text in the first section.

### Nested heading

Nested text.

\`\`\`sh
# not a heading
echo hi
\`\`\`

## Second section

| a | b |
| - | - |
| 1 | 2 |

> [!note]- A folded callout
> Body

## Third section

Last words.
`;

async function chevronPoint(page, index) {
  return page.evaluate((i) => {
    const el = document.querySelectorAll(".cm-heading-fold-chevron")[i];
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, index);
}

export default async function ({ page, shot, vault }) {
  fs.writeFileSync(path.join(vault, "Languages.md"), LANGUAGES);
  fs.writeFileSync(path.join(vault, "Folding.md"), FOLDING);
  await page.waitForTimeout(800);

  // Languages, dark then light, two scroll positions each.
  await page.evaluate(() => window.holocronHost.call("open", "Languages.md"));
  await page.waitForTimeout(2500);
  await shot("languages-dark-top");
  await page.evaluate(() => window.holocron.scrollToLine(40));
  await page.waitForTimeout(800);
  await shot("languages-dark-middle");
  await page.evaluate(() => window.holocron.scrollToLine(70));
  await page.waitForTimeout(800);
  await shot("languages-dark-bottom");
  await page.evaluate(() => window.holocronHost.call("setSetting", "appearance", "light"));
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.holocron.scrollToLine(1));
  await page.waitForTimeout(800);
  await shot("languages-light-top");
  await page.evaluate(() => window.holocron.scrollToLine(40));
  await page.waitForTimeout(800);
  await shot("languages-light-middle");
  await page.evaluate(() => window.holocron.scrollToLine(70));
  await page.waitForTimeout(800);
  await shot("languages-light-bottom");
  await page.evaluate(() => window.holocronHost.call("setSetting", "appearance", "dark"));
  await page.waitForTimeout(1000);

  // Heading folding.
  await page.evaluate(() => window.holocronHost.call("open", "Folding.md"));
  await page.waitForTimeout(1500);
  console.log("chevrons:", await page.locator(".cm-heading-fold").count());
  const first = await chevronPoint(page, 1); // "## First section"
  await page.mouse.move(first.x + 200, first.y);
  await page.waitForTimeout(300);
  await shot("fold-hover");
  await page.mouse.click(first.x, first.y);
  await page.waitForTimeout(400);
  console.log("after chevron click, pills:", await page.locator(".cm-heading-fold-pill").count());
  await page.mouse.move(900, 700);
  await shot("fold-chevron-folded");

  // Click the pill to unfold.
  await page.locator(".cm-heading-fold-pill").first().click();
  await page.waitForTimeout(400);
  console.log("after pill click, pills:", await page.locator(".cm-heading-fold-pill").count());

  // Keyboard: cursor in "Second section", Ctrl+Shift+[ then Ctrl+Shift+].
  await page.evaluate(() => {
    const text = window.holocron.getText();
    const line = text.split("\n").findIndex((l) => l.startsWith("| 1"));
    window.holocron.scrollToLine(line + 1);
  });
  const before = await page.evaluate(() => window.holocron.getText());
  await page.keyboard.press("Control+Shift+BracketLeft");
  const after = (await page.evaluate(() => window.holocron.getText())).split("\n");
  // (Leaving the table tidies it — ED-31 — so only that may change.)
  console.log("lines changed by the shortcut:", JSON.stringify(after.filter((line, i) => line !== before.split("\n")[i])));
  await page.waitForTimeout(400);
  console.log("after Ctrl+Shift+[, pills:", await page.locator(".cm-heading-fold-pill").count());
  await page.evaluate(() => document.querySelector(".cm-scroller").scrollTo(0, 0));
  await page.waitForTimeout(300);
  await shot("fold-keyboard-folded");
  await page.keyboard.press("Control+Shift+BracketRight");
  await page.waitForTimeout(400);
  console.log("after Ctrl+Shift+], pills:", await page.locator(".cm-heading-fold-pill").count());
  await shot("fold-keyboard-unfolded");

  // Fold All / Unfold All, in reading view too.
  await page.evaluate(() => window.holocron.run("foldAllHeadings"));
  await page.waitForTimeout(400);
  console.log("fold all, pills:", await page.locator(".cm-heading-fold-pill").count());
  await shot("fold-all");
  await page.evaluate(() => window.holocron.setMode("reading"));
  await page.waitForTimeout(400);
  await shot("fold-all-reading");
  await page.evaluate(() => window.holocron.run("unfoldAll"));
  await page.waitForTimeout(400);
  console.log("unfold all (reading), pills:", await page.locator(".cm-heading-fold-pill").count());
  await page.evaluate(() => window.holocron.setMode("source"));
  await page.waitForTimeout(400);
  console.log("source mode chevrons:", await page.locator(".cm-heading-fold").count());
  await page.evaluate(() => window.holocron.setMode("live"));
  await page.waitForTimeout(300);

  // Folds don't leak between notes.
  await page.evaluate(() => window.holocron.run("foldAllHeadings"));
  await page.evaluate(() => window.holocronHost.call("open", "Languages.md"));
  await page.waitForTimeout(800);
  console.log("other note pills:", await page.locator(".cm-heading-fold-pill").count());
  await page.evaluate(() => window.holocronHost.call("setSetting", "appearance", "light"));
  await page.evaluate(() => window.holocronHost.call("open", "Folding.md"));
  await page.waitForTimeout(1000);
  console.log("back to Folding, pills:", await page.locator(".cm-heading-fold-pill").count());
  await shot("fold-light-returned");
}
