// Holocron icon designs as SVG (24-unit grid, cube from REQUIREMENTS §16.8).
// `size` lets small renders use heavier strokes and drop effects that blur.

const HEX = "M12 2 L21 7 L21 17 L12 22 L3 17 L3 7 Z";
const TOP = "M12 2 L21 7 L12 12 L3 7 Z";
const LEFT = "M3 7 L12 12 L12 22 L3 17 Z";
const RIGHT = "M12 12 L21 7 L21 17 L12 22 Z";
const EDGES = "M12 12 L21 7 M12 12 L12 22 M12 12 L3 7";

/** Wraps an icon; gradient ids get a unique prefix so several icons can share one page. */
let uid = 0;
const svg = (body, defs = "") => {
  const p = `i${++uid}-`;
  const fix = (s) => s.replace(/id="([\w-]+)"/g, `id="${p}$1"`).replace(/url\(#([\w-]+)\)/g, `url(#${p}$1)`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="100%" height="100%"><defs>${fix(defs)}</defs>${fix(body)}</svg>`;
};

/** Scales the cube about the centre so it fills more of the icon. */
const scaled = (scale, inner) => `<g transform="translate(12 12) scale(${scale}) translate(-12 -12)">${inner}</g>`;

export const designs = {
  /** The current icon, for comparison: dark tile with a margin, thin glowing cube. */
  current: (size) =>
    svg(
      `<rect x="2.4" y="2.4" width="19.2" height="19.2" rx="4.3" fill="url(#bg)" stroke="#ffffff14" stroke-width="0.1"/>
       ${scaled(0.44, `<path d="${HEX}" fill="#5AB4FF38" stroke="#5AB4FF" stroke-width="1.5" stroke-linejoin="round"/><path d="${EDGES}" stroke="#5AB4FF" stroke-width="1.5" stroke-linecap="round"/><circle cx="12" cy="12" r="2.2" fill="#fff"/>`)}`,
      `<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1C2130"/><stop offset="1" stop-color="#0A0D12"/></linearGradient>`,
    ),

  /** A: bright Kyber-blue tile, white cube — stands out on dark and light taskbars (like VS Code / Office). */
  blueTile: (size) => {
    const stroke = size <= 24 ? 2.3 : size <= 48 ? 1.9 : 1.6;
    return svg(
      `<rect x="1" y="1" width="22" height="22" rx="5" fill="url(#bg)"/>
       <rect x="1" y="1" width="22" height="22" rx="5" fill="url(#shine)"/>
       ${scaled(0.66, `<path d="${TOP}" fill="#ffffff40"/><path d="${HEX}" fill="none" stroke="#fff" stroke-width="${stroke / 0.66}" stroke-linejoin="round"/><path d="${EDGES}" stroke="#fff" stroke-width="${stroke / 0.66}" stroke-linecap="round"/>`)}
       ${size > 24 ? `<circle cx="12" cy="12" r="1.25" fill="#fff"/>` : ""}`,
      `<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5AB4FF"/><stop offset="1" stop-color="#1F5FAE"/></linearGradient>
       <linearGradient id="shine" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff26"/><stop offset="0.5" stop-color="#ffffff00"/></linearGradient>`,
    );
  },

  /** B: solid isometric cube, no tile — three shaded faces read at any size on any background. */
  solidCube: (size) => {
    const edge = size <= 24 ? 0 : 0.35;
    return svg(
      `${scaled(1.08, `
        <path d="${TOP}" fill="#A8D8FF"/>
        <path d="${LEFT}" fill="#4FA8F5"/>
        <path d="${RIGHT}" fill="#1F64B8"/>
        ${edge ? `<path d="${EDGES}" stroke="#ffffffb0" stroke-width="${edge}" stroke-linecap="round"/><path d="${HEX}" fill="none" stroke="#0B2A52" stroke-opacity="0.35" stroke-width="${edge}" stroke-linejoin="round"/>` : ""}
        <circle cx="12" cy="12" r="${size <= 24 ? 1.9 : 1.5}" fill="#fff"/>`)}`,
    );
  },

  /** C: keeps the dark tile but full-bleed, with a lit rim and a big, heavy, bright cube. */
  darkTileBold: (size) => {
    const stroke = size <= 24 ? 2.4 : size <= 48 ? 2 : 1.7;
    return svg(
      `<rect x="1" y="1" width="22" height="22" rx="5" fill="url(#bg)"/>
       <rect x="1.35" y="1.35" width="21.3" height="21.3" rx="4.7" fill="none" stroke="url(#rim)" stroke-width="0.7"/>
       ${size > 24 ? `<circle cx="12" cy="12" r="8" fill="url(#glow)"/>` : ""}
       ${scaled(0.68, `<path d="${HEX}" fill="#5AB4FF55" stroke="#7CC4FF" stroke-width="${stroke / 0.68}" stroke-linejoin="round"/><path d="${EDGES}" stroke="#7CC4FF" stroke-width="${stroke / 0.68}" stroke-linecap="round"/>`)}
       <circle cx="12" cy="12" r="${size <= 24 ? 1.7 : 1.35}" fill="#fff"/>`,
      `<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#253248"/><stop offset="1" stop-color="#121826"/></linearGradient>
       <linearGradient id="rim" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7CC4FF"/><stop offset="1" stop-color="#2A72BD"/></linearGradient>
       <radialGradient id="glow"><stop offset="0" stop-color="#5AB4FF66"/><stop offset="1" stop-color="#5AB4FF00"/></radialGradient>`,
    );
  },
};
