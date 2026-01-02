'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { isAuthenticated, getUserFromToken, hasPermission, UserInfo } from '@/lib/auth';

interface AuthGuardProps {
  children: React.ReactNode;
  requiredPermission?: string;
  adminOnly?: boolean;
}

/**
 * AuthGuard component that protects routes
 * Redirects to login if not authenticated
 * Shows permission denied if lacking required permissions
 */
export default function AuthGuard({ children, requiredPermission, adminOnly }: AuthGuardProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<UserInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Skip auth check on login/callback pages
    if (pathname?.startsWith('/login') || pathname?.startsWith('/auth/')) {
      setLoading(false);
      return;
    }

    // Check authentication
    if (!isAuthenticated()) {
      router.push('/login');
      return;
    }

    const currentUser = getUserFromToken();
    if (!currentUser) {
      router.push('/login');
      return;
    }

    setUser(currentUser);

    // Check admin requirement
    if (adminOnly && !currentUser.isAdmin) {
      setError('This page requires admin access');
      setLoading(false);
      return;
    }

    // Check specific permission
    if (requiredPermission && !hasPermission(requiredPermission)) {
      setError(`You don't have permission: ${requiredPermission}`);
      setLoading(false);
      return;
    }

    setLoading(false);
  }, [pathname, router, requiredPermission, adminOnly]);

  if (loading) {
    return (
      <div className="auth-loading">
        <div className="spinner" />
        <p>Loading...</p>
        <style jsx>{`
          .auth-loading {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            min-height: 400px;
          }
          .spinner {
            width: 40px;
            height: 40px;
            border: 3px solid var(--border-color);
            border-top-color: var(--accent-blue);
            border-radius: 50%;
            animation: spin 1s linear infinite;
          }
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container page">
        <div className="permission-denied">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          <h1>Access Denied</h1>
          <p>{error}</p>
          <div className="permission-info">
            <strong>Your role:</strong> {user?.role}<br/>
            <strong>Admin access:</strong> {user?.isAdmin ? 'Yes' : 'No'}<br/>
            <strong>Your permissions:</strong> {user?.permissions.join(', ') || 'None'}
          </div>
          <a href="/" className="btn btn-primary">Go to Dashboard</a>
        </div>
        <style jsx>{`
          .permission-denied {
            text-align: center;
            padding: 60px 20px;
          }
          .permission-denied svg {
            color: var(--accent-yellow);
            margin-bottom: 20px;
          }
          .permission-denied h1 {
            margin: 0 0 12px 0;
          }
          .permission-denied p {
            color: var(--text-secondary);
            margin: 0 0 24px 0;
          }
          .permission-info {
            background: var(--bg-secondary);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            padding: 16px;
            margin: 0 auto 24px;
            max-width: 400px;
            text-align: left;
            font-size: 14px;
            line-height: 1.8;
          }
        `}</style>
      </div>
    );
  }

  return <>{children}</>;
}

/**
 * Hook to get current user with permissions
 */
export function useAuth() {
  const [user, setUser] = useState<UserInfo | null>(null);

  useEffect(() => {
    if (isAuthenticated()) {
      setUser(getUserFromToken());
    }
  }, []);

  return {
    user,
    isAuthenticated: !!user,
    isAdmin: user?.isAdmin ?? false,
    hasPermission: (permission: string) => hasPermission(permission),
  };
}
