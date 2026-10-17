<!-- Clean Up Unused Attachments… (VLT-20): files in the attachment folder that no
     note links to, for review before moving them to the unused folder. Files a
     note mentions without a link start unticked. -->
<script lang="ts">
  import { File, Paperclip, TriangleAlert } from "@lucide/svelte";
  import { basename, dirname, join, stem } from "@core/paths";
  import { UNUSED_FOLDER } from "@core/attachmentUsage";
  import { app } from "../../lib/app.svelte";
  import { run } from "../../lib/host";
  import Modal from "./Modal.svelte";
  import Checkbox from "./Checkbox.svelte";

  const items = $derived(app.vault?.attachmentCleanup ?? []);
  const holding = $derived(join(app.settings.attachmentFolder.replace(/^\/+|\/+$/g, ""), UNUSED_FOLDER));
  // Unmentioned files start ticked, mentioned ones unticked; the user's changes are kept here.
  let toggled = $state(new Map<string, boolean>());
  const isChosen = (item: (typeof items)[number]) => toggled.get(item.path) ?? item.mentionedIn.length === 0;
  const chosen = $derived(items.filter(isChosen));
  const chosenSize = $derived(chosen.reduce((sum, item) => sum + item.size, 0));
  const mentioned = $derived(items.filter((item) => item.mentionedIn.length > 0).length);

  function toggle(path: string, checked: boolean) {
    toggled = new Map(toggled).set(path, checked);
  }

  function selectAll(checked: boolean) {
    toggled = new Map(items.map((item) => [item.path, checked]));
  }

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  const notes = (paths: string[]) => paths.slice(0, 2).map((path) => `“${stem(path)}”`).join(", ") + (paths.length > 2 ? ` and ${paths.length - 2} more` : "");
  const thumbnail = (path: string) => `holocron-asset://embed/${encodeURIComponent("/" + path)}`;
  const count = (n: number) => (n === 1 ? "1 file" : `${n} files`);
</script>

<Modal width={580} labelledby="cleanup-title" describedby="cleanup-summary" onclose={() => run("cancelAttachmentCleanup")}>
  <div class="sheet">
    <div class="header">
      <div class="badge"><Paperclip size={18} /></div>
      <div class="header-text">
        <h2 id="cleanup-title">Clean Up Unused Attachments</h2>
        <p id="cleanup-summary">
          No note links to {items.length === 1 ? "this file" : `these ${items.length} files`}. They move to {holding}, so nothing is deleted
          yet: Undo Last Attachment Change puts them back, and Empty Unused Attachments sends them to the Recycle Bin.
          {#if mentioned}{count(mentioned)} {mentioned === 1 ? "is" : "are"} mentioned in a note, so {mentioned === 1 ? "it starts" : "they start"} unticked.{/if}
        </p>
      </div>
    </div>

    <div class="toolbar">
      <span>{count(chosen.length)} selected · {formatSize(chosenSize)}</span>
      <span class="spacer"></span>
      <button class="link" onclick={() => selectAll(true)}>Select All</button>
      <button class="link" onclick={() => selectAll(false)}>Select None</button>
    </div>

    <ul class="list">
      {#each items as item (item.path)}
        <li class:off={!isChosen(item)}>
          <Checkbox label="" ariaLabel={item.path} checked={isChosen(item)} onchange={(checked) => toggle(item.path, checked)} />
          <div class="thumb">
            {#if item.isImage}
              <img src={thumbnail(item.path)} alt="" loading="lazy" />
            {:else}
              <File size={18} />
            {/if}
          </div>
          <div class="name">
            <span class="file">{basename(item.path)}</span>
            {#if item.mentionedIn.length}
              <span class="mention"><TriangleAlert size={11} /> Mentioned in {notes(item.mentionedIn)}</span>
            {:else}
              <span class="folder">{dirname(item.path) || "Vault root"}</span>
            {/if}
          </div>
          <span class="size">{formatSize(item.size)}</span>
        </li>
      {/each}
    </ul>
  </div>
  <div class="actions">
    <button class="button" data-autofocus onclick={() => run("cancelAttachmentCleanup")}>Cancel</button>
    <button class="button primary" disabled={chosen.length === 0} onclick={() => run("confirmAttachmentCleanup", chosen.map((item) => item.path))}>
      Move {count(chosen.length)} to {UNUSED_FOLDER}
    </button>
  </div>
</Modal>

<style>
  .sheet {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-height: 0;
    padding: 22px 22px 14px;
  }
  .header {
    display: flex;
    align-items: flex-start;
    gap: 14px;
  }
  .badge {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    border-radius: 10px;
    background: color-mix(in srgb, var(--ui-accent) 16%, transparent);
    color: var(--ui-accent);
  }
  .header-text {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  h2 {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
  }
  p {
    margin: 0;
    color: var(--ui-text-2);
    line-height: 1.45;
  }
  .toolbar {
    display: flex;
    align-items: center;
    gap: 12px;
    font-size: 12px;
    color: var(--ui-text-2);
  }
  .spacer {
    flex: 1;
  }
  .link {
    border: none;
    background: none;
    padding: 0;
    font: inherit;
    color: var(--ui-accent);
    cursor: pointer;
  }
  .link:hover {
    text-decoration: underline;
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 4px 0;
    max-height: 340px;
    overflow: auto;
    border: 1px solid var(--ui-strong-border);
    border-radius: 8px;
    background: var(--ui-editor);
  }
  li {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 5px 12px;
  }
  li.off {
    opacity: 0.55;
  }
  .thumb {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border-radius: 6px;
    overflow: hidden;
    background: var(--ui-panel);
    color: var(--ui-text-3);
  }
  .thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .name {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .file,
  .folder,
  .mention {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .folder {
    font-size: 11px;
    color: var(--ui-text-3);
  }
  .mention {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    color: var(--ui-warning);
  }
  .size {
    flex: none;
    font-size: 12px;
    color: var(--ui-text-2);
    font-variant-numeric: tabular-nums;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 14px 22px;
    border-top: 1px solid var(--ui-border);
    background: var(--ui-panel);
  }
  .actions .button {
    height: 32px;
    min-width: 92px;
  }
</style>
