<!-- The markdown cheat sheet (UI-34): a one-page reference for the syntax
     Holocron understands. Shortcuts come from the command registry. -->
<script lang="ts">
  import { commandById } from "../../lib/commands";

  const key = (id: string) => commandById.get(id)?.shortcut ?? "";
  const withKey = (text: string, id: string) => `${text}  ${key(id)}`;
  const headingKeys = (n: number) => key(`heading${n}`);

  const sections: [string, [string, string][]][] = [
    [
      "Text",
      [
        ["**bold**", withKey("Bold", "bold")],
        ["*italic*", withKey("Italic", "italic")],
        ["~~strikethrough~~", withKey("Strikethrough", "strikethrough")],
        ["==highlight==", withKey("Highlight", "highlight")],
        ["`code`", withKey("Inline code", "code")],
        ["\\*", "A literal * (escape)"],
        ["%% hidden %%", "Comment, not shown"],
        ["<kbd>Ctrl</kbd>  <sup>2</sup>", "Keys, super/subscript"],
      ],
    ],
    [
      "Headings",
      [
        ["# Heading 1", headingKeys(1)],
        ["## Heading 2", headingKeys(2)],
        ["### Heading 3", headingKeys(3)],
      ],
    ],
    [
      "Links & embeds",
      [
        ["[[Note]]", "Link to a note (type [[ for suggestions)"],
        ["[[Note|shown text]]", "Link with your own text"],
        ["[[Note#Heading]]", "Link to a heading"],
        ["[[Note#^id]]", "Link to a block marked ^id"],
        ["[text](https://…)", withKey("Web link", "link")],
        ["![[Note]]", "Embed a note (or #Heading)"],
        ["![[image.png|300]]", "Image, optional width"],
        ["#tag  #nested/tag", "Tags"],
        ["text[^1] … [^1]: note", "Footnote"],
      ],
    ],
    [
      "Lists",
      [
        ["- item", "Bulleted list"],
        ["1. item", "Numbered list"],
        ["- [ ] task   - [x] done", withKey("Checklist", "task")],
        ["- [-] [/] [>] [!] [?]", "Cancelled, partial, forwarded…"],
      ],
    ],
    [
      "Blocks",
      [
        ["> quote", "Quote"],
        ["> [!note] Title", "Callout (tip, warning, …)"],
        ["> [!tip]- Title", "Callout, folded (+ for open)"],
        ["```js … ```", "Code block with colours"],
        ["| a | b |  then Enter", "Table — Tab and Enter move between cells"],
        ["---", "Divider"],
        ["<details><summary>…", "Foldable section"],
      ],
    ],
    ["Properties", [["---\ntags: [a, b]\n---", "At the very top of a note"]]],
  ];
</script>

<div class="sheet">
  <h2>Markdown cheat sheet</h2>
  {#each sections as [title, rows] (title)}
    <section>
      <h3 class="section-label">{title}</h3>
      <div class="rows">
        {#each rows as [syntax, meaning] (syntax)}
          <code>{syntax}</code>
          <span>{meaning}</span>
        {/each}
      </div>
    </section>
  {/each}
</div>

<style>
  .sheet {
    width: 440px;
    max-width: 100%;
    max-height: 520px;
    overflow-y: auto;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  h2 {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    color: var(--ui-strong);
  }
  section {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  h3 {
    margin: 0;
  }
  .rows {
    display: grid;
    grid-template-columns: max-content 1fr;
    column-gap: 14px;
    row-gap: 5px;
    align-items: baseline;
  }
  code {
    font-family: "Cascadia Mono", Consolas, ui-monospace, monospace;
    font-size: 12px;
    color: var(--ui-accent-text);
    white-space: pre;
    user-select: text;
    cursor: text;
  }
  span {
    color: var(--ui-text-2);
    font-size: 12px;
  }
</style>
