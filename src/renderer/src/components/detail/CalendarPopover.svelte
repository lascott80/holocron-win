<!-- A month calendar for daily notes (DAY-07), anchored to the title bar's
     calendar button. Days with a note are marked; clicking any day opens (or
     creates) its note. ‹ › step months, "Today" jumps back; arrow keys move
     between days, Enter opens, Esc closes. -->
<script lang="ts">
  import { ChevronLeft, ChevronRight } from "@lucide/svelte";
  import { tick } from "svelte";
  import { app } from "../../lib/app.svelte";
  import { call, run } from "../../lib/host";
  import Popover from "./Popover.svelte";

  let { anchor, onclose }: { anchor: HTMLElement | undefined; onclose: () => void } = $props();

  const today = new Date();
  let year = $state(today.getFullYear());
  let month = $state(today.getMonth());
  let notes = $state<Map<number, string>>(new Map());
  let request = 0;
  let grid = $state<HTMLDivElement>();
  /** The day the keyboard is on. */
  let focusDay = $state(today.getDate());

  const monthFormat = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });
  const weekdayFormat = new Intl.DateTimeFormat(undefined, { weekday: "short" });
  /** Monday-first unless the locale starts its week on Sunday or Saturday. */
  const firstWeekday: number = (() => {
    try {
      const locale = new Intl.Locale(navigator.language) as Intl.Locale & { getWeekInfo?: () => { firstDay: number } };
      const first = locale.getWeekInfo?.().firstDay;
      return first === undefined ? 1 : first % 7; // Intl: 1 = Monday … 7 = Sunday; Date: 0 = Sunday
    } catch {
      return 1;
    }
  })();
  const weekdays = Array.from({ length: 7 }, (_, i) => {
    const day = (firstWeekday + i) % 7;
    return weekdayFormat.format(new Date(2023, 0, 1 + day)); // 1 Jan 2023 was a Sunday
  });

  const daysInMonth = $derived(new Date(year, month + 1, 0).getDate());
  const leading = $derived((new Date(year, month, 1).getDay() - firstWeekday + 7) % 7);
  const cells = $derived.by(() => {
    const out: (number | null)[] = Array.from({ length: leading }, () => null);
    for (let day = 1; day <= daysInMonth; day++) out.push(day);
    while (out.length % 7) out.push(null);
    return out;
  });
  const isThisMonth = $derived(year === today.getFullYear() && month === today.getMonth());
  const current = $derived(app.doc?.path ?? null);

  $effect(() => {
    const y = year;
    const m = month;
    void app.vault?.treeRevision;
    const id = ++request;
    call<{ day: number; path: string }[] | undefined>("dailyNotesInMonth", y, m)
      .then((result) => {
        if (id === request) notes = new Map((result ?? []).map(({ day, path }) => [day, path]));
      })
      .catch((error: unknown) => console.error("[dailyNotesInMonth]", error));
  });

  function step(delta: number) {
    const date = new Date(year, month + delta, 1);
    year = date.getFullYear();
    month = date.getMonth();
    focusDay = Math.min(focusDay, new Date(year, month + 1, 0).getDate());
  }

  function goToday() {
    year = today.getFullYear();
    month = today.getMonth();
    focusDay = today.getDate();
    void focus(focusDay);
  }

  function open(day: number, event?: MouseEvent | KeyboardEvent) {
    run("openDailyNoteFor", year, month, day, Boolean(event?.ctrlKey));
    onclose();
  }

  function openToday() {
    run("openDailyNote");
    onclose();
  }

  async function focus(day: number) {
    await tick();
    grid?.querySelector<HTMLButtonElement>(`[data-day="${day}"]`)?.focus();
  }

  function onKeydown(event: KeyboardEvent) {
    const moves: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (event.key in moves) {
      event.preventDefault();
      let next = focusDay + moves[event.key]!;
      if (next < 1) {
        step(-1);
        next += daysInMonth; // now the previous month's length (daysInMonth re-derived after step)
      } else if (next > daysInMonth) {
        next -= daysInMonth;
        step(1);
      }
      focusDay = Math.max(1, Math.min(next, daysInMonth));
      void focus(focusDay);
    } else if (event.key === "PageUp" || event.key === "PageDown") {
      event.preventDefault();
      step(event.key === "PageUp" ? -1 : 1);
      void focus(focusDay);
    } else if (event.key === "Home") {
      event.preventDefault();
      goToday();
    }
  }
