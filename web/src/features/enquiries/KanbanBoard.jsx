import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { fetchTransitions, useBoard } from '../../api/enquiries';
import { QueryState } from '../../components/data/QueryState';
import { useToast } from '../../hooks/useToast';
import { EnquiryCard } from './EnquiryCard';
import { MoveToDialog } from './MoveToDialog';
import { useStageMover } from './useStageMover';
import './enquiries.css';

/**
 * Enquiry Kanban. Columns are the configured workflow stages (nothing hard-coded). Dragging asks the
 * BACKEND which moves are valid from the card's stage (`GET /workflow/transitions`) and only offers
 * those columns as drop targets; the drop then goes through the same state machine on the server,
 * which validates it again. A card never moves on screen until the server confirms.
 */
export function KanbanBoard({ params }) {
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const board = useBoard(params);
  const mover = useStageMover();
  const [drag, setDrag] = useState(null); // { enquiry, targets: Map<stageKey, transition> | null }
  const [moveTo, setMoveTo] = useState(null);

  async function onDragStart(enquiry) {
    setDrag({ enquiry, targets: null });
    try {
      const list = await fetchTransitions(queryClient, enquiry.stageCode);
      setDrag((d) => (d?.enquiry.id === enquiry.id ? { enquiry, targets: new Map(list.map((t) => [t.to, t])) } : d));
    } catch (err) {
      toast.error(err.message);
      setDrag(null);
    }
  }

  function onDrop(column) {
    const current = drag;
    setDrag(null);
    if (!current || column.systemKey === current.enquiry.stageCode) return;
    const target = current.targets?.get(column.systemKey);
    if (!target) {
      toast.error(`${current.enquiry.enquiryNo} cannot be moved from ${current.enquiry.stage.label} to ${column.label}.`);
      return;
    }
    mover.requestMove(current.enquiry, { ...target, label: column.label });
  }

  const dropState = (column) => {
    if (!drag || column.systemKey === drag.enquiry.stageCode) return '';
    if (!drag.targets) return '';
    const t = drag.targets.get(column.systemKey);
    return t ? (t.domainOperation ? 'is-domain' : 'is-droppable') : 'is-blocked';
  };

  return (
    <QueryState query={board} isEmpty={(d) => d.stages.length === 0} empty={{ title: 'No workflow stages', description: 'Run the seed to create the default pipeline.' }}>
      {(data) => (
        <>
          <div className="board" role="list" aria-label="Enquiry pipeline">
            {data.stages.map((col) => (
              <section
                key={col.systemKey}
                role="listitem"
                aria-label={col.label}
                className={`board-col ${dropState(col)}`}
                style={{ '--col-color': col.color }}
                data-testid={`col-${col.systemKey}`}
                onDragOver={(e) => {
                  if (drag) e.preventDefault(); // allow dropping; what a drop means is decided in onDrop
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  onDrop(col);
                }}
              >
                <header className="board-col-head">
                  <span>{col.label}{!col.isActive && ' (inactive)'}</span>
                  <span className="board-count">{col.count}</span>
                </header>
                {dropState(col) === 'is-domain' && <div className="board-hint">Set by its own action</div>}
                <div className="board-cards">
                  {col.cards.map((c) => (
                    <EnquiryCard
                      key={c.id}
                      enquiry={c}
                      pending={mover.pendingId === c.id}
                      dragging={drag?.enquiry.id === c.id}
                      canMove
                      onOpen={() => navigate(`/enquiries/${c.id}`)}
                      onMove={() => setMoveTo(c)}
                      onDragStart={onDragStart}
                      onDragEnd={() => setDrag(null)}
                    />
                  ))}
                  {col.count === 0 && <div className="board-hint">No enquiries</div>}
                </div>
                {col.count > col.cards.length && (
                  <div className="board-more">
                    <Link to={`/enquiries?stage=${col.systemKey}`}>{col.count - col.cards.length} more — view in list</Link>
                  </div>
                )}
              </section>
            ))}
          </div>
          {moveTo && (
            <MoveToDialog
              enquiry={moveTo}
              onClose={() => setMoveTo(null)}
              onPick={(target) => {
                const e = moveTo;
                setMoveTo(null);
                mover.requestMove(e, target);
              }}
            />
          )}
          {mover.dialog}
        </>
      )}
    </QueryState>
  );
}
