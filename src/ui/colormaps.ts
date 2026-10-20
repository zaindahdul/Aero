/** Colour ramps for physical fields (monotone lightness, low -> high). */

type Stop = [number, string];

function hexToRgb(h: string): [number, number, number] {
  const v = parseInt(h.slice(1), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

function ramp(stops: Stop[]) {
  const rgb = stops.map(([t, h]) => [t, ...hexToRgb(h)] as [number, number, number, number]);
  return (t: number): [number, number, number] => {
    const u = Math.min(1, Math.max(0, t));
    for (let i = 1; i < rgb.length; i++) {
      if (u <= rgb[i][0]) {
        const a = rgb[i - 1];
        const b = rgb[i];
        const f = (u - a[0]) / (b[0] - a[0] || 1);
        return [a[1] + f * (b[1] - a[1]), a[2] + f * (b[2] - a[2]), a[3] + f * (b[3] - a[3])];
      }
    }
    const l = rgb[rgb.length - 1];
    return [l[1], l[2], l[3]];
  };
}

/** Semantic heat (black-body style) for temperatures. */
export const HEAT_STOPS: Stop[] = [
  [0, '#240c3c'],
  [0.22, '#5c1660'],
  [0.42, '#a8233f'],
  [0.62, '#e2592b'],
  [0.8, '#f6a93b'],
  [1, '#fdf2c8'],
];
export const heat = ramp(HEAT_STOPS);

/** Single-hue blue sequential ramp, dark (low) to light (high) for dark surfaces. */
export const SEQ_STOPS: Stop[] = [
  [0, '#0d366b'],
  [0.25, '#1c5cab'],
  [0.5, '#3987e5'],
  [0.75, '#86b6ef'],
  [1, '#cde2fb'],
];
export const sequential = ramp(SEQ_STOPS);

export const cssGradient = (stops: Stop[]) => `linear-gradient(90deg, ${stops.map(([t, c]) => `${c} ${(t * 100).toFixed(0)}%`).join(', ')})`;
