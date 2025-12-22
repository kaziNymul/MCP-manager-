/**
 * Anomaly detection for MCP traffic patterns.
 * Tracks baselines and detects unusual behavior.
 */

export interface BehaviorProfile {
  userId: string;
  serverId: string;
  metrics: BehaviorMetrics;
  lastUpdated: Date;
}

export interface BehaviorMetrics {
  // Call patterns
  callsPerMinute: number;
  callsPerHour: number;
  avgCallsPerSession: number;
  
  // Tool usage
  uniqueToolsUsed: Set<string>;
  toolFrequency: Map<string, number>;
  
  // Data patterns
  avgRequestSize: number;
  avgResponseSize: number;
  maxRequestSize: number;
  maxResponseSize: number;
  
  // Temporal patterns
  typicalHours: Set<number>; // 0-23
  typicalDays: Set<number>;  // 0-6 (Sunday-Saturday)
  
  // Error patterns
  errorRate: number;
  blockedRate: number;
}

export interface AnomalyResult {
  isAnomaly: boolean;
  score: number; // 0-100, higher = more anomalous
  anomalies: DetectedAnomaly[];
  recommendedAction: 'ALLOW' | 'FLAG' | 'THROTTLE' | 'BLOCK';
}

export interface DetectedAnomaly {
  type: AnomalyType;
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  description: string;
  currentValue: number;
  expectedValue: number;
  deviation: number;
}

export type AnomalyType =
  | 'HIGH_CALL_RATE'
  | 'UNUSUAL_TOOL'
  | 'LARGE_REQUEST'
  | 'LARGE_RESPONSE'
  | 'OFF_HOURS_ACCESS'
  | 'HIGH_ERROR_RATE'
  | 'RAPID_TOOL_SWITCHING'
  | 'DATA_VOLUME_SPIKE'
  | 'NEW_USER_HIGH_ACTIVITY'
  | 'GEOGRAPHIC_ANOMALY';

// Thresholds for anomaly detection
const THRESHOLDS = {
  callsPerMinuteMax: 60,
  callsPerMinuteWarning: 30,
  requestSizeMaxKB: 1024,
  responseSizeMaxKB: 10240,
  errorRateWarning: 0.1,
  errorRateCritical: 0.3,
  deviationMultiplier: 3, // Standard deviations
};

/**
 * In-memory behavior tracking with sliding windows
 */
export class AnomalyDetector {
  private profiles: Map<string, BehaviorProfile> = new Map();
  private recentCalls: Map<string, number[]> = new Map(); // userId -> timestamps
  private callHistory: Map<string, Array<{ tool: string; size: number; timestamp: number }>> = new Map();
  
  constructor(private options: {
    learningPeriodMinutes?: number;
    maxProfileAge?: number;
  } = {}) {}

  /**
   * Get a unique key for user+server combination
   */
  private getKey(userId: string, serverId: string): string {
    return `${userId}:${serverId}`;
  }

  /**
   * Record a tool call for learning/detection
   */
  recordCall(params: {
    userId: string;
    serverId: string;
    toolName: string;
    requestSize: number;
    responseSize: number;
    success: boolean;
    blocked: boolean;
  }): void {
    const key = this.getKey(params.userId, params.serverId);
    const now = Date.now();
    
    // Update recent calls
    const calls = this.recentCalls.get(key) || [];
    calls.push(now);
    // Keep only last hour
    const oneHourAgo = now - 60 * 60 * 1000;
    const filtered = calls.filter(t => t > oneHourAgo);
    this.recentCalls.set(key, filtered);

    // Update call history
    const history = this.callHistory.get(key) || [];
    history.push({
      tool: params.toolName,
      size: params.requestSize + params.responseSize,
      timestamp: now,
    });
    // Keep only last 1000 calls
    if (history.length > 1000) {
      history.shift();
    }
    this.callHistory.set(key, history);

    // Update or create profile
    this.updateProfile(key, params);
  }

