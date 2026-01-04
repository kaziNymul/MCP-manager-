'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CONTROL_PLANE_URL, setAuthToken, isAuthenticated } from '@/lib/auth';

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [authConfig, setAuthConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [loginLoading, setLoginLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Form state
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  useEffect(() => {
    // Check for error from callback
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

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoginLoading(true);

    try {
      const response = await fetch(`${CONTROL_PLANE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Login failed');
      }

      setAuthToken(data.token);
      router.push('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoginLoading(false);
    }
  };

  const handleDevLogin = async (role: 'ADMIN' | 'MEMBER') => {
    setLoginLoading(true);
    setError(null);
    
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
      setLoginLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="login-container">
        <div className="login-card">
          <div className="loading-spinner" />
          <p>Loading...</p>
        </div>
        <style jsx>{styles}</style>
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

        {authConfig?.mode === 'ldap' ? (
          <>
            <p className="login-info">
              Sign in with your corporate credentials
              {authConfig.domain && <span className="domain-hint"> ({authConfig.domain})</span>}
            </p>
            
            <form onSubmit={handleLogin} className="login-form">
              <div className="form-group">
                <label htmlFor="username">Username</label>
                <input
                  type="text"
                  id="username"
                  placeholder={authConfig.domain ? `${authConfig.domain}\\username or username` : 'Enter your username'}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={loginLoading}
                  autoComplete="username"
                  autoFocus
                  required
                />
              </div>
              
              <div className="form-group">
                <label htmlFor="password">Password</label>
                <input
                  type="password"
                  id="password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loginLoading}
                  autoComplete="current-password"
                  required
                />
              </div>

              <button
                type="submit"
                className="btn btn-primary btn-large"
                disabled={loginLoading || !username || !password}
              >
                {loginLoading ? (
                  <>
                    <span className="btn-spinner" />
                    Signing in...
                  </>
                ) : (
                  <>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
                      <polyline points="10 17 15 12 10 7" />
                      <line x1="15" y1="12" x2="3" y2="12" />
                    </svg>
                    Sign In
                  </>
                )}
              </button>
            </form>

            <p className="login-footer">
              Your access level is determined by your AD group membership
            </p>
          </>
        ) : (
          <>
            <div className="dev-mode-notice">
              <span className="badge badge-warning">Development Mode</span>
              <p>Active Directory is not configured. Using development authentication.</p>
            </div>

            <form onSubmit={handleLogin} className="login-form">
              <div className="form-group">
                <label htmlFor="username">Username</label>
                <input
                  type="text"
                  id="username"
                  placeholder="Enter username (e.g., admin)"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={loginLoading}
                  autoComplete="username"
                  autoFocus
                />
              </div>
              
              <div className="form-group">
                <label htmlFor="password">Password</label>
                <input
                  type="password"
                  id="password"
                  placeholder="Enter any password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loginLoading}
                  autoComplete="current-password"
                />
              </div>

              <button
                type="submit"
                className="btn btn-primary btn-large"
                disabled={loginLoading || !username}
              >
                {loginLoading ? 'Signing in...' : 'Sign In'}
              </button>
            </form>

            <div className="divider">
              <span>or use quick login</span>
            </div>

            <div className="dev-login-options">
              <button
                className="btn btn-secondary"
                onClick={() => handleDevLogin('ADMIN')}
                disabled={loginLoading}
              >
                Login as Admin
              </button>
              
              <button
                className="btn btn-outline"
                onClick={() => handleDevLogin('MEMBER')}
                disabled={loginLoading}
              >
                Login as User
              </button>
            </div>

            <p className="login-footer">
              <strong>Admin:</strong> Full access including server approval<br/>
              <strong>User:</strong> Can register and manage own servers
            </p>
          </>
        )}
      </div>

      <style jsx>{styles}</style>
    </div>
  );
}

const styles = `
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

  .domain-hint {
    color: var(--accent-blue);
    font-weight: 500;
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

  .login-form {
    text-align: left;
  }

  .form-group {
    margin-bottom: 16px;
  }

  .form-group label {
    display: block;
    margin-bottom: 6px;
    color: var(--text-primary);
    font-weight: 500;
    font-size: 14px;
  }

  .form-group input {
    width: 100%;
    padding: 12px 14px;
    border: 1px solid var(--border-color);
    border-radius: 8px;
    background: var(--bg-primary);
    color: var(--text-primary);
    font-size: 15px;
    transition: border-color 0.2s, box-shadow 0.2s;
  }

  .form-group input:focus {
    outline: none;
    border-color: var(--accent-blue);
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
  }

  .form-group input::placeholder {
    color: var(--text-secondary);
    opacity: 0.7;
  }

  .form-group input:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .btn-large {
    width: 100%;
    padding: 14px 24px;
    font-size: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    margin-top: 8px;
  }

  .btn-spinner {
    width: 18px;
    height: 18px;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-top-color: white;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  .divider {
    display: flex;
    align-items: center;
    margin: 24px 0;
    color: var(--text-secondary);
    font-size: 13px;
  }

  .divider::before,
  .divider::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--border-color);
  }

  .divider span {
    padding: 0 16px;
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
    gap: 12px;
  }

  .dev-login-options .btn {
    flex: 1;
    padding: 12px 16px;
  }

  .btn-outline {
    background: transparent;
    border: 1px solid var(--border-color);
    color: var(--text-primary);
  }

  .btn-outline:hover {
    background: var(--bg-primary);
    border-color: var(--text-secondary);
  }

  .login-footer {
    color: var(--text-secondary);
    font-size: 13px;
    margin: 24px 0 0 0;
    line-height: 1.6;
    text-align: center;
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
`;

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
