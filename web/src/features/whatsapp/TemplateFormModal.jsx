import { useRef } from 'react';
import { useTemplateMutations, useTemplateVariables } from '../../api/whatsappTemplates';
import { MasterSelect } from '../../components/data/MasterSelect';
import { FormField } from '../../components/ui/FormField';
import { Input } from '../../components/ui/Input';
import { Switch } from '../../components/ui/Switch';
import { Textarea } from '../../components/ui/Textarea';
import { useForm } from '../../hooks/useForm';
import { useToast } from '../../hooks/useToast';
import { rules } from '../../lib/validation';
import { AdminFormModal } from '../admin/AdminFormModal';
import { checkBody } from './templateCheck';
import './whatsapp.css';

/** Create or edit a template. Category and event come from the WhatsApp masters; placeholders from the server's supported list. */
export function TemplateFormModal({ template, onClose }) {
  const toast = useToast();
  const { create, update } = useTemplateMutations();
  const vars = useTemplateVariables();
  const bodyRef = useRef(null);
  const editing = Boolean(template);
  const keys = (vars.data ?? []).map((v) => v.key);

  const form = useForm({
    initialValues: { name: template?.name ?? '', categoryId: template?.categoryId ?? '', eventId: template?.eventId ?? '', body: template?.body ?? '', isActive: template?.isActive ?? true },
    schema: {
      name: [rules.required('Give the template a name'), rules.minLength(2, 'At least 2 characters')],
      categoryId: [rules.required('Choose a category')],
      eventId: [rules.required('Choose an event')],
      body: [rules.required('Write the message'), (v) => checkBody(v ?? '', keys)[0] ?? null],
    },
    onSubmit: async (v) => {
      if (editing) {
        const patch = {};
        for (const f of ['name', 'categoryId', 'eventId', 'body', 'isActive']) if (v[f] !== template[f]) patch[f] = v[f];
        if (Object.keys(patch).length) await update.mutateAsync({ id: template.id, ...patch });
        toast.success('Template updated');
      } else {
        await create.mutateAsync({ name: v.name.trim(), categoryId: v.categoryId, eventId: v.eventId, body: v.body, isActive: v.isActive });
        toast.success('Template created');
      }
      onClose();
    },
  });

  function insert(token) {
    const el = bodyRef.current;
    const value = form.values.body;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    form.handleChange('body')(value.slice(0, start) + token + value.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  }
  const issues = checkBody(form.values.body, keys);

  return (
    <AdminFormModal open onClose={onClose} title={editing ? `Edit ${template.name}` : 'New WhatsApp template'} form={form} submitLabel={editing ? 'Save' : 'Create template'} size="lg">
      <FormField label="Name" htmlFor="wt-name" required error={form.errors.name}>
        <Input id="wt-name" value={form.values.name} onChange={form.handleChange('name')} maxLength={120} />
      </FormField>
      <FormField label="Category" htmlFor="wt-category" required error={form.errors.categoryId}>
        <MasterSelect id="wt-category" type="WA_CATEGORY" value={form.values.categoryId} onChange={form.handleChange('categoryId')} placeholder="Select category…" />
      </FormField>
      <FormField label="Event" htmlFor="wt-event" required error={form.errors.eventId} hint="The business event this message is for.">
        <MasterSelect id="wt-event" type="WA_EVENT" value={form.values.eventId} onChange={form.handleChange('eventId')} placeholder="Select event…" />
      </FormField>
      <FormField label="Message" htmlFor="wt-body" required error={form.errors.body} hint="Insert placeholders from the list; they are filled in from the record when messages are enabled in a later release.">
        <Textarea id="wt-body" ref={bodyRef} rows={5} value={form.values.body} onChange={form.handleChange('body')} maxLength={1024} />
      </FormField>
      <div className="var-picker" role="group" aria-label="Placeholders">
        {(vars.data ?? []).map((v) => (
          <button key={v.key} type="button" className="var-chip" title={v.description} onClick={() => insert(v.token)}>{v.label}</button>
        ))}
        {vars.isError && <span className="muted">Could not load the placeholder list.</span>}
      </div>
      {issues.length > 0 && (
        <ul className="tpl-issues" aria-label="Message problems">
          {issues.map((m) => <li key={m}>{m}</li>)}
        </ul>
      )}
      <Switch checked={form.values.isActive} onChange={(v) => form.handleChange('isActive')(v)} label="Enabled" description="Disabled templates are kept but not offered for use." />
    </AdminFormModal>
  );
}
