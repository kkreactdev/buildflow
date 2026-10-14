import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';

/** Shared shell for the admin create/edit dialogs: title, error line, cancel/save. */
export function AdminFormModal({ open, onClose, title, form, submitLabel = 'Save', children, size = 'md' }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size={size}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={form.submitting}>
            Cancel
          </Button>
          <Button onClick={form.handleSubmit} disabled={form.submitting}>
            {form.submitting ? 'Saving…' : submitLabel}
          </Button>
        </>
      }
    >
      <form className="admin-form" onSubmit={form.handleSubmit} noValidate>
        {children}
        {form.formError && (
          <p className="form-error" role="alert">
            {form.formError}
          </p>
        )}
      </form>
    </Modal>
  );
}