  /**
   * Analyze a pending call for anomalies
   */
  analyze(params: {
    userId: string;
    serverId: string;
    toolName: string;
    requestSize: number;
    ipAddress?: string;
    userAgent?: string;
  }): AnomalyResult {
    const key = this.getKey(params.userId, params.serverId);
    const profile = this.profiles.get(key);
    const anomalies: DetectedAnomaly[] = [];
    const now = Date.now();
    const currentHour = new Date().getHours();
    const currentDay = new Date().getDay();

    // Get recent call rate
    const recentCalls = this.recentCalls.get(key) || [];
    const oneMinuteAgo = now - 60 * 1000;
    const callsLastMinute = recentCalls.filter(t => t > oneMinuteAgo).length;

    // Check 1: High call rate
    if (callsLastMinute > THRESHOLDS.callsPerMinuteMax) {
      anomalies.push({
        type: 'HIGH_CALL_RATE',
        severity: 'HIGH',
        description: 'Extremely high call rate detected',
        currentValue: callsLastMinute,
        expectedValue: THRESHOLDS.callsPerMinuteMax,
        deviation: callsLastMinute / THRESHOLDS.callsPerMinuteMax,
      });
    } else if (callsLastMinute > THRESHOLDS.callsPerMinuteWarning) {
      anomalies.push({
        type: 'HIGH_CALL_RATE',
        severity: 'MEDIUM',
        description: 'Elevated call rate detected',
        currentValue: callsLastMinute,
        expectedValue: THRESHOLDS.callsPerMinuteWarning,
        deviation: callsLastMinute / THRESHOLDS.callsPerMinuteWarning,
      });
    }

    // Check 2: Large request
    const requestSizeKB = params.requestSize / 1024;
    if (requestSizeKB > THRESHOLDS.requestSizeMaxKB) {
      anomalies.push({
        type: 'LARGE_REQUEST',
        severity: 'MEDIUM',
        description: 'Unusually large request payload',
        currentValue: requestSizeKB,
        expectedValue: THRESHOLDS.requestSizeMaxKB,
        deviation: requestSizeKB / THRESHOLDS.requestSizeMaxKB,
      });
    }

    // Profile-based checks (if we have history)
    if (profile && profile.metrics.callsPerHour > 10) {
      // Check 3: Unusual tool
      if (!profile.metrics.uniqueToolsUsed.has(params.toolName)) {
        anomalies.push({
          type: 'UNUSUAL_TOOL',
          severity: 'LOW',
          description: `Tool "${params.toolName}" has never been used by this user`,
          currentValue: 0,
          expectedValue: 1,
          deviation: 1,
        });
      }

      // Check 4: Off-hours access
      if (profile.metrics.typicalHours.size > 0 && 
          !profile.metrics.typicalHours.has(currentHour)) {
        anomalies.push({
          type: 'OFF_HOURS_ACCESS',
          severity: 'LOW',
          description: `Access at unusual hour (${currentHour}:00)`,
          currentValue: currentHour,
          expectedValue: Array.from(profile.metrics.typicalHours)[0] ?? 9,
          deviation: 1,
        });
      }

      // Check 5: Request size deviation
      if (profile.metrics.avgRequestSize > 0) {
        const sizeDeviation = params.requestSize / profile.metrics.avgRequestSize;
        if (sizeDeviation > THRESHOLDS.deviationMultiplier) {
          anomalies.push({
            type: 'LARGE_REQUEST',
            severity: 'MEDIUM',
            description: 'Request significantly larger than user average',
            currentValue: params.requestSize,
            expectedValue: profile.metrics.avgRequestSize,
            deviation: sizeDeviation,
          });
        }
      }
    } else if (callsLastMinute > 10) {
      // New user with high activity
      anomalies.push({
        type: 'NEW_USER_HIGH_ACTIVITY',
        severity: 'MEDIUM',
        description: 'High activity from new or infrequent user',
        currentValue: callsLastMinute,
        expectedValue: 5,
        deviation: callsLastMinute / 5,
      });
    }

    // Check 6: Rapid tool switching
    const history = this.callHistory.get(key) || [];
    const last10Calls = history.slice(-10);
    if (last10Calls.length >= 10) {
      const uniqueTools = new Set(last10Calls.map(c => c.tool));
      if (uniqueTools.size >= 8) {
        anomalies.push({
          type: 'RAPID_TOOL_SWITCHING',
          severity: 'LOW',
          description: 'Rapidly switching between many different tools',
          currentValue: uniqueTools.size,
          expectedValue: 3,
          deviation: uniqueTools.size / 3,
        });
      }
    }

    return this.buildResult(anomalies);
  }

  /**
   * Get rate limiting recommendation
   */
  getRateLimit(userId: string, serverId: string): {
    allowed: boolean;
    retryAfterMs?: number;
    reason?: string;
  } {
    const key = this.getKey(userId, serverId);
    const recentCalls = this.recentCalls.get(key) || [];
    const now = Date.now();
    const oneMinuteAgo = now - 60 * 1000;
    const callsLastMinute = recentCalls.filter(t => t > oneMinuteAgo).length;

    if (callsLastMinute >= THRESHOLDS.callsPerMinuteMax) {
      // Calculate when oldest call in window expires
      const oldestCall = Math.min(...recentCalls.filter(t => t > oneMinuteAgo));
      const retryAfter = (oldestCall + 60000) - now;
      return {
        allowed: false,
        retryAfterMs: Math.max(retryAfter, 1000),
        reason: `Rate limit exceeded: ${callsLastMinute} calls/minute (max: ${THRESHOLDS.callsPerMinuteMax})`,
      };
    }

    return { allowed: true };
  }

