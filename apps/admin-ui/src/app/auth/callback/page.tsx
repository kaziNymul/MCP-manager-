'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { setAuthToken } from '@/lib/auth';

function AuthCallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = searchParams.get('token');
    const errorParam = searchParams.get('error');

    if (errorParam) {
      setError(decodeURIComponent(errorParam));
      return;
    }

    if (token) {
      // Store the token
      setAuthToken(token);
      
      // Redirect to dashboard
      router.push('/');
    } else {
      setError('No authentication token received');
    }
  }, [router, searchParams]);

  if (error) {
    return (
      <div className="callback-container">
        <div className="callback-card error">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </svg>
          <h2>Authentication Failed</h2>
          <p>{error}</p>
          <a href="/login" className="btn btn-primary">
            Try Again
          </a>
        </div>

        <style jsx>{`
          .callback-container {
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
          }

          .callback-card {
            background: var(--bg-secondary);
            border: 1px solid var(--border-color);
            border-radius: 12px;
            padding: 40px;
            text-align: center;
            max-width: 400px;
          }

          .callback-card.error {
            border-color: var(--accent-red);
          }

          .callback-card.error svg {
            color: var(--accent-red);
            margin-bottom: 16px;
          }

          .callback-card h2 {
            margin: 0 0 12px 0;
            color: var(--text-primary);
          }

          .callback-card p {
            color: var(--text-secondary);
            margin: 0 0 24px 0;
          }
        `}</style>
      </div>
    );
  }

  return (
    <div className="callback-container">
      <div className="callback-card">
        <div className="spinner" />
        <h2>Signing you in...</h2>
        <p>Please wait while we complete authentication</p>
      </div>

      <style jsx>{`
        .callback-container {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
        }

        .callback-card {
          background: var(--bg-secondary);
          border: 1px solid var(--border-color);
          border-radius: 12px;
          padding: 40px;
          text-align: center;
        }

        .spinner {
          width: 48px;
          height: 48px;
          border: 4px solid var(--border-color);
          border-top-color: var(--accent-blue);
          border-radius: 50%;
          animation: spin 1s linear infinite;
          margin: 0 auto 20px;
        }

        .callback-card h2 {
          margin: 0 0 8px 0;
          color: var(--text-primary);
        }

        .callback-card p {
          color: var(--text-secondary);
          margin: 0;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={
      <div style={{ 
        minHeight: '100vh', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)'
      }}>
        <p style={{ color: 'white' }}>Loading...</p>
      </div>
    }>
      <AuthCallbackContent />
    </Suspense>
  );
}
