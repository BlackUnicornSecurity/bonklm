/**
 * BonkLM - Session Tracker
 * =================================
 * Tracks security patterns across conversation turns to detect gradual
 * escalation attacks that bypass single-turn detection.
 *
 * Security Features:
 * - Temporal decay to prevent false positives from old patterns
 * - Category-based repetition detection
 * - Accumulated weight threshold monitoring
 * - In-memory storage (framework-agnostic, no file dependencies)
 */

// =============================================================================
// CONFIGURATION CONSTANTS
// =============================================================================

/**
 * Half-life for temporal decay in milliseconds (10 minutes).
 * After 10 minutes, accumulated weight decays to 50%.
 */
export const DECAY_HALF_LIFE_MS = 600000;

/**
 * Threshold for accumulated weight to trigger escalation.
 * If total accumulated weight exceeds this, escalate severity.
 */
export const ACCUMULATION_THRESHOLD = 15;

/**
 * Threshold for same-category repetition.
 * If the same pattern category appears this many times, escalate.
 */
export const CATEGORY_REPEAT_THRESHOLD = 3;

/**
 * Session timeout in milliseconds (24 hours).
 * Sessions older than this are considered expired.
 * S016-002: Default TTL of 24 hours for session expiration.
 */
export const SESSION_TIMEOUT_MS = 86400000;

/**
 * Maximum number of sessions to store in memory.
 * Prevents memory exhaustion under high load.
 */
export const MAX_SESSIONS = 10000;

/**
 * S016-002: Automatic cleanup interval for expired sessions.
 * Cleanup runs every 1000 session accesses (approximately).
 */
let cleanupCounter = 0;
const CLEANUP_INTERVAL = 1000;

// =============================================================================
// TYPES
// =============================================================================

/**
 * Individual pattern finding from jailbreak detection.
 */
export interface SessionPatternFinding {
  category: string;
  weight: number;
  pattern_name?: string;
  timestamp?: number;
}

/**
 * Individual session state.
 */
export interface SessionState {
  session_id: string;
  patterns_by_category: Record<string, number>;
  accumulated_weight: number;
  last_updated: number;
  turn_count: number;
  findings_history: Array<{
    turn: number;
    timestamp: number;
    categories: string[];
    weight: number;
  }>;
  /** Fragment buffer tracking partial injection keywords across turns */
  fragment_buffer: string[];
  /** Cumulative instruction count across turns for many-shot detection */
  instruction_count: number;
  /** Cumulative INFO-level finding count for slow-drip detection */
  info_finding_count: number;
  /** Timestamps of recent findings for velocity calculation */
  finding_timestamps: number[];
}

/**
 * Result from session state update.
 */
export interface SessionUpdateResult {
  shouldEscalate: boolean;
  reason: string;
  riskScore: number;
  turnCount: number;
  repeatedCategories: string[];
}

// =============================================================================
// SESSION STATE MANAGEMENT
// =============================================================================

/**
 * In-memory storage for session states.
 * Framework-agnostic: no file I/O, users can implement persistence as needed.
 */
class SessionStore {
  private static instance: SessionStore;
  private sessions: Map<string, SessionState> = new Map();
  private accessOrder: string[] = []; // Track access for LRU eviction

  private constructor() {}

  static getInstance(): SessionStore {
    if (!SessionStore.instance) {
      SessionStore.instance = new SessionStore();
    }
    return SessionStore.instance;
  }

  get(sessionId: string): SessionState | undefined {
    const state = this.sessions.get(sessionId);
    if (state) {
      // Update access order for LRU
      const index = this.accessOrder.indexOf(sessionId);
      if (index > -1) {
        this.accessOrder.splice(index, 1);
      }
      this.accessOrder.push(sessionId);
    }

    // S016-002: Periodic cleanup of expired sessions
    cleanupCounter++;
    if (cleanupCounter >= CLEANUP_INTERVAL) {
      cleanupCounter = 0;
      // Clean up expired sessions synchronously but limit iterations
      const now = Date.now();
      let cleaned = 0;
      const maxCleanPerRun = 100; // Limit cleanup iterations to prevent blocking
      for (const [id, s] of this.sessions.entries()) {
        if (now - s.last_updated >= SESSION_TIMEOUT_MS) {
          this.delete(id);
          cleaned++;
          if (cleaned >= maxCleanPerRun) break;
        }
      }
    }

    return state;
  }

