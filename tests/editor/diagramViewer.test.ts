import { describe, expect, it } from "vitest";
import {
  fitTransform,
  MAX_FIT_SCALE,
  panBy,
  svgSize,
  wheelPixels,
  wheelZoomFactor,
  zoomAt,
  zoomTo,
} from "../../src/editor/diagramViewer.js";

describe("svgSize", () => {
  it("reads the viewBox of the root element", () => {
    const svg = `<svg id="m" width="100%" viewBox="-8 -8 640.5 1200" style="max-width: 640.5px;"><g><svg viewBox="0 0 1 1"/></g></svg>`;
    expect(svgSize(svg)).toEqual({ width: 640.5, height: 1200 });
  });

  it("accepts commas and falls back to width/height attributes", () => {
    expect(svgSize(`<svg viewBox="0,0,10,20">`)).toEqual({ width: 10, height: 20 });
    expect(svgSize(`<svg width="300px" height="150">`)).toEqual({ width: 300, height: 150 });
    expect(svgSize(`<svg width="100%">`)).toEqual({ width: 0, height: 0 });
    expect(svgSize("not svg")).toEqual({ width: 0, height: 0 });
  });
});

describe("fitTransform", () => {
  it("fits a wide diagram to the width and centres it vertically", () => {
    const t = fitTransform(2000, 500, 1048, 748, 24);
    expect(t.scale).toBeCloseTo(0.5);
    expect(t.x).toBeCloseTo(24);
    expect(t.y).toBeCloseTo((748 - 250) / 2);
  });

  it("fits a tall diagram to the height", () => {
    const t = fitTransform(400, 3000, 1000, 648, 24);
    expect(t.scale).toBeCloseTo(600 / 3000);
    expect(t.y).toBeCloseTo(24);
    expect(t.x).toBeCloseTo((1000 - 80) / 2);
  });

  it("enlarges small diagrams, up to the cap", () => {
    expect(fitTransform(400, 300, 848, 648, 24).scale).toBeCloseTo(2);
    expect(fitTransform(50, 20, 2000, 2000, 24).scale).toBe(MAX_FIT_SCALE);
    expect(fitTransform(50, 20, 2000, 2000, 24, 1).scale).toBe(1);
  });

  it("copes with empty content and tiny views", () => {
    expect(fitTransform(0, 0, 800, 600)).toEqual({ scale: 1, x: 400, y: 300 });
    expect(fitTransform(100, 100, 10, 10, 24).scale).toBeGreaterThan(0);
  });
});

describe("zoomAt", () => {
  it("keeps the point under the cursor fixed", () => {
    const start = { scale: 1, x: 100, y: 50 };
    const t = zoomAt(start, 2, 300, 250);
    // Content point under (300, 250) before: ((300-100)/1, (250-50)/1) = (200, 200).
    expect(t.scale).toBe(2);
    expect(t.x + 200 * t.scale).toBeCloseTo(300);
    expect(t.y + 200 * t.scale).toBeCloseTo(250);
  });

  it("clamps the scale and keeps the anchor at the clamp", () => {
    const t = zoomAt({ scale: 3, x: 0, y: 0 }, 10, 100, 100, 0.1, 4);
    expect(t.scale).toBe(4);
    expect(t.x).toBeCloseTo(100 - 100 * (4 / 3));
    expect(zoomAt({ scale: 0.2, x: 0, y: 0 }, 0.1, 0, 0, 0.1, 4).scale).toBe(0.1);
  });

  it("is undone by the inverse factor", () => {
    const start = { scale: 0.7, x: -40, y: 12 };
    const t = zoomAt(zoomAt(start, 1.25, 500, 300), 1 / 1.25, 500, 300);
    expect(t.scale).toBeCloseTo(start.scale);
    expect(t.x).toBeCloseTo(start.x);
    expect(t.y).toBeCloseTo(start.y);
  });
});

describe("zoomTo", () => {
  it("sets an absolute scale about the view centre", () => {
    const t = zoomTo({ scale: 0.5, x: 0, y: 0 }, 1, 800, 600);
    expect(t.scale).toBe(1);
    expect(t.x).toBeCloseTo(400 - 400 * 2);
    expect(t.y).toBeCloseTo(300 - 300 * 2);
  });
});

describe("panBy", () => {
  it("moves freely while the content stays in view", () => {
    expect(panBy({ scale: 1, x: 10, y: 10 }, 30, -5, 400, 300, 800, 600)).toEqual({ scale: 1, x: 40, y: 5 });
  });

  it("keeps some of the content on screen", () => {
    const right = panBy({ scale: 1, x: 0, y: 0 }, 5000, 5000, 400, 300, 800, 600, 48);
    expect(right.x).toBe(800 - 48);
    expect(right.y).toBe(600 - 48);
    const left = panBy({ scale: 2, x: 0, y: 0 }, -5000, -5000, 400, 300, 800, 600, 48);
    expect(left.x).toBe(48 - 800);
    expect(left.y).toBe(48 - 600);
  });
});

describe("wheel helpers", () => {
  it("converts line and page deltas to pixels", () => {
    expect(wheelPixels(3, 0)).toBe(3);
    expect(wheelPixels(3, 1)).toBe(48);
    expect(wheelPixels(1, 2, 700)).toBe(700);
  });

  it("zooms in on negative deltas, caps mouse notches and follows pinches", () => {
    expect(wheelZoomFactor(-100)).toBeCloseTo(1.25);
    expect(wheelZoomFactor(120)).toBeCloseTo(0.8);
    expect(wheelZoomFactor(-5)).toBeCloseTo(Math.exp(0.05));
    expect(wheelZoomFactor(0)).toBe(1);
  });
});
