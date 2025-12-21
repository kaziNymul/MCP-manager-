import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'MCP Manager - Admin Console',
  description: 'Enterprise MCP governance, security scanning, and runtime enforcement',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <nav className="nav">
          <div className="container nav-content">
            <a href="/" className="nav-brand">
              <span>🛡️</span>
              <span>MCP Manager</span>
            </a>
            <div className="nav-links">
              <a href="/" className="nav-link">Dashboard</a>
              <a href="/servers" className="nav-link">Servers</a>
              <a href="/policies" className="nav-link">Policies</a>
              <a href="/security" className="nav-link">🔒 Security</a>
              <a href="/audit" className="nav-link">Audit Log</a>
              <a href="/integrations" className="nav-link">🔗 Integrations</a>
              <a href="/teams" className="nav-link">Teams</a>
            </div>
          </div>
        </nav>
        <main>
          {children}
        </main>
      </body>
    </html>
  );
}
