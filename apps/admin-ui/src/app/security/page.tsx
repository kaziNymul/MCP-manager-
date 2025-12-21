'use client';

import { useState } from 'react';
import useSWR from 'swr';

const CONTROL_PLANE_URL = process.env.CONTROL_PLANE_URL || 'http://localhost:3001';
const DEV_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhdXRoMHxhZG1pbjEyMyIsImlzcyI6Im1jcC1tYW5hZ2VyLWRldiIsImF1ZCI6Im1jcC1tYW5hZ2VyIiwiaWF0IjoxNzAzMTU0MDAwfQ.placeholder';

const fetcher = async (url: string) => {
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${DEV_TOKEN}` },
  });
  if (!res.ok) throw new Error('Failed to fetch');
  return res.json();
};

type ThreatType = 
  | 'PROMPT_INJECTION'
  | 'JAILBREAK_ATTEMPT'
  | 'DATA_EXFILTRATION'
  | 'SENSITIVE_DATA_EXPOSURE'
  | 'COMMAND_INJECTION'
  | 'PATH_TRAVERSAL'
  | 'SSRF_ATTEMPT'
  | 'SQL_INJECTION'
  | 'CREDENTIAL_LEAK'
  | 'PII_EXPOSURE'
  | 'ANOMALOUS_BEHAVIOR';

const THREAT_DESCRIPTIONS: Record<ThreatType, { icon: string; description: string; color: string }> = {
  PROMPT_INJECTION: { icon: '💉', description: 'Attempt to manipulate AI behavior through injected instructions', color: 'var(--accent-red)' },
  JAILBREAK_ATTEMPT: { icon: '🔓', description: 'Attempt to bypass safety restrictions', color: 'var(--accent-red)' },
  DATA_EXFILTRATION: { icon: '📤', description: 'Potential unauthorized data extraction', color: 'var(--accent-red)' },
  SENSITIVE_DATA_EXPOSURE: { icon: '🔐', description: 'Sensitive data found in response', color: 'var(--accent-yellow)' },
  COMMAND_INJECTION: { icon: '⚡', description: 'Malicious shell command injection', color: 'var(--accent-red)' },
  PATH_TRAVERSAL: { icon: '📂', description: 'Attempt to access files outside allowed directories', color: 'var(--accent-yellow)' },
  SSRF_ATTEMPT: { icon: '🌐', description: 'Server-side request forgery attempt', color: 'var(--accent-yellow)' },
  SQL_INJECTION: { icon: '🗃️', description: 'SQL injection attack attempt', color: 'var(--accent-red)' },
  CREDENTIAL_LEAK: { icon: '🔑', description: 'API keys or credentials detected in traffic', color: 'var(--accent-red)' },
  PII_EXPOSURE: { icon: '👤', description: 'Personally identifiable information exposed', color: 'var(--accent-yellow)' },
  ANOMALOUS_BEHAVIOR: { icon: '📊', description: 'Unusual usage pattern detected', color: 'var(--accent-blue)' },
};

export default function SecurityPage() {
  const [filter, setFilter] = useState<'all' | 'blocked' | 'flagged'>('all');
  
  // Fetch audit events that have security metadata
  const { data: auditData } = useSWR(
    `${CONTROL_PLANE_URL}/api/audit?limit=200`,
    fetcher
  );

  const events = auditData?.data || [];
  
  // Filter events that have threat/anomaly metadata
  const securityEvents = events.filter((event: any) => {
    const meta = event.metadata;
    if (!meta) return false;
    return meta.threats || meta.responseThreats || meta.inputThreats || 
           meta.anomalyScore || meta.threatLevel || event.status === 'BLOCKED';
  });

  const filteredEvents = securityEvents.filter((event: any) => {
    if (filter === 'blocked') return event.status === 'BLOCKED';
    if (filter === 'flagged') return event.status === 'FLAGGED';
    return true;
  });

  // Calculate stats
  const blockedCount = securityEvents.filter((e: any) => e.status === 'BLOCKED').length;
  const flaggedCount = securityEvents.filter((e: any) => e.status === 'FLAGGED').length;
  const threatTypes = new Set<string>();
  securityEvents.forEach((e: any) => {
    const meta = e.metadata || {};
    [...(meta.threats || []), ...(meta.responseThreats || []), ...(meta.inputThreats || [])]
      .forEach((t: any) => threatTypes.add(t.type));
  });

  return (
    <div className="container page">
      <h1 className="mb-4">Security Alerts</h1>

      <p className="text-muted mb-4">
        Real-time threat detection for MCP traffic. The gateway analyzes all tool calls for prompt injection, 
        data exfiltration, and other security threats.
      </p>

      {/* Stats */}
      <div className="stats-grid mb-4">
        <div className="stat-card">
          <div className="stat-value" style={{ color: 'var(--accent-red)' }}>
            {blockedCount}
          </div>
          <div className="stat-label">Blocked Threats</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: 'var(--accent-yellow)' }}>
            {flaggedCount}
          </div>
          <div className="stat-label">Flagged for Review</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{securityEvents.length}</div>
          <div className="stat-label">Security Events</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{threatTypes.size}</div>
          <div className="stat-label">Threat Types</div>
        </div>
      </div>

      {/* Threat Types Legend */}
      <div className="card mb-4">
        <h3 className="card-title mb-4">Threat Detection Capabilities</h3>
        <div className="grid grid-3">
          {Object.entries(THREAT_DESCRIPTIONS).map(([type, info]) => (
            <div key={type} className="flex items-center gap-2">
              <span style={{ fontSize: '1.5rem' }}>{info.icon}</span>
              <div>
                <div className="font-semibold text-sm" style={{ color: info.color }}>
                  {type.replace(/_/g, ' ')}
                </div>
                <div className="text-xs text-muted">{info.description}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="tabs mb-4">
        <button 
          className={`tab ${filter === 'all' ? 'active' : ''}`}
          onClick={() => setFilter('all')}
        >
          All Events ({securityEvents.length})
        </button>
        <button 
          className={`tab ${filter === 'blocked' ? 'active' : ''}`}
          onClick={() => setFilter('blocked')}
        >
          Blocked ({blockedCount})
        </button>
        <button 
          className={`tab ${filter === 'flagged' ? 'active' : ''}`}
          onClick={() => setFilter('flagged')}
        >
          Flagged ({flaggedCount})
        </button>
      </div>

      {/* Events List */}
      {filteredEvents.length === 0 ? (
        <div className="card empty-state">
          <p>🛡️ No security events detected</p>
          <p className="text-muted mt-2">
            The threat detector is actively monitoring all MCP traffic for security threats.
          </p>
        </div>
      ) : (
        <div className="card">
          <table className="table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Event</th>
                <th>Threats Detected</th>
                <th>Server / Tool</th>
                <th>User</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredEvents.map((event: any) => (
                <tr key={event.id}>
                  <td className="text-sm">
                    <div>{new Date(event.createdAt).toLocaleDateString()}</div>
                    <div className="text-muted">{new Date(event.createdAt).toLocaleTimeString()}</div>
                  </td>
                  <td>
                    <span className="text-sm">{event.eventType}</span>
                  </td>
                  <td>
                    <ThreatsList metadata={event.metadata} />
                  </td>
                  <td className="text-sm">
                    <div>{event.serverName}</div>
                    {event.toolName && <div className="text-muted">{event.toolName}</div>}
                  </td>
                  <td className="text-sm">
                    {event.userId?.split('|')[1] || event.userId || '-'}
                  </td>
                  <td>
                    <StatusBadge status={event.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* How It Works */}
      <div className="card mt-4">
        <h3 className="card-title mb-4">How Threat Detection Works</h3>
        <div className="grid grid-2">
          <div>
            <h4 style={{ color: 'var(--accent-blue)' }}>🔍 Request Analysis</h4>
            <ul className="text-sm text-muted mt-2" style={{ listStyle: 'disc', paddingLeft: '1.5rem' }}>
              <li>Prompt injection pattern matching</li>
              <li>Jailbreak attempt detection</li>
              <li>Command injection analysis</li>
              <li>Path traversal detection</li>
              <li>SSRF attempt identification</li>
              <li>SQL injection patterns</li>
            </ul>
          </div>
          <div>
            <h4 style={{ color: 'var(--accent-green)' }}>📊 Response Analysis</h4>
            <ul className="text-sm text-muted mt-2" style={{ listStyle: 'disc', paddingLeft: '1.5rem' }}>
              <li>Credential leak detection (API keys, tokens)</li>
              <li>PII exposure monitoring</li>
              <li>Sensitive data pattern matching</li>
              <li>Connection string detection</li>
            </ul>
          </div>
          <div>
            <h4 style={{ color: 'var(--accent-yellow)' }}>📈 Behavioral Analysis</h4>
            <ul className="text-sm text-muted mt-2" style={{ listStyle: 'disc', paddingLeft: '1.5rem' }}>
              <li>Rate anomaly detection</li>
              <li>Unusual tool access patterns</li>
              <li>Off-hours activity monitoring</li>
              <li>Request size anomalies</li>
            </ul>
          </div>
          <div>
            <h4 style={{ color: 'var(--accent-purple)' }}>🛡️ Actions Taken</h4>
            <ul className="text-sm text-muted mt-2" style={{ listStyle: 'disc', paddingLeft: '1.5rem' }}>
              <li><strong>BLOCK</strong>: Critical threats are blocked</li>
              <li><strong>FLAG</strong>: Suspicious activity marked for review</li>
              <li><strong>LOG</strong>: All events recorded in audit trail</li>
              <li><strong>LEARN</strong>: Behavioral baselines updated</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

function ThreatsList({ metadata }: { metadata: any }) {
  if (!metadata) return <span className="text-muted">-</span>;

  const allThreats = [
    ...(metadata.threats || []),
    ...(metadata.responseThreats || []),
    ...(metadata.inputThreats || []),
  ];

  if (allThreats.length === 0) {
    if (metadata.anomalyScore) {
      return (
        <span className="text-sm">
          Anomaly Score: {metadata.anomalyScore}
        </span>
      );
    }
    return <span className="text-muted">-</span>;
  }

  return (
    <div className="flex flex-wrap gap-1">
      {allThreats.slice(0, 3).map((threat: any, idx: number) => {
        const info = THREAT_DESCRIPTIONS[threat.type as ThreatType];
        return (
          <span 
            key={idx} 
            className="badge"
            style={{ 
              backgroundColor: threat.severity === 'CRITICAL' ? 'var(--accent-red)' : 
                               threat.severity === 'HIGH' ? 'var(--accent-yellow)' : 
                               'var(--bg-tertiary)',
              color: threat.severity === 'CRITICAL' || threat.severity === 'HIGH' ? 'white' : undefined,
            }}
            title={info?.description}
          >
            {info?.icon} {threat.type.replace(/_/g, ' ')}
          </span>
        );
      })}
      {allThreats.length > 3 && (
        <span className="text-muted text-sm">+{allThreats.length - 3} more</span>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { className: string; label: string }> = {
    SUCCESS: { className: 'badge-success', label: 'Allowed' },
    BLOCKED: { className: 'badge-danger', label: 'Blocked' },
    FLAGGED: { className: 'badge-warning', label: 'Flagged' },
    FAILURE: { className: 'badge-danger', label: 'Failed' },
  };

  const cfg = config[status] || { className: 'badge-info', label: status };
  return <span className={`badge ${cfg.className}`}>{cfg.label}</span>;
}
