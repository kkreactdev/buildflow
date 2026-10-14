import { useCallback, useState } from 'react';
import { ApiError } from '../api/http';
import { validate } from '../lib/validation';

/**
 * Form state + client validation + server error mapping.
 *   const form = useForm({ initialValues, schema, onSubmit });
 *   <Input value={form.values.name} onChange={form.handleChange('name')} />
 *   <FormField error={form.errors.name} .../>
 * A server `VALIDATION_ERROR` is mapped onto fields; any other failure is
 * exposed as `form.formError` for the caller to display.
 */
export function useForm({ initialValues, schema = {}, onSubmit }) {
  const [values, setValues] = useState(initialValues);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const setValue = useCallback((field, value) => {
    setValues((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev));
  }, []);

  const handleChange = useCallback(
    (field) => (eventOrValue) => {
      const value = eventOrValue?.target ? (eventOrValue.target.type === 'checkbox' ? eventOrValue.target.checked : eventOrValue.target.value) : eventOrValue;
      setValue(field, value);
    },
    [setValue],
  );

  const handleSubmit = useCallback(
    async (event) => {
      event?.preventDefault?.();
      setFormError(null);
      const clientErrors = validate(values, schema);
      setErrors(clientErrors);
      if (Object.keys(clientErrors).length) return false;

      setSubmitting(true);
      try {
        await onSubmit(values);
        return true;
      } catch (err) {
        if (err instanceof ApiError && Object.keys(err.fieldErrors).length) {
          setErrors(err.fieldErrors);
        } else {
          setFormError(err instanceof Error ? err.message : 'Something went wrong');
        }
        return false;
      } finally {
        setSubmitting(false);
      }
    },
    [values, schema, onSubmit],
  );

  const reset = useCallback(
    (next = initialValues) => {
      setValues(next);
      setErrors({});
      setFormError(null);
    },
    [initialValues],
  );

  return { values, errors, formError, submitting, setValue, handleChange, handleSubmit, reset };
}
