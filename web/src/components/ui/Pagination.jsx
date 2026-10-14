import { IconButton } from './IconButton';
import { ChevronRightIcon } from './icons';
import './Pagination.css';

export function Pagination({ page, totalPages, totalCount, pageSize, onPageChange }) {
  if (totalPages <= 1) return null;

  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, totalCount);

  return (
    <div className="pagination">
      <span className="pagination-summary mono">
        {start}–{end} of {totalCount}
      </span>
      <div className="pagination-controls">
        <IconButton
          icon={<ChevronRightIcon size={15} style={{ transform: 'rotate(180deg)' }} />}
          label="Previous page"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        />
        <span className="pagination-page mono">
          Page {page} of {totalPages}
        </span>
        <IconButton
          icon={<ChevronRightIcon size={15} />}
          label="Next page"
          size="sm"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        />
      </div>
    </div>
  );
}