  set(sessionId: string, state: SessionState): void {
    // Enforce maximum session limit (memory leak protection)
    if (this.sessions.size >= MAX_SESSIONS && !this.sessions.has(sessionId)) {
      // Remove oldest session (LRU eviction)
      const oldestSessionId = this.accessOrder.shift();
      if (oldestSessionId) {
        this.sessions.delete(oldestSessionId);
      }
    }

    this.sessions.set(sessionId, state);

    // Update access order
    const index = this.accessOrder.indexOf(sessionId);
    if (index > -1) {
      this.accessOrder.splice(index, 1);
    }
    this.accessOrder.push(sessionId);
  }

  delete(sessionId: string): void {
    this.sessions.delete(sessionId);
    const index = this.accessOrder.indexOf(sessionId);
    if (index > -1) {
      this.accessOrder.splice(index, 1);
    }
  }

  clear(): void {
    this.sessions.clear();
    this.accessOrder = [];
  }

  /**
   * Get current session count (for monitoring).
   */
  size(): number {
    return this.sessions.size;
  }

  /**
   * S016-002: Get all session IDs.
   * @returns Array of all session IDs
   */
  getAllSessionIds(): string[] {
    return Array.from(this.sessions.keys());
  }
}

/**
 * Create a fresh session state.
 */
function createFreshState(sessionId: string): SessionState {
  return {
    session_id: sessionId,
    patterns_by_category: {},
    accumulated_weight: 0,
    last_updated: Date.now(),
    turn_count: 0,
    findings_history: [],
    fragment_buffer: [],
    instruction_count: 0,
    info_finding_count: 0,
    finding_timestamps: [],
  };
}

/**
 * Load session state with temporal decay applied.
 *
 * @param sessionId - The session identifier
 * @returns Session state with decay applied, or fresh state if not found
 */
export function getSessionState(sessionId: string): SessionState {
  const store = SessionStore.getInstance();
  const now = Date.now();

  const existingSession = store.get(sessionId);
  if (existingSession) {
    const state = { ...existingSession }; // Clone to avoid mutation
    const elapsed = now - state.last_updated;

    // Apply temporal decay to accumulated weight only if significant time has passed (>1 minute)
    if (elapsed > 60000 && elapsed < SESSION_TIMEOUT_MS) {
      const decayFactor = Math.pow(0.5, elapsed / DECAY_HALF_LIFE_MS);
      state.accumulated_weight *= decayFactor;

      // Also decay category counts (less aggressively) - only for very long periods
      if (elapsed > DECAY_HALF_LIFE_MS / 2) {
        // Only decay categories after 5+ minutes
        const categoryDecayFactor = Math.pow(0.7, elapsed / DECAY_HALF_LIFE_MS);
        for (const category of Object.keys(state.patterns_by_category)) {
          state.patterns_by_category[category] = Math.floor(
            (state.patterns_by_category[category] ?? 0) * categoryDecayFactor
          );
          // Remove category if count drops to 0
          if (state.patterns_by_category[category] === 0) {
            delete state.patterns_by_category[category];
          }
        }
      }

      // Save the decayed state back to store
      store.set(sessionId, state);
      return state;
    } else if (elapsed >= SESSION_TIMEOUT_MS) {
      // Session expired, remove and return fresh state
      store.delete(sessionId);
      return createFreshState(sessionId);
    }

    return state;
  }

  return createFreshState(sessionId);
}

/**
 * Save session state.
 */
function saveSessionState(state: SessionState): void {
  const store = SessionStore.getInstance();
  store.set(state.session_id, state);
}

/**
 * Update session state with new findings and check for escalation.
 *
 * @param sessionId - The session identifier
 * @param findings - Array of pattern findings from current turn
 * @returns Result indicating whether to escalate and why
 */
