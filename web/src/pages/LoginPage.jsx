import { Navigate, useLocation } from 'react-router-dom';
import { CompanyBrand } from '../components/brand/CompanyBrand';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { FormField } from '../components/ui/FormField';
import { Input } from '../components/ui/Input';
import { useAuth } from '../hooks/useAuth';
import { useBranding } from '../hooks/useBranding';
import { useForm } from '../hooks/useForm';
import { rules } from '../lib/validation';
import './pages.css';

const SCHEMA = {
  email: [rules.required('Enter your email'), rules.email()],
  password: [rules.required('Enter your password')],
};

export function LoginPage() {
  const { status, signIn } = useAuth();
  const { displayName } = useBranding();
  const location = useLocation();
  const form = useForm({
    initialValues: { email: '', password: '' },
    schema: SCHEMA,
    onSubmit: (v) => signIn(v.email, v.password),
  });

  if (status === 'authenticated') return <Navigate to={location.state?.from ?? '/dashboard'} replace />;

  return (
    <div className="page-center">
      <Card className="page-card">
        <form className="page-card" onSubmit={form.handleSubmit} noValidate>
          {/* The saved company logo and name, loaded before authentication so the login page is
              branded too. Both fall back to the bundled BuildFlow artwork until an administrator
              saves a profile. */}
          <CompanyBrand className="login-logo" />
          {/* One text node, so the heading reads as a single sentence to assistive tech. */}
          <h1>Sign in to {displayName}</h1>
          <FormField label="Email" htmlFor="login-email" error={form.errors.email}>
            <Input id="login-email" type="email" autoComplete="username" autoFocus value={form.values.email} onChange={form.handleChange('email')} />
          </FormField>
          <FormField label="Password" htmlFor="login-password" error={form.errors.password}>
            <Input id="login-password" type="password" autoComplete="current-password" value={form.values.password} onChange={form.handleChange('password')} />
          </FormField>
          {form.formError && (
            <p className="form-error" role="alert">
              {form.formError}
            </p>
          )}
          <Button type="submit" disabled={form.submitting}>
            {form.submitting ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
