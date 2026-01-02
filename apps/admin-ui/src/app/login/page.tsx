'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CONTROL_PLANE_URL, setAuthToken, isAuthenticated } from '@/lib/auth';

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [authConfig, setAuthConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [devLoginLoading, setDevLoginLoading] = useState(false);

  useEffect(() => {
    // Check for error from OAuth callback
    const errorParam = searchParams.get('error');
    if (errorParam) {
      setError(decodeURIComponent(errorParam));
    }

    // If already authenticated, redirect to dashboard
    if (isAuthenticated()) {
      router.push('/');
      return;
    }

    // Fetch auth configuration
    fetch(`${CONTROL_PLANE_URL}/api/auth/config`)
      .then(res => res.json())
      .then(data => {
        setAuthConfig(data);
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to fetch auth config:', err);
        setError('Failed to connect to server');
        setLoading(false);
      });
  }, [router, searchParams]);

  const handleAzureAdLogin = () => {
    // Redirect to Azure AD login
    window.location.href = `${CONTROL_PLANE_URL}/api/auth/login`;
  };

  const handleDevLogin = async (role: 'ADMIN' | 'MEMBER') => {
    setDevLoginLoading(true);
    try {
      const response = await fetch(`${CONTROL_PLANE_URL}/api/auth/dev-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      });

      if (!response.ok) {
        throw new Error('Login failed');
      }

      const data = await response.json();
      setAuthToken(data.token);
      router.push('/');
    } catch (err) {
      setError('Development login failed');
    } finally {
      setDevLoginLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="login-container">
        <div className="login-card">
          <div className="loading-spinner" />
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="login-logo">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2L2 7l10 5 10-5-10-5z" />
            <path d="M2 17l10 5 10-5" />
            <path d="M2 12l10 5 10-5" />
          </svg>
        </div>
        
        <h1>MCP Manager</h1>
        <p className="login-subtitle">Enterprise MCP Server Governance</p>

        {error && (
          <div className="alert alert-error">
            <strong>Error:</strong> {error}
          </div>
        )}

        {authConfig?.mode === 'oidc' ? (
          <>
            <p className="login-info">
              Sign in with your corporate credentials
            </p>
            
            <button
              className="btn btn-primary btn-large btn-azure"
              onClick={handleAzureAdLogin}
            >
              <svg width="20" height="20" viewBox="0 0 21 21" fill="currentColor">
                <path d="M0 0h10v10H0V0zm11 0h10v10H11V0zM0 11h10v10H0V11zm11 0h10v10H11V11z"/>
              </svg>
              Sign in with Microsoft
            </button>

            <p className="login-footer">
              Your access level is determined by your AD group membership
            </p>
          </>
        ) : (
          <>
            <div className="dev-mode-notice">
              <span className="badge badge-warning">Development Mode</span>
              <p>Azure AD SSO is not configured. Using development authentication.</p>
            </div>

            <div className="dev-login-options">
              <button
                className="btn btn-primary"
                onClick={() => handleDevLogin('ADMIN')}
                disabled={devLoginLoading}
              >
                {devLoginLoading ? 'Logging in...' : 'Login as Admin'}
              </button>
              
              <button
                className="btn btn-secondary"
                onClick={() => handleDevLogin('MEMBER')}
                disabled={devLoginLoading}
              >
                {devLoginLoading ? 'Logging in...' : 'Login as User'}
              </button>
            </div>

            <p className="login-footer">
              <strong>Admin:</strong> Full access including server approval<br/>
              <strong>User:</strong> Can register and manage own servers
            </p>
          </>
        )}
      </div>

      <style jsx>{`
        .login-container {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
          padding: 20px;
        }

        .login-card {
          background: var(--bg-secondary);
          border: 1px solid var(--border-color);
          border-radius: 12px;
          padding: 40px;
          max-width: 420px;
          width: 100%;
          text-align: center;
          box-shadow: 0 4px 24px rgba(0, 0, 0, 0.3);
        }

        .login-logo {
          color: var(--accent-blue);
          margin-bottom: 20px;
        }

        .login-card h1 {
          margin: 0 0 8px 0;
          font-size: 28px;
          color: var(--text-primary);
        }

        .login-subtitle {
          color: var(--text-secondary);
          margin: 0 0 24px 0;
        }

        .login-info {
          color: var(--text-secondary);
          margin-bottom: 24px;
        }

        .alert-error {
          background: rgba(239, 68, 68, 0.1);
          border: 1px solid var(--accent-red);
          color: var(--accent-red);
          padding: 12px 16px;
          border-radius: 8px;
          margin-bottom: 20px;
          text-align: left;
        }

        .btn-large {
          width: 100%;
          padding: 14px 24px;
          font-size: 16px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
        }

        .btn-azure {
          background: #0078d4;
          border-color: #0078d4;
        }

        .btn-azure:hover {
          background: #106ebe;
          border-color: #106ebe;
        }

        .dev-mode-notice {
          background: rgba(234, 179, 8, 0.1);
          border: 1px solid var(--accent-yellow);
          border-radius: 8px;
          padding: 16px;
          margin-bottom: 24px;
        }

        .dev-mode-notice .badge {
          margin-bottom: 8px;
        }

        .dev-mode-notice p {
          margin: 0;
          color: var(--text-secondary);
          font-size: 14px;
        }

        .dev-login-options {
          display: flex;
          flex-direction: column;
          gap: 12px;
          margin-bottom: 20px;
        }

        .dev-login-options .btn {
          width: 100%;
          padding: 12px 24px;
        }

        .login-footer {
          color: var(--text-secondary);
          font-size: 13px;
          margin: 20px 0 0 0;
          line-height: 1.6;
        }

        .loading-spinner {
          width: 40px;
          height: 40px;
          border: 3px solid var(--border-color);
          border-top-color: var(--accent-blue);
          border-radius: 50%;
          animation: spin 1s linear infinite;
          margin: 0 auto 16px;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

export default function LoginPage() {
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
      <LoginContent />
    </Suspense>
  );
}