export function updateSessionState(
  sessionId: string,
  findings: SessionPatternFinding[]
): SessionUpdateResult {
  const state = getSessionState(sessionId);
  const now = Date.now();

  let shouldEscalate = false;
  let escalationReason = '';
  const repeatedCategories: string[] = [];

  // Process each finding
  for (const finding of findings) {
    // Track category occurrences
    state.patterns_by_category[finding.category] =
      (state.patterns_by_category[finding.category] || 0) + 1;

    // Accumulate weight
    state.accumulated_weight += finding.weight;

    // Check for category repetition attack
    const categoryCount = state.patterns_by_category[finding.category] ?? 0;
    if (categoryCount >= CATEGORY_REPEAT_THRESHOLD) {
      if (!repeatedCategories.includes(finding.category)) {
        repeatedCategories.push(finding.category);
      }
      if (!shouldEscalate) {
        shouldEscalate = true;
        escalationReason = `Category "${finding.category}" detected ${categoryCount} times across session (threshold: ${CATEGORY_REPEAT_THRESHOLD})`;
      }
    }
  }

  // Update turn count and history
  state.turn_count++;
  state.last_updated = now;

  // Add to findings history (keep last 20 turns)
  if (findings.length > 0) {
    state.findings_history.push({
      turn: state.turn_count,
      timestamp: now,
      categories: [...new Set(findings.map((f) => f.category))],
      weight: findings.reduce((sum, f) => sum + f.weight, 0),
    });

    // Trim history to last 20 entries
    if (state.findings_history.length > 20) {
      state.findings_history = state.findings_history.slice(-20);
    }
  }

  // Check accumulated weight threshold
  if (state.accumulated_weight >= ACCUMULATION_THRESHOLD && !shouldEscalate) {
    shouldEscalate = true;
    escalationReason = `Accumulated risk weight ${state.accumulated_weight.toFixed(1)} exceeds threshold ${ACCUMULATION_THRESHOLD}`;
  }

  // Save updated state
  saveSessionState(state);

  return {
    shouldEscalate,
    reason: escalationReason,
    riskScore: state.accumulated_weight,
    turnCount: state.turn_count,
    repeatedCategories,
  };
}

/**
 * Reset session state (for testing or admin purposes).
 */
export function resetSessionState(sessionId: string): void {
  const store = SessionStore.getInstance();
  store.delete(sessionId);
}

/**
 * Clear all session states (for testing).
 */
export function clearAllSessions(): void {
  const store = SessionStore.getInstance();
  store.clear();
}

/**
 * S016-002: Clean up expired sessions.
 * Removes all sessions that have not been updated within SESSION_TIMEOUT_MS.
 *
 * @returns Number of sessions cleaned up
 */
export function cleanupExpiredSessions(): number {
  const store = SessionStore.getInstance();
  const now = Date.now();
  let cleanedUp = 0;

  // Get all session IDs (we need to get them all first to avoid modifying during iteration)
  const allSessions = store.getAllSessionIds();

  for (const sessionId of allSessions) {
    const state = store.get(sessionId);
    if (state && now - state.last_updated >= SESSION_TIMEOUT_MS) {
      store.delete(sessionId);
      cleanedUp++;
    }
  }

  return cleanedUp;
}

/**
 * S016-002: Get the count of active sessions.
 * @returns Number of active sessions
 */
export function getActiveSessionCount(): number {
  const store = SessionStore.getInstance();
  return store.size();
}

/**
 * Check if a session is currently escalated without updating.
 */
export function isSessionEscalated(sessionId: string): {
  escalated: boolean;
  reason: string;
  riskScore: number;
} {
  const state = getSessionState(sessionId);

  // Check accumulated weight
  if (state.accumulated_weight >= ACCUMULATION_THRESHOLD) {
    return {
      escalated: true,
      reason: `Accumulated weight ${state.accumulated_weight.toFixed(1)} >= ${ACCUMULATION_THRESHOLD}`,
      riskScore: state.accumulated_weight,
    };
  }

  // Check category repetitions
  for (const [category, count] of Object.entries(state.patterns_by_category)) {
    if (count >= CATEGORY_REPEAT_THRESHOLD) {
      return {
        escalated: true,
        reason: `Category "${category}" repeated ${count} times`,
        riskScore: state.accumulated_weight,
      };
    }
  }

  return {
    escalated: false,
    reason: '',
    riskScore: state.accumulated_weight,
  };
}

// =============================================================================
// FRAGMENT BUFFER TRACKING (TPI-13)
// =============================================================================

/** Maximum total characters in fragment buffer */
const MAX_FRAGMENT_BUFFER_CHARS = 500;

/** Maximum number of fragments to track */
const MAX_FRAGMENT_COUNT = 5;