</script>

<Popover {anchor} placement="below" align="end" label="Daily notes" {onclose}>
  <div class="calendar" onkeydown={onKeydown} role="presentation">
    <div class="head">
      <button class="nav" title="Previous month (PageUp)" aria-label="Previous month" onclick={() => step(-1)}><ChevronLeft size={14} /></button>
      <span class="month" aria-live="polite">{monthFormat.format(new Date(year, month, 1))}</span>
      <button class="nav" title="Next month (PageDown)" aria-label="Next month" onclick={() => step(1)}><ChevronRight size={14} /></button>
    </div>
    <div class="grid" bind:this={grid} role="grid" aria-label="Days">
      {#each weekdays as name (name)}
        <span class="weekday" role="columnheader">{name}</span>
      {/each}
      {#each cells as day, index (index)}
        {#if day === null}
          <span class="blank"></span>
        {:else}
          {@const path = notes.get(day)}
          {@const isToday = isThisMonth && day === today.getDate()}
          <button
            class="day"
            class:has-note={Boolean(path)}
            class:today={isToday}
            class:current={path !== undefined && path === current}
            role="gridcell"
            data-day={day}
            data-autofocus={isThisMonth && day === focusDay ? "" : undefined}
            tabindex={day === focusDay ? 0 : -1}
            title={path ? path : `Create the note for ${new Date(year, month, day).toLocaleDateString()}`}
            aria-label="{new Date(year, month, day).toLocaleDateString(undefined, { dateStyle: 'full' })}{path ? ', has a note' : ''}"
            onclick={(event) => open(day, event)}
            onfocus={() => (focusDay = day)}
          >
            {day}
            <span class="dot" aria-hidden="true"></span>
          </button>
        {/if}
      {/each}
    </div>
    <div class="foot">
      <span class="hint">{notes.size === 1 ? "1 note" : `${notes.size} notes`} this month · click a day to open or create</span>
      <button class="button small" onclick={openToday} title="Open today’s note (Ctrl+Shift+D)">Today</button>
    </div>
  </div>
</Popover>

<style>
  .calendar {
    width: 264px;
    padding: 10px 10px 8px;
    user-select: none;
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 6px;
  }
  .month {
    font-size: 13px;
    font-weight: 600;
    color: var(--ui-text);
  }
  .nav {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--ui-text-2);
  }
  .nav:hover {
    background: var(--ui-chip);
    color: var(--ui-text);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 2px;
  }
  .weekday {
    text-align: center;
    font-size: 10.5px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--ui-text-3);
    padding: 2px 0 4px;
  }
  .blank {
    height: 30px;
  }
  .day {
    position: relative;
    height: 30px;
    padding: 0;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--ui-text-2);
    font-size: 12.5px;
    font-variant-numeric: tabular-nums;
  }
  .day:hover {
    background: var(--ui-chip);
    color: var(--ui-text);
  }
  .day:focus-visible {
    outline: 2px solid rgba(var(--ui-accent-rgb), 0.7);
    outline-offset: -2px;
  }
  .day.has-note {
    color: var(--ui-text);
    font-weight: 600;
  }
  .day.today {
    box-shadow: inset 0 0 0 1.5px rgba(var(--ui-accent-rgb), 0.6);
  }
  .day.current {
    background: rgba(var(--ui-accent-rgb), 0.18);
  }
  .dot {
    position: absolute;
    left: 50%;
    bottom: 3px;
    width: 4px;
    height: 4px;
    border-radius: 50%;
    transform: translateX(-50%);
    background: var(--ui-accent);
    opacity: 0;
  }
  .has-note .dot {
    opacity: 1;
  }
  .foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px solid var(--ui-border);
  }
  .hint {
    flex: 1;
    min-width: 0;
    font-size: 11px;
    color: var(--ui-text-3);
    line-height: 1.35;
  }
  .button.small {
    height: 24px;
    padding: 0 10px;
    font-size: 12px;
  }
</style>
