import React from 'react';
import { Button } from './Button';
import { RefreshIcon } from './icons';

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    // Surfaces to window.onerror / any monitoring hook without using console.
    window.reportError?.(error);
    void errorInfo;
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '400px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '32px',
          textAlign: 'center',
          gap: '16px'
        }}>
          <h2 style={{ fontSize: '18px', fontWeight: 600, color: 'var(--ink-1, #1e293b)' }}>
            Something went wrong rendering this section
          </h2>
          <p style={{ maxWidth: '480px', color: 'var(--ink-2, #64748b)', fontSize: '13.5px', lineHeight: 1.5 }}>
            {this.state.error?.message || 'An unexpected error occurred.'}
          </p>
          <Button variant="primary" icon={<RefreshIcon size={14} />} onClick={this.handleReset}>
            Reload Page
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}
