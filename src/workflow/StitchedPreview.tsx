import type { ExportPlan } from '../../electron/export-contracts';
import { piecesLength, toPieceTime } from '../../electron/clip-gaps';
import { markerColor, time, type Marker } from './model';
import s from './Workflow.module.css';

/** One zigzag line across the bar where two pieces meet (decision 0028). */
const seam = (
  <svg viewBox="0 0 14 36" preserveAspectRatio="none" aria-hidden="true">
    <polyline points="3.5,0 10.5,6 3.5,12 10.5,18 3.5,24 10.5,30 3.5,36" />
  </svg>
);

/**
 * VC-212: the clip as it will export, for review before exporting: its pieces end to end with a
 * zigzag at each join, and its markers and gaps on the exported clock. Gaps are listed for
 * review only; nothing marks them in Resolve.
 */
export function StitchedPreview({ plan, markers }: { plan: ExportPlan; markers: Marker[] }) {
  const gaps = plan.gaps || [];
  if (!plan.pieces)
    return (
      <p className={s.muted} data-stitched-preview="whole">
        {gaps.length === 1 ? 'Its gap is' : 'Its gaps are'} too short to remove anything (a gap
        needs two keyframes inside), so this clip exports whole.
      </p>
    );
  const pieces = plan.pieces,
    total = piecesLength(pieces);
  let clock = 0;
  const joins = pieces.slice(0, -1).map((p) => (clock += p.end - p.start));
  const removed = gaps.filter((g) => g.removed);
  const rows = [
    ...markers
      .filter((m) => m.time >= plan.requested.start && m.time < plan.requested.end)
      .map((m) => {
        const at = toPieceTime(pieces, m.time);
        return { key: m.id, at, source: time(m.time), name: m.name, color: markerColor(m) };
      }),
    ...removed.map((g, i) => ({
      key: g.id,
      at: joins[i] ?? null,
      source: `${time(g.requested.start)} – ${time(g.requested.end)}`,
      name: `Gap ${gaps.indexOf(g) + 1} · ${time(g.removed!.end - g.removed!.start)} removed`,
      gap: true,
    })),
  ].sort((a, b) => (a.at ?? Infinity) - (b.at ?? Infinity));
  return (
    <section className={s.stitched} data-stitched-preview aria-label="As exported">
      <div className={s.stitchedHead}>
        <strong>As exported</strong>
        <span>
          {time(total)} · {pieces.length} pieces · {joins.length}{' '}
          {joins.length === 1 ? 'join' : 'joins'} · game audio FLAC, 10 ms fades at joins
        </span>
      </div>
      <div className={s.stitchedBar} aria-hidden="true">
        {joins.map((at, i) => (
          <span
            key={i}
            className={s.stitchedJoin}
            title={`Join ${i + 1}`}
            style={{ left: `${(100 * at) / total}%` }}
          >
            {seam}
          </span>
        ))}
        {rows
          .filter((r) => !('gap' in r) && r.at != null)
          .map((r) => (
            <i
              key={r.key}
              className={s.stitchedMarker}
              style={{ left: `${(100 * r.at!) / total}%`, background: 'color' in r ? r.color : '' }}
            />
          ))}
      </div>
      <div className={s.saveTableWrap}>
        <table className={s.saveTable} aria-label="Markers and gaps as exported">
          <thead>
            <tr>
              <th>Marker or gap</th>
              <th>Clip time</th>
              <th>Source time</th>
              <th>To Resolve</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.key}
                data-stitched-row={'gap' in r ? 'gap' : r.at == null ? 'left-out' : 'marker'}
              >
                <td>
                  {r.name}
                  {r.at == null && ' · left out'}
                </td>
                <td>{r.at == null ? '—' : time(r.at)}</td>
                <td>{r.source}</td>
                <td>{'gap' in r ? 'No, review only' : r.at == null ? 'No' : 'Marker'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
