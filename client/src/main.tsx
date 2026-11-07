import React, { Component, type ReactNode } from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './styles.css';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Driver App Render Error:', error, info);
  }

  handleReset = () => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {}
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: 24,
          fontFamily: '-apple-system, sans-serif',
          color: '#0f172a',
          maxWidth: 420,
          margin: '40px auto',
          background: '#ffffff',
          borderRadius: 20,
          boxShadow: '0 10px 30px rgba(0,0,0,0.1)',
        }}>
          <h2 style={{ fontSize: 18, color: '#ef4444', marginBottom: 8 }}>Terjadi Kesalahan Tampilan</h2>
          <p style={{ fontSize: 13, color: '#64748b', marginBottom: 16 }}>
            {this.state.error?.message || 'Gagal merender aplikasi driver.'}
          </p>
          <button
            type="button"
            onClick={this.handleReset}
            style={{
              background: '#4f46e5',
              color: '#fff',
              border: 'none',
              padding: '12px 18px',
              borderRadius: 12,
              fontWeight: 700,
              cursor: 'pointer',
              width: '100%',
            }}
          >
            Bersihkan Cache &amp; Muat Ulang
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);

// Only register ServiceWorker in production build
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
} else if ('serviceWorker' in navigator) {
  // In development: unregister any stale service worker and clear caches to prevent white screens
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    for (const r of registrations) r.unregister();
  });
  if ('caches' in window) {
    caches.keys().then((keys) => {
      for (const k of keys) caches.delete(k);
    });
  }
}
