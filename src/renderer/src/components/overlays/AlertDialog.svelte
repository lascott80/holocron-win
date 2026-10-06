<!-- An error from the main process: "Something went wrong" with OK. -->
<script lang="ts">
  import { CircleAlert } from "@lucide/svelte";
  import { app } from "../../lib/app.svelte";
  import { run } from "../../lib/host";
  import Modal from "./Modal.svelte";

  function dismiss() {
    run("dismissError");
  }
</script>

<Modal width={420} role="alertdialog" labelledby="alert-title" describedby="alert-message" onclose={dismiss}>
  <div class="dialog">
    <div class="badge"><CircleAlert size={20} /></div>
    <div class="text">
      <h2 id="alert-title">Something went wrong</h2>
      <p id="alert-message">{app.state.errorMessage}</p>
    </div>
  </div>
  <div class="actions">
    <button class="button primary" data-autofocus onclick={dismiss}>OK</button>
  </div>
</Modal>

<style>
  .dialog {
    display: flex;
    gap: 14px;
    padding: 22px 22px 18px;
  }
  .badge {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    border-radius: 10px;
    background: color-mix(in srgb, var(--ui-warning) 16%, transparent);
    color: var(--ui-warning);
  }
  .text {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  h2 {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
  }
  p {
    margin: 0;
    max-height: 40vh;
    overflow-y: auto;
    color: var(--ui-text-2);
    line-height: 1.45;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    user-select: text;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    padding: 14px 22px;
    border-top: 1px solid var(--ui-border);
    background: var(--ui-panel);
  }
  .actions .button {
    height: 32px;
    min-width: 92px;
  }
</style>
