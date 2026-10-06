<!-- Text with fuzzy-matched characters (code-point offsets) in bold accent. -->
<script lang="ts">
  let { text, indices = [], offset = 0 }: {
    text: string;
    indices?: readonly number[];
    /** Added to each character's position before looking it up in `indices`. */
    offset?: number;
  } = $props();

  const runs = $derived.by(() => {
    const marked = new Set(indices);
    const result: { text: string; marked: boolean }[] = [];
    Array.from(text).forEach((character, index) => {
      const isMarked = marked.has(index + offset);
      const last = result[result.length - 1];
      if (last && last.marked === isMarked) last.text += character;
      else result.push({ text: character, marked: isMarked });
    });
    return result;
  });
</script>

{#each runs as run, index (index)}{#if run.marked}<mark>{run.text}</mark>{:else}{run.text}{/if}{/each}

<style>
  mark {
    background: none;
    color: var(--match-color, var(--ui-accent-text));
    font-weight: 700;
  }
</style>
