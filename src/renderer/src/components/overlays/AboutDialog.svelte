<!-- Help › About Holocron: version, author and links. Links go through main's fixed allow-list (openAboutLink). -->
<script lang="ts">
  import { Code, Copy, ExternalLink, Globe } from "@lucide/svelte";
  import iconUrl from "../../../../../resources/icons/icon-128.png";
  import { app } from "../../lib/app.svelte";
  import { call, run } from "../../lib/host";
  import Modal from "./Modal.svelte";

  interface AboutInfo {
    version: string;
    electron: string;
    chrome: string;
    node: string;
    os: string;
  }

  let info = $state<AboutInfo | null>(null);
  let copied = $state(false);

  $effect(() => {
    void call<AboutInfo>("aboutInfo").then((value) => (info = value));
  });

  function close() {
    app.aboutOpen = false;
  }

  function versionText() {
    if (!info) return "";
    return `Holocron ${info.version}\nElectron ${info.electron}\nChromium ${info.chrome}\nNode.js ${info.node}\nWindows ${info.os}`;
  }

  async function copyVersion() {
    await navigator.clipboard.writeText(versionText());
    copied = true;
    setTimeout(() => (copied = false), 1200);
  }
</script>

<Modal width={400} labelledby="about-title" onclose={close}>
  <div class="about">
    <img class="icon" src={iconUrl} alt="" width="72" height="72" />
    <h2 id="about-title">Holocron</h2>
    <p class="version">Version {info?.version ?? app.state.version} for Windows</p>
    <p class="tagline">Plain markdown notes in folders you choose. No database, no lock-in.</p>

    <div class="author">
      <span class="label">Created by</span>
      <span class="name">Lawrence Scott</span>
      <button class="link" onclick={() => run("openAboutLink", "website")}>
        <Globe size={14} /> www.lascott.net
      </button>
    </div>

    <div class="links">
      <button class="link" onclick={() => run("openAboutLink", "github")}><Code size={14} /> Source on GitHub</button>
      <button class="link" onclick={() => run("openAboutLink", "releases")}><ExternalLink size={14} /> Release notes</button>
    </div>

    {#if info}
      <p class="tech">Electron {info.electron} · Chromium {info.chrome} · Node.js {info.node}</p>
    {/if}
    <p class="copyright">Copyright © 2026 Lawrence Scott</p>
  </div>
  <div class="actions">
    <button class="button" onclick={copyVersion} disabled={!info}>
      <Copy size={14} />
      {copied ? "Copied" : "Copy Version Info"}
    </button>
    <button class="button primary" data-autofocus onclick={close}>OK</button>
  </div>
</Modal>

<style>
  .about {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 28px 28px 20px;
    text-align: center;
  }
  .icon {
    width: 72px;
    height: 72px;
    margin-bottom: 12px;
    filter: drop-shadow(0 6px 16px rgba(0, 0, 0, 0.25));
  }
  h2 {
    margin: 0;
    font-size: 20px;
    font-weight: 600;
    color: var(--ui-strong);
  }
  p {
    margin: 0;
  }
  .version {
    margin-top: 4px;
    color: var(--ui-text-2);
    font-size: 12.5px;
    user-select: text;
  }
  .tagline {
    margin-top: 12px;
    color: var(--ui-text-2);
    line-height: 1.45;
  }
  .author {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    margin-top: 18px;
    padding: 12px 16px;
    width: 100%;
    border: 1px solid var(--ui-border);
    border-radius: 10px;
    background: var(--ui-raised);
  }
  .label {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.6px;
    text-transform: uppercase;
    color: var(--ui-text-3);
  }
  .name {
    font-size: 15px;
    font-weight: 600;
    color: var(--ui-strong);
  }
  .links {
    display: flex;
    gap: 16px;
    margin-top: 14px;
  }
  .link {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 2px 4px;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: var(--ui-accent-text);
    cursor: pointer;
  }
  .link:hover {
    text-decoration: underline;
  }
  .tech,
  .copyright {
    font-size: 11.5px;
    color: var(--ui-text-3);
    user-select: text;
  }
  .tech {
    margin-top: 18px;
  }
  .copyright {
    margin-top: 4px;
  }
  .actions {
    display: flex;
    justify-content: space-between;
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
