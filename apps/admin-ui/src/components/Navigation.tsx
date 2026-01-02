'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { isAuthenticated, getUserFromToken, logout, UserInfo } from '@/lib/auth';

export default function Navigation() {
  const pathname = usePathname();
  const [user, setUser] = useState<UserInfo | null>(null);
  const [showUserMenu, setShowUserMenu] = useState(false);

  useEffect(() => {
    // Check auth on client side
    if (isAuthenticated()) {
      setUser(getUserFromToken());
    }
  }, [pathname]);

  // Don't show nav on login/callback pages
  if (pathname?.startsWith('/login') || pathname?.startsWith('/auth/')) {
    return null;
  }

  // If not authenticated, redirect to login (handled by useEffect in pages)
  if (!user) {
    return null;
  }

  const handleLogout = async () => {
    await logout();
  };

  return (
    <nav className="nav">
      <div className="container nav-content">
        <a href="/" className="nav-brand">
          <span>🛡️</span>
          <span>MCP Manager</span>
        </a>
        
        <div className="nav-links">
          <a href="/" className={`nav-link ${pathname === '/' ? 'active' : ''}`}>
            Dashboard
          </a>
          <a href="/servers" className={`nav-link ${pathname?.startsWith('/servers') ? 'active' : ''}`}>
            Servers
          </a>
          <a href="/policies" className={`nav-link ${pathname?.startsWith('/policies') ? 'active' : ''}`}>
            Policies
          </a>
          <a href="/security" className={`nav-link ${pathname?.startsWith('/security') ? 'active' : ''}`}>
            🔒 Security
          </a>
          <a href="/audit" className={`nav-link ${pathname?.startsWith('/audit') ? 'active' : ''}`}>
            Audit Log
          </a>
          {user.isAdmin && (
            <a href="/integrations" className={`nav-link ${pathname?.startsWith('/integrations') ? 'active' : ''}`}>
              🔗 Integrations
            </a>
          )}
          <a href="/teams" className={`nav-link ${pathname?.startsWith('/teams') ? 'active' : ''}`}>
            Teams
          </a>
        </div>

        <div className="nav-user">
          <button 
            className="user-menu-trigger"
            onClick={() => setShowUserMenu(!showUserMenu)}
          >
            <div className="user-avatar">
              {user.email?.[0]?.toUpperCase() || 'U'}
            </div>
            <div className="user-info">
              <span className="user-name">{user.name || user.email}</span>
              <span className="user-role">
                {user.isAdmin ? '🔑 Admin' : user.role}
              </span>
            </div>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>

          {showUserMenu && (
            <div className="user-menu">
              <div className="user-menu-header">
                <div className="user-email">{user.email}</div>
                <div className="user-org">Org: {user.orgSlug}</div>
                {user.adGroups.length > 0 && (
                  <div className="user-groups">
                    AD Groups: {user.adGroups.join(', ')}
                  </div>
                )}
              </div>
              <div className="user-menu-divider" />
              <button className="user-menu-item" onClick={handleLogout}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
                Sign Out
              </button>
            </div>
          )}
        </div>
      </div>

      <style jsx>{`
        .nav-user {
          position: relative;
          margin-left: auto;
        }

        .user-menu-trigger {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 6px 12px;
          background: transparent;
          border: 1px solid var(--border-color);
          border-radius: 8px;
          color: var(--text-primary);
          cursor: pointer;
          transition: all 0.2s;
        }

        .user-menu-trigger:hover {
          background: var(--bg-tertiary);
          border-color: var(--accent-blue);
        }

        .user-avatar {
          width: 32px;
          height: 32px;
          background: var(--accent-blue);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 600;
          font-size: 14px;
        }

        .user-info {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 2px;
        }

        .user-name {
          font-size: 14px;
          font-weight: 500;
        }

        .user-role {
          font-size: 11px;
          color: var(--text-secondary);
        }

        .user-menu {
          position: absolute;
          top: 100%;
          right: 0;
          margin-top: 8px;
          background: var(--bg-secondary);
          border: 1px solid var(--border-color);
          border-radius: 8px;
          min-width: 220px;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
          z-index: 100;
        }

        .user-menu-header {
          padding: 12px 16px;
        }

        .user-email {
          font-size: 14px;
          color: var(--text-primary);
          font-weight: 500;
        }

        .user-org, .user-groups {
          font-size: 12px;
          color: var(--text-secondary);
          margin-top: 4px;
        }

        .user-menu-divider {
          height: 1px;
          background: var(--border-color);
        }

        .user-menu-item {
          width: 100%;
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 12px 16px;
          background: none;
          border: none;
          color: var(--text-primary);
          font-size: 14px;
          cursor: pointer;
          transition: background 0.2s;
        }

        .user-menu-item:hover {
          background: var(--bg-tertiary);
        }

        .nav-link.active {
          color: var(--accent-blue);
        }

        @media (max-width: 768px) {
          .user-info {
            display: none;
          }
        }
      `}</style>
    </nav>
  );
}