/** Keywords that indicate partial injection fragments */
const FRAGMENT_KEYWORDS = /\b(ignore|bypass|override|disable|remove|forget|reveal|show|previous|prior|instructions?|rules?|system|prompt|safety|jailbreak|unrestricted|constraints?|restrictions?)\b/gi;

/**
 * Update fragment buffer with content from current turn.
 * Extracts suspicious keywords, stores across turns, and checks
 * if combined fragments form injection patterns.
 *
 * @returns Array of findings if combined fragments match patterns
 */
export function updateFragmentBuffer(
  sessionId: string,
  content: string
): Array<{ pattern_name: string; severity: string; combined_text: string }> {
  const state = getSessionState(sessionId);

  // Initialize fragment_buffer if missing
  if (!state.fragment_buffer) {
    state.fragment_buffer = [];
  }

  // Extract suspicious keywords from current turn
  const keywords = content.match(FRAGMENT_KEYWORDS);
  if (!keywords || keywords.length === 0) {
    return [];
  }

  // Add unique keywords to buffer (deduplicate within same turn)
  const uniqueKeywords = [...new Set(keywords.map((k) => k.toLowerCase()))];
  const newFragment = uniqueKeywords.join(' ');

  // Add to buffer, respecting size limits
  state.fragment_buffer.push(newFragment);

  // Enforce max count
  if (state.fragment_buffer.length > MAX_FRAGMENT_COUNT) {
    state.fragment_buffer = state.fragment_buffer.slice(-MAX_FRAGMENT_COUNT);
  }

  // Enforce max total chars
  let totalChars = state.fragment_buffer.reduce((sum, f) => sum + f.length, 0);
  while (totalChars > MAX_FRAGMENT_BUFFER_CHARS && state.fragment_buffer.length > 1) {
    state.fragment_buffer.shift();
    totalChars = state.fragment_buffer.reduce((sum, f) => sum + f.length, 0);
  }

  // Concatenate all fragments and scan for patterns
  const combinedText = state.fragment_buffer.join(' ');
  const findings: Array<{ pattern_name: string; severity: string; combined_text: string }> = [];

  // Only check if we have fragments from multiple turns (>=2)
  if (state.fragment_buffer.length >= 2) {
    const injectionPhrases = [
      { pattern: /ignore\s+(?:all\s+)?(?:previous|prior)\s+(?:instructions?|rules?)/i, name: 'fragmented_ignore_instructions' },
      { pattern: /bypass\s+(?:all\s+)?(?:safety|security|restrictions?|constraints?)/i, name: 'fragmented_bypass_safety' },
      { pattern: /override\s+(?:all\s+)?(?:system|instructions?|rules?)/i, name: 'fragmented_override_system' },
      { pattern: /disable\s+(?:all\s+)?(?:safety|restrictions?|constraints?|rules?)/i, name: 'fragmented_disable_safety' },
      { pattern: /reveal\s+(?:system\s+)?prompt/i, name: 'fragmented_reveal_prompt' },
      { pattern: /jailbreak\s+(?:unrestricted|system)/i, name: 'fragmented_jailbreak' },
      { pattern: /remove\s+(?:all\s+)?(?:restrictions?|constraints?|safety)/i, name: 'fragmented_remove_restrictions' },
      { pattern: /forget\s+(?:all\s+)?(?:previous|prior)?\s*(?:rules?|instructions?)/i, name: 'fragmented_forget_rules' },
    ];

    for (const phrase of injectionPhrases) {
      if (phrase.pattern.test(combinedText)) {
        findings.push({
          pattern_name: phrase.name,
          severity: 'WARNING',
          combined_text: combinedText.slice(0, 200),
        });
      }
    }
  }

  // Save updated state
  saveSessionState(state);

  return findings;
}

// =============================================================================
// SESSION-LEVEL MANY-SHOT TRACKING (TPI-11)
// =============================================================================

/** Threshold for cumulative instruction count across turns */
const SESSION_INSTRUCTION_THRESHOLD = 50;

/**
 * Track instruction count per turn in session state.
 * Flags if cumulative instruction count across turns exceeds threshold.
 *
 * @returns Object indicating if session-level many-shot is detected
 */
export function updateInstructionCount(
  sessionId: string,
  instructionCount: number
): { manyShotDetected: boolean; cumulativeCount: number } {
  const state = getSessionState(sessionId);

  // Initialize instruction_count if missing
  if (!state.instruction_count) {
    state.instruction_count = 0;
  }

  state.instruction_count += instructionCount;
  saveSessionState(state);

  return {
    manyShotDetected: state.instruction_count > SESSION_INSTRUCTION_THRESHOLD,
    cumulativeCount: state.instruction_count,
  };
}

