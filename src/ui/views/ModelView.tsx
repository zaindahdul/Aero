import { useEffect, useRef, useState } from 'react';
import type { EngineDesign } from '../../core/design';
import { HEAT_STOPS, SEQ_STOPS, cssGradient } from '../colormaps';
import { useElementSize } from '../hooks';
import { EngineViewer, type HoverInfo, type ViewOptions } from '../viewer/EngineViewer';

const BUTTONS: { key: keyof ViewOptions; label: string; title: string }[] = [
  { key: 'section', label: 'Section', title: 'Half-section through the axis' },
  { key: 'heatmap', label: 'Heat map', title: 'Colour walls by temperature' },
  { key: 'flowField', label: 'Flow field', title: 'Mach number in the cut plane (section view)' },
  { key: 'showJacket', label: 'Jacket', title: 'Show closeout jacket and manifolds' },
  { key: 'fire', label: 'Hot fire', title: 'Animated exhaust plume' },
  { key: 'autoRotate', label: 'Rotate', title: 'Auto-rotate' },
];

export function ModelView({ design, viewerRef, active }: { design: EngineDesign; viewerRef: React.MutableRefObject<EngineViewer | null>; active: boolean }) {
  const [box, size] = useElementSize<HTMLDivElement>();
  const host = useRef<HTMLDivElement>(null);
  const [opts, setOpts] = useState<ViewOptions>({ section: true, heatmap: false, flowField: true, showJacket: true, fire: false, autoRotate: false });
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [ranges, setRanges] = useState<{ t: [number, number]; m: number }>({ t: [0, 1], m: 1 });

  useEffect(() => {
    const v = new EngineViewer(host.current!);
    v.onHover = setHover;
    viewerRef.current = v;
    return () => {
      v.dispose();
      viewerRef.current = null;
    };
  }, [viewerRef]);

  useEffect(() => {
    viewerRef.current?.resize(size.width, size.height);
  }, [size, viewerRef]);

  useEffect(() => {
    const v = viewerRef.current;
    if (!v) return;
    v.setDesign(design);
    v.setOptions(opts);
    setRanges({ t: v.temperatureRange, m: v.machRange });
  }, [design]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    viewerRef.current?.setOptions(opts);
  }, [opts, viewerRef]);

  useEffect(() => {
    viewerRef.current?.setActive(active);
  }, [active, viewerRef]);

  const g = design.geometry;
  return (
    <div className="viewer" ref={box}>
      <div ref={host} style={{ position: 'absolute', inset: 0 }} />
      <div className="viewer-toolbar" role="toolbar" aria-label="View options">
        {BUTTONS.map((b) => (
          <button key={b.key} className="ghost" title={b.title} aria-pressed={opts[b.key]} onClick={() => setOpts((o) => ({ ...o, [b.key]: !o[b.key] }))}>
            {b.label}
          </button>
        ))}
        <button className="ghost" onClick={() => viewerRef.current?.frame()}>
          Reset view
        </button>
      </div>
      {hover && (
        <div className="viewer-hover" style={{ left: hover.x + 14, top: hover.y + 14 }}>
          {hover.name}
          <small>{hover.detail}</small>
        </div>
      )}
      <div className="viewer-legend">
        {opts.heatmap && (
          <div>
            Wall temperature
            <div className="bar" style={{ background: cssGradient(HEAT_STOPS) }} />
            <div className="ends">
              <span>{ranges.t[0].toFixed(0)} K</span>
              <span>{ranges.t[1].toFixed(0)} K</span>
            </div>
          </div>
        )}
        {opts.section && opts.flowField && (
          <div style={{ marginTop: opts.heatmap ? 8 : 0 }}>
            Mach number (MoC + Euler)
            <div className="bar" style={{ background: cssGradient(SEQ_STOPS) }} />
            <div className="ends">
              <span>0</span>
              <span>{ranges.m.toFixed(2)}</span>
            </div>
          </div>
        )}
        {!opts.heatmap && !(opts.section && opts.flowField) && <div>Drag to orbit · scroll to zoom · hover a part</div>}
      </div>
      <div className="viewer-info">
        Ø{(g.throatDiameter * 1e3).toFixed(1)} mm throat · Ø{(g.exitDiameter * 1e3).toFixed(0)} mm exit · {(g.totalLength * 1e3).toFixed(0)} mm long
      </div>
    </div>
  );
}
