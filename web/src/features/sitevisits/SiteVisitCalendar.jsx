import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSiteVisits } from '../../api/sitevisits';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { Modal } from '../../components/ui/Modal';
import { Skeleton } from '../../components/ui/Skeleton';
import { SiteVisitFormModal } from './SiteVisitFormModal';
import { VisitStatusPill } from './VisitStatusPill';
import './sitevisits-calendar.css';

const MAX_VISITS_PER_CELL = 3;
/** Every month view shows a 6-row grid (42 cells) so the layout never reflows across months. */
const MONTH_ROWS = 6;
const MONTH_CELLS = MONTH_ROWS * 7;

/** A single ISO date YYYY-MM-DD in the user's local time zone. */
function localIso(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Start of the calendar grid for a given month view anchor (Sunday-of-week containing day 1). */
function monthGridStart(anchor) {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  return new Date(first.getFullYear(), first.getMonth(), 1 - first.getDay());
}

/** Add `days` whole calendar days to a Date. */
function addDays(d, days) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
}

/** "08 Oct 2026" — used in cell headers and the "current range" label. */
function formatLong(d) {
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** "Oct 2026" — used in the current-range label for month view. */
function formatMonthYear(d) {
  return d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}

/** "08 Oct" — compact date used in the "current range" label for week view. */
function formatShort(d) {
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

/**
 * Visit shape used by the calendar. Kept narrow on purpose: the calendar never reads
 * fields beyond what a compact cell needs (time, name, unit, status). Anything else
 * comes from the detail page the click navigates to.
 */
function visitTime(v) {
  return new Date(v.scheduledAt);
}

/** Pick the local YYYY-MM-DD key for a visit; the picker page uses this for grouping. */
function visitDayKey(v) {
  return localIso(visitTime(v));
}

/**
 * Build the 42-cell grid for a month view. Returns Date objects, never ISO strings:
 * the cells are compared with `setHours(0,0,0,0)` so day boundaries are exact in local time.
 */
function buildMonthCells(anchor) {
  const start = monthGridStart(anchor);
  return Array.from({ length: MONTH_CELLS }, (_, i) => addDays(start, i));
}

/** The 7 days of the week starting on the same day as `anchor`. */
function buildWeekDays(anchor) {
  return Array.from({ length: 7 }, (_, i) => addDays(anchor, i - anchor.getDay()));
}

/** Render the visit's "time" in the cell, e.g. "10:30 am" in local time. */
function visitClockLabel(v) {
  return visitTime(v).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}

/** Choose a compact unit label: unitCode (if any) else property name trimmed. */
function visitUnitLabel(v) {
  if (v.units?.length) return v.units.map((u) => u.unitCode).join(', ');
  return '';
}

/**
 * Site Visits calendar. Renders the visits that fall inside the visible range (month or week)
 * using the existing Site Visits API and the same filters as the list view, so the two never
 * disagree. Clicking a visit opens its detail page; clicking a day or "Add visit" opens the
 * schedule modal with that day prefilled as a hint — the modal stores the actual time the
 * user picks, so the calendar never silently edits a visit's `scheduledAt`.
 */
export function SiteVisitCalendar({ filters, canCreate, initialDate }) {
  const navigate = useNavigate();
  const [view, setView] = useState('month'); // 'month' | 'week'
  // Anchor date: any day inside the visible range. We compute cells from it. `initialDate`
  // is an override (a Date instance) used by tests and any future "jump to date" entry point;
  // the anchor is initialised from `initialDate` and updated only by user navigation (Prev/Next/
  // Today), never silently when the prop changes — the explicit "Today" button is the only
  // way to re-anchor to a different day.
  const [anchor, setAnchor] = useState(() => (initialDate ? new Date(initialDate) : new Date()));
  const [scheduling, setScheduling] = useState(null); // { defaultDate: 'YYYY-MM-DD' } or null
  // The full list of one day, opened from a cell's "+N more". `visits` is a snapshot taken from
  // the current month's result, so the dialog always shows exactly what the cell promised.
  const [dayDetail, setDayDetail] = useState(null); // { key, label, visits } or null

  // Pick a stable "today" so the today/prev/next tests can lock time without freezing the clock.
  const today = useMemo(() => {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    return t;
  }, []);
  const todayKey = localIso(today);

  const cells = useMemo(() => (view === 'month' ? buildMonthCells(anchor) : buildWeekDays(anchor)), [view, anchor]);
  const rangeStart = cells[0];
  const rangeEnd = addDays(cells[cells.length - 1], 1);
  // The API takes an inclusive `from` / `to`. We send the start of the first day and the END of
  // the last day so visits at exactly 23:59 on the boundary still belong to the last cell.
  const fromIso = rangeStart.toISOString();
  const toIso = new Date(rangeEnd.getTime() - 1).toISOString();

  const query = useSiteVisits(
    {
      ...filters,
      from: fromIso,
      to: toIso,
      // The shared list endpoint caps `limit` at MAX_PAGE_SIZE (100) and rejects anything larger with
      // a validation error — that cap is the contract, so ask for exactly the maximum rather than
      // the 500 this used to send, which is what made the calendar render "Validation failed"
      // instead of the month. A single month of visits is well under this in practice.
      limit: 100,
      sort: 'scheduledAt',
    },
    { enabled: Boolean(fromIso && toIso) },
  );

  // Group visits by local YYYY-MM-DD so the cells can render without re-keying on every render.
  // Sort within each day by time so the order in the cell is always chronological.
  const byDay = useMemo(() => {
    const out = new Map();
    for (const v of query.data?.rows ?? []) {
      const key = visitDayKey(v);
      if (!out.has(key)) out.set(key, []);
      out.get(key).push(v);
    }
    for (const list of out.values()) list.sort((a, b) => visitTime(a) - visitTime(b));
    return out;
  }, [query.data?.rows]);

  const rangeLabel = view === 'month'
    ? formatMonthYear(anchor)
    : `${formatShort(rangeStart)} – ${formatShort(addDays(rangeEnd, -1))} ${rangeStart.getFullYear() !== addDays(rangeEnd, -1).getFullYear() ? rangeStart.getFullYear() : ''}`.trim();

  function go(delta) {
    if (view === 'month') setAnchor((d) => new Date(d.getFullYear(), d.getMonth() + delta, 1));
    else setAnchor((d) => addDays(d, 7 * delta));
  }
  function gotoToday() {
    setAnchor(new Date());
  }

  // Open the schedule modal for `cellDate`; the modal pre-fills the date but the user
  // picks the exact time, so the calendar never rewrites visit times itself.
  function openSchedule(cellDate) {
    if (!canCreate) return;
    setScheduling({ defaultDate: localIso(cellDate) });
  }

  // Keyboard support: arrow keys move the focus day, Enter opens it. Focused day resets when
  // the view (month/week) or anchor (Prev/Next/Today) changes so the focus never lingers on
  // a cell that's no longer visible.
  const [focusedKey, setFocusedKey] = useState(todayKey);
  useEffect(() => {
    setFocusedKey(todayKey);
  }, [todayKey, view]);

  function onCellKey(e, cellDate) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openSchedule(cellDate); return; }
    const idx = cells.findIndex((c) => localIso(c) === localIso(cellDate));
    if (idx < 0) return;
    let next = idx;
    if (e.key === 'ArrowRight') next = idx + 1;
    else if (e.key === 'ArrowLeft') next = idx - 1;
    else if (e.key === 'ArrowDown') next = idx + 7;
    else if (e.key === 'ArrowUp') next = idx - 7;
    else return;
    e.preventDefault();
    if (next >= 0 && next < cells.length) {
      const target = cells[next];
      setFocusedKey(localIso(target));
      // The cell is rendered in the next paint; focus by query selector to avoid a stale ref.
      requestAnimationFrame(() => {
        const el = document.querySelector(`[data-cal-day="${localIso(target)}"]`);
        if (el instanceof HTMLElement) el.focus();
      });
    }
  }

  return (
    <div className="sv-calendar" aria-label="Site visits calendar">
      <div className="sv-calendar-toolbar">
        <div className="sv-calendar-nav">
          <Button variant="secondary" onClick={() => go(-1)} aria-label={`Previous ${view}`}>‹</Button>
          <Button variant="secondary" onClick={gotoToday}>Today</Button>
          <Button variant="secondary" onClick={() => go(1)} aria-label={`Next ${view}`}>›</Button>
        </div>
        <div className="sv-calendar-range" aria-live="polite">{rangeLabel}</div>
        <div className="sv-calendar-viewtoggle" role="tablist" aria-label="Calendar view">
          <button type="button" role="tab" aria-selected={view === 'month'} className={`sv-calendar-viewtoggle-item ${view === 'month' ? 'is-active' : ''}`} onClick={() => setView('month')}>Month</button>
          <button type="button" role="tab" aria-selected={view === 'week'} className={`sv-calendar-viewtoggle-item ${view === 'week' ? 'is-active' : ''}`} onClick={() => setView('week')}>Week</button>
        </div>
      </div>

      {query.isPending && <Skeleton height={220} />}

      {query.isError && (
        <div className="sv-calendar-error" role="alert">
          <p className="form-error">{query.error.message}</p>
        </div>
      )}

      {!query.isPending && !query.isError && (
        <div className={`sv-calendar-grid sv-calendar-grid--${view}`} role="grid" aria-label={`Site visits, ${view} view`}>
          <div className="sv-calendar-row sv-calendar-row--head" role="row">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
              <div key={d} className="sv-calendar-cell sv-calendar-cell--head" role="columnheader">{d}</div>
            ))}
          </div>
          {Array.from({ length: view === 'month' ? MONTH_ROWS : 1 }, (_, rowIdx) => (
            <div key={rowIdx} className="sv-calendar-row" role="row">
              {cells.slice(rowIdx * 7, rowIdx * 7 + 7).map((cellDate) => {
                const key = localIso(cellDate);
                const list = byDay.get(key) ?? [];
                const inMonth = view === 'week' || cellDate.getMonth() === anchor.getMonth();
                const isToday = key === todayKey;
                const isFocused = key === focusedKey;
                const overflow = list.length > MAX_VISITS_PER_CELL;
                const visible = overflow ? list.slice(0, MAX_VISITS_PER_CELL) : list;
                return (
                  <div
                    key={key}
                    className={`sv-calendar-cell sv-calendar-cell--day ${inMonth ? '' : 'is-other-month'} ${isToday ? 'is-today' : ''}`}
                    role="gridcell"
                    tabIndex={isFocused ? 0 : -1}
                    data-cal-day={key}
                    onKeyDown={(e) => onCellKey(e, cellDate)}
                    aria-label={`${formatLong(cellDate)}${list.length ? `, ${list.length} visit${list.length === 1 ? '' : 's'}` : ''}`}
                  >
                    <div className="sv-calendar-cell-head">
                      <span className="sv-calendar-daynum">{cellDate.getDate()}</span>
                      <button
                        type="button"
                        className="sv-calendar-add"
                        onClick={() => openSchedule(cellDate)}
                        disabled={!canCreate}
                        aria-label={`Schedule a visit on ${formatLong(cellDate)}`}
                        title={canCreate ? 'Schedule a visit' : 'You do not have permission to schedule visits'}
                      >+</button>
                    </div>
                    <ul className="sv-calendar-events" aria-label={`Visits on ${formatLong(cellDate)}`}>
                      {visible.map((v) => (
                        <li key={v.id} className={`sv-calendar-event ${v.statusKey === 'COMPLETED' ? 'is-completed' : v.statusKey === 'CANCELLED' ? 'is-cancelled' : 'is-scheduled'}`}>
                          <button
                            type="button"
                            className="sv-calendar-event-btn"
                            onClick={() => navigate(`/site-visits/${v.id}`)}
                            aria-label={`${visitClockLabel(v)} ${v.name}${visitUnitLabel(v) ? `, ${visitUnitLabel(v)}` : ''} — ${v.status?.label ?? v.statusKey}`}
                          >
                            <span className="sv-calendar-event-time">{visitClockLabel(v)}</span>
                            <span className="sv-calendar-event-name">{v.name}</span>
                            {visitUnitLabel(v) && <span className="sv-calendar-event-unit">{visitUnitLabel(v)}</span>}
                            <VisitStatusPill visit={v} />
                          </button>
                        </li>
                      ))}
                      {overflow && (
                        <li className="sv-calendar-overflow">
                          <button
                            type="button"
                            className="sv-calendar-overflow-btn"
                            onClick={() => setDayDetail({ key, label: formatLong(cellDate), visits: list })}
                            aria-label={`Show all ${list.length} visits on ${formatLong(cellDate)}`}
                          >
                            +{list.length - MAX_VISITS_PER_CELL} more
                          </button>
                        </li>
                      )}
                    </ul>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {/* Empty state: range rendered but no visits at all. The list view has its own empty
          message, which keeps the wording consistent and avoids two empty states on the same page. */}
      {!query.isPending && !query.isError && (query.data?.rows?.length ?? 0) === 0 && (
        <EmptyState
          title="No visits in this range"
          description={view === 'month' ? 'Nothing scheduled for the visible month.' : 'Nothing scheduled for the visible week.'}
          action={canCreate ? <Button onClick={() => openSchedule(today)}>Schedule a visit</Button> : null}
        />
      )}

      {scheduling && (
        <SiteVisitFormModal
          defaultWhen={scheduling.defaultDate}
          onClose={() => setScheduling(null)}
          onCreated={(v) => navigate(`/site-visits/${v.id}`)}
        />
      )}

      {/* A cell can only show a few visits; "+N more" opens the whole day here, so nothing is
          hidden behind an indicator the user cannot act on. */}
      <Modal
        open={Boolean(dayDetail)}
        onClose={() => setDayDetail(null)}
        title={dayDetail ? `Visits on ${dayDetail.label}` : 'Visits'}
        subtitle={dayDetail ? `${dayDetail.visits.length} visit${dayDetail.visits.length === 1 ? '' : 's'}` : undefined}
        size="md"
      >
        <ul className="sv-calendar-daylist">
          {dayDetail?.visits.map((v) => (
            <li key={v.id} className="visit-row">
              <div>
                <button type="button" className="sv-calendar-daylist-open" onClick={() => navigate(`/site-visits/${v.id}`)}>
                  <span className="sv-calendar-event-time">{visitClockLabel(v)}</span> <strong>{v.name}</strong>
                </button>
                <div className="muted">
                  <VisitStatusPill visit={v} />
                  {visitUnitLabel(v) ? ` · ${visitUnitLabel(v)}` : ''}
                  {v.enquiryNo ? ` · ${v.enquiryNo}` : ''}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </Modal>
    </div>
  );
}