// =============================================================================
// SLOW-DRIP & TIMING-BASED ATTACK DETECTION (TPI-16)
// =============================================================================

/** Minimum INFO findings to trigger slow-drip detection */
const SLOW_DRIP_INFO_THRESHOLD = 10;

/** Minimum turns for slow-drip (must be spread across turns, not burst) */
const SLOW_DRIP_TURN_THRESHOLD = 5;

/** Maximum elapsed time (ms) for slow-drip window (30 minutes) */
const SLOW_DRIP_WINDOW_MS = 1800000;

/** Rolling window for velocity calculation (10 minutes) */
const VELOCITY_WINDOW_MS = 600000;

/** Maximum finding timestamps to retain */
const MAX_FINDING_TIMESTAMPS = 100;

/**
 * Result from slow-drip detection.
 */
export interface SlowDripResult {
  slowDripDetected: boolean;
  reason: string;
  infoFindingCount: number;
  findingsVelocity: number;
  shouldEscalate: boolean;
}

/**
 * Detect slow-drip injection attacks.
 * Tracks cumulative INFO-level findings across session turns.
 * Flags if >10 INFO findings across >5 turns within 30 minutes.
 *
 * @param sessionId - The session identifier
 * @param infoCount - Number of INFO-level findings in current turn
 * @param turnCount - Current turn number
 * @returns Detection result with velocity and escalation info
 */
export function detectSlowDrip(
  sessionId: string,
  infoCount: number,
  turnCount: number
): SlowDripResult {
  const state = getSessionState(sessionId);
  const now = Date.now();

  // Initialize fields if missing
  if (!state.info_finding_count) {
    state.info_finding_count = 0;
  }
  if (!state.finding_timestamps) {
    state.finding_timestamps = [];
  }

  // Update counters
  state.info_finding_count += infoCount;

  // Record timestamps for velocity tracking
  for (let i = 0; i < infoCount; i++) {
    state.finding_timestamps.push(now);
  }

  // Trim old timestamps outside velocity window
  state.finding_timestamps = state.finding_timestamps.filter((t) => now - t < VELOCITY_WINDOW_MS);

  // Cap timestamp array size
  if (state.finding_timestamps.length > MAX_FINDING_TIMESTAMPS) {
    state.finding_timestamps = state.finding_timestamps.slice(-MAX_FINDING_TIMESTAMPS);
  }

  // Calculate velocity (findings per minute in rolling window)
  const velocityWindowFindings = state.finding_timestamps.length;
  const findingsVelocity =
    velocityWindowFindings > 0 ? velocityWindowFindings / (VELOCITY_WINDOW_MS / 60000) : 0;

  // Check slow-drip conditions
  const elapsed = now - (state.last_updated || now);
  const withinWindow = elapsed < SLOW_DRIP_WINDOW_MS;
  const enoughFindings = state.info_finding_count > SLOW_DRIP_INFO_THRESHOLD;
  const spreadAcrossTurns = turnCount >= SLOW_DRIP_TURN_THRESHOLD;
  const slowDripDetected = enoughFindings && spreadAcrossTurns && withinWindow;

  // Save updated state
  saveSessionState(state);

  return {
    slowDripDetected,
    reason: slowDripDetected ? `Slow-drip detected: ${state.info_finding_count} INFO findings across ${turnCount} turns` : '',
    infoFindingCount: state.info_finding_count,
    findingsVelocity,
    shouldEscalate: slowDripDetected,
  };
}

/**
 * Get session statistics for debugging/monitoring.
 */
export function getSessionStats(sessionId: string): {
  turnCount: number;
  accumulatedWeight: number;
  categoryCounts: Record<string, number>;
  lastUpdated: number;
  isExpired: boolean;
} {
  const state = getSessionState(sessionId);
  const now = Date.now();
  const elapsed = now - state.last_updated;

  return {
    turnCount: state.turn_count,
    accumulatedWeight: state.accumulated_weight,
    categoryCounts: { ...state.patterns_by_category },
    lastUpdated: state.last_updated,
    isExpired: elapsed >= SESSION_TIMEOUT_MS,
  };
}
