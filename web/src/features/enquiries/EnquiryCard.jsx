import { ActionMenu } from '../../components/ui/ActionMenu';
import { Avatar } from '../../components/ui/Avatar';
import { Pill } from '../../components/ui/Pill';
import { formatRelativeTime } from '../../lib/format';

const initials = (name) => (name ?? '?').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');

/**
 * Kanban card. Drag handling lives on the board (so one place decides what a drop means); the menu is the
 * keyboard/touch alternative to dragging.
 */
export function EnquiryCard({ enquiry, pending, dragging, onOpen, onMove, onDragStart, onDragEnd, canMove }) {
  return (
    <article
      className={`enq-card ${pending ? 'is-pending' : ''} ${dragging ? 'is-dragging' : ''}`}
      draggable={canMove && !pending}
      onDragStart={(e) => {
        e.dataTransfer?.setData?.('text/plain', enquiry.id);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
        onDragStart(enquiry);
      }}
      onDragEnd={onDragEnd}
      aria-busy={pending}
      data-testid={`card-${enquiry.enquiryNo}`}
    >
      <div className="enq-card-top">
        <span className="id-chip">{enquiry.enquiryNo}</span>
        <ActionMenu
          label={`Actions for ${enquiry.enquiryNo}`}
          items={[
            { label: 'Open', onSelect: onOpen },
            { label: 'Move to…', hidden: !canMove, disabled: pending, onSelect: onMove },
          ]}
        />
      </div>
      <button type="button" className="enq-card-name" onClick={onOpen}>{enquiry.name}</button>
      <div className="enq-card-meta">
        <span>{enquiry.phone}</span>
        {enquiry.source && <Pill label={enquiry.source.label} size="sm" />}
        {enquiry.location && <span>{enquiry.location.label}</span>}
      </div>
      <div className="enq-card-meta">
        {enquiry.assignedToName ? (
          <>
            <Avatar initials={initials(enquiry.assignedToName)} size="sm" />
            <span>{enquiry.assignedToName}</span>
          </>
        ) : (
          <span>Unassigned</span>
        )}
        <span style={{ marginLeft: 'auto' }}>{formatRelativeTime(enquiry.stageChangedAt)}</span>
      </div>
    </article>
  );
}
