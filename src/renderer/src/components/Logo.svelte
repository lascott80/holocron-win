<!-- The Holocron cube: a hexagon outline with three inner edges (REQUIREMENTS §16.8). -->
<script lang="ts">
  let { size = 24, glowing = false, color = "var(--ui-accent)", strokeWidth = 1.5 }: {
    size?: number;
    glowing?: boolean;
    color?: string;
    strokeWidth?: number;
  } = $props();
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  aria-hidden="true"
  style:filter={glowing ? `drop-shadow(0 0 ${size / 8}px color-mix(in srgb, ${color} 55%, transparent))` : undefined}
>
  <path
    d="M12 2 L21 7 L21 17 L12 22 L3 17 L3 7 Z"
    fill={glowing ? color : "none"}
    fill-opacity={glowing ? 0.22 : 0}
    stroke={color}
    stroke-width={strokeWidth}
    stroke-linejoin="round"
  />
  <path d="M12 12 L21 7 M12 12 L12 22 M12 12 L3 7" fill="none" stroke={color} stroke-width={strokeWidth} stroke-linecap="round" />
  {#if glowing}
    <circle cx="12" cy="12" r={strokeWidth * 1.5} fill="#fff" />
  {/if}
</svg>