  /**
   * Get current stats for a user
   */
  getStats(userId: string, serverId: string): {
    callsLastMinute: number;
    callsLastHour: number;
    profile: BehaviorProfile | null;
  } {
    const key = this.getKey(userId, serverId);
    const recentCalls = this.recentCalls.get(key) || [];
    const now = Date.now();
    const oneMinuteAgo = now - 60 * 1000;
    const oneHourAgo = now - 60 * 60 * 1000;

    return {
      callsLastMinute: recentCalls.filter(t => t > oneMinuteAgo).length,
      callsLastHour: recentCalls.filter(t => t > oneHourAgo).length,
      profile: this.profiles.get(key) || null,
    };
  }

  private updateProfile(
    key: string,
    params: {
      userId: string;
      serverId: string;
      toolName: string;
      requestSize: number;
      responseSize: number;
      success: boolean;
      blocked: boolean;
    }
  ): void {
    const existing = this.profiles.get(key);
    const now = new Date();
    const currentHour = now.getHours();
    const currentDay = now.getDay();

    if (!existing) {
      // Create new profile
      const newProfile: BehaviorProfile = {
        userId: params.userId,
        serverId: params.serverId,
        lastUpdated: now,
        metrics: {
          callsPerMinute: 1,
          callsPerHour: 1,
          avgCallsPerSession: 1,
          uniqueToolsUsed: new Set([params.toolName]),
          toolFrequency: new Map([[params.toolName, 1]]),
          avgRequestSize: params.requestSize,
          avgResponseSize: params.responseSize,
          maxRequestSize: params.requestSize,
          maxResponseSize: params.responseSize,
          typicalHours: new Set([currentHour]),
          typicalDays: new Set([currentDay]),
          errorRate: params.success ? 0 : 1,
          blockedRate: params.blocked ? 1 : 0,
        },
      };
      this.profiles.set(key, newProfile);
    } else {
      // Update existing profile with exponential moving average
      const alpha = 0.1; // Learning rate
      const m = existing.metrics;
      
      m.uniqueToolsUsed.add(params.toolName);
      m.toolFrequency.set(params.toolName, (m.toolFrequency.get(params.toolName) || 0) + 1);
      m.avgRequestSize = alpha * params.requestSize + (1 - alpha) * m.avgRequestSize;
      m.avgResponseSize = alpha * params.responseSize + (1 - alpha) * m.avgResponseSize;
      m.maxRequestSize = Math.max(m.maxRequestSize, params.requestSize);
      m.maxResponseSize = Math.max(m.maxResponseSize, params.responseSize);
      m.typicalHours.add(currentHour);
      m.typicalDays.add(currentDay);
      m.errorRate = alpha * (params.success ? 0 : 1) + (1 - alpha) * m.errorRate;
      m.blockedRate = alpha * (params.blocked ? 1 : 0) + (1 - alpha) * m.blockedRate;
      
      existing.lastUpdated = now;
    }
  }

  private buildResult(anomalies: DetectedAnomaly[]): AnomalyResult {
    if (anomalies.length === 0) {
      return {
        isAnomaly: false,
        score: 0,
        anomalies: [],
        recommendedAction: 'ALLOW',
      };
    }

    // Calculate score (0-100)
    const severityWeights = { LOW: 10, MEDIUM: 30, HIGH: 50 };
    const totalScore = anomalies.reduce((sum, a) => {
      const weight = severityWeights[a.severity];
      const deviationFactor = Math.min(a.deviation, 5);
      return sum + weight * deviationFactor;
    }, 0);
    const score = Math.min(100, totalScore);

    // Determine action
    let recommendedAction: AnomalyResult['recommendedAction'];
    if (score >= 80) {
      recommendedAction = 'BLOCK';
    } else if (score >= 50) {
      recommendedAction = 'THROTTLE';
    } else if (score >= 20) {
      recommendedAction = 'FLAG';
    } else {
      recommendedAction = 'ALLOW';
    }

    return {
      isAnomaly: true,
      score,
      anomalies,
      recommendedAction,
    };
  }
}

// Export singleton
export const anomalyDetector = new AnomalyDetector();
