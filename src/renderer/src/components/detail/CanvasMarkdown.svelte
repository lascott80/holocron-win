<!-- Markdown rendered read-only inside a canvas card (UI-45): the rich-copy
     renderer's HTML, sanitised as notes' HTML is (ED-55), with its inline
     e-mail styles dropped so the card follows the theme. Web links open in
     the browser through main's safe open; wikilinks open the note. -->
<script module lang="ts">
  type Renderers = {
    markdownToHtml: (markdown: string, options?: Record<string, unknown>) => string;
    sanitizeHtml: (html: string) => DocumentFragment;
  };
  let renderers: Promise<Renderers> | null = null;

  /** The editor's renderer and sanitiser, loaded once for every card (they share the editor's bundle). */
  function loadRenderers(): Promise<Renderers> {
    renderers ??= Promise.all([import("@editor/markdownToHtml.js"), import("@editor/html.js")]).then(([markdown, html]) => ({
      markdownToHtml: markdown.markdownToHtml as Renderers["markdownToHtml"],
      sanitizeHtml: html.sanitizeHtml as unknown as Renderers["sanitizeHtml"],
    }));
    return renderers;
  }
</script>

<script lang="ts">
  import { host, run } from "../../lib/host";

  let { markdown }: { markdown: string } = $props();

  let container = $state<HTMLDivElement>();

  $effect(() => {
    const text = markdown;
    const target = container;
    if (!target) return;
    let cancelled = false;
    void loadRenderers().then(({ markdownToHtml, sanitizeHtml }) => {
      if (cancelled) return;
      // Raw HTML passes through here and is cleaned with everything else below.
      const html = markdownToHtml(text, { sanitize: (raw: string) => raw });
      const fragment = sanitizeHtml(html);
      for (const element of fragment.querySelectorAll("[style]")) element.removeAttribute("style");
      target.replaceChildren(fragment);
    });
    return () => {
      cancelled = true;
    };
  });

  function onClick(event: MouseEvent) {
    const element = event.target instanceof Element ? event.target : null;
    const url = element?.closest<HTMLElement>("[data-href]")?.dataset.href;
    if (url) {
      event.preventDefault();
      host.postEditor({ type: "openURL", url });
      return;
    }
    const target = element?.closest<HTMLElement>("[data-target]")?.dataset.target;
    if (target) {
      event.preventDefault();
      run("openLink", target, true);
    }
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
<div class="markdown" bind:this={container} onclick={onClick}></div>

<style>
  .markdown {
    font-size: 13.5px;
    line-height: 1.5;
    color: var(--ui-body);
    overflow-wrap: anywhere;
    user-select: text;
    cursor: text;
  }
  .markdown :global(p),
  .markdown :global(ul),
  .markdown :global(ol),
  .markdown :global(pre),
  .markdown :global(blockquote),
  .markdown :global(table) {
    margin: 0 0 8px;
  }
  .markdown :global(> div > :last-child) {
    margin-bottom: 0;
  }
  .markdown :global(h1),
  .markdown :global(h2),
  .markdown :global(h3),
  .markdown :global(h4),
  .markdown :global(h5),
  .markdown :global(h6) {
    margin: 0 0 6px;
    line-height: 1.25;
    font-weight: 600;
    color: var(--ui-strong);
  }
  .markdown :global(h1) {
    font-size: 1.45em;
  }
  .markdown :global(h2) {
    font-size: 1.25em;
  }
  .markdown :global(h3) {
    font-size: 1.1em;
  }
  .markdown :global(ul),
  .markdown :global(ol) {
    padding-left: 22px;
  }
  .markdown :global(code) {
    font-family: var(--hc-mono, Consolas, monospace);
    font-size: 0.9em;
    padding: 1px 4px;
    border-radius: 4px;
    background: var(--ui-code);
  }
  .markdown :global(pre) {
    padding: 8px 10px;
    border-radius: 6px;
    background: var(--ui-code);
    white-space: pre-wrap;
  }
  .markdown :global(pre code) {
    padding: 0;
    background: none;
  }
  .markdown :global(blockquote) {
    padding-left: 10px;
    border-left: 3px solid var(--ui-strong-border);
    color: var(--ui-text-2);
  }
  .markdown :global(a) {
    color: var(--ui-accent);
    text-decoration: underline;
    cursor: pointer;
  }
  .markdown :global(mark) {
    background: rgba(var(--hc-callout-yellow, 232, 193, 90), 0.4);
    color: inherit;
  }
  .markdown :global(img) {
    max-width: 100%;
    height: auto;
    border-radius: 4px;
  }
  .markdown :global(hr) {
    border: 0;
    border-top: 1px solid var(--ui-border);
    margin: 10px 0;
  }
  .markdown :global(table) {
    border-collapse: collapse;
  }
  .markdown :global(th),
  .markdown :global(td) {
    padding: 3px 8px;
    border: 1px solid var(--ui-border);
    vertical-align: top;
  }
  .markdown :global(th) {
    background: var(--ui-raised);
    font-weight: 600;
  }
  .markdown :global(input[type="checkbox"]) {
    margin: 0 6px 0 0;
    vertical-align: middle;
    pointer-events: none;
  }
</style>
