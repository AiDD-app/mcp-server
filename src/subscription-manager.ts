// =============================================================================
// SUBSCRIPTION & USAGE MANAGEMENT FOR AIDD MCP SERVER
// =============================================================================
// This module handles subscription tier checking, usage limits, and upgrade prompts
// in a way that complies with Anthropic MCP policies (no direct payment processing)
// =============================================================================

// =============================================================================
// TYPES
// =============================================================================

export type SubscriptionTier = 'FREE' | 'PRO';

export interface SubscriptionStatus {
  tier: SubscriptionTier;
  validUntil?: string;
  limits: UsageLimits;
  currentUsage: CurrentUsage;
}

export interface UsageLimits {
  scoringPerMonth: number;    // FREE: 1/month, PRO: 10/day (300/month)
  extractionsPerWeek: number; // FREE: 3/week, PRO: 200/week
  conversionsPerWeek: number; // FREE: 1/week, PRO: 200/week
  cooldownMinutes: number;    // FREE: 5 min, PRO: 0
}

export interface CurrentUsage {
  scoringThisMonth: number;
  extractionsThisWeek: number;
  conversionsThisWeek: number;
  weeklyResetDate: string;
  monthlyResetDate: string;
}

export interface UsageCheckResult {
  allowed: boolean;
  current: number;
  limit: number;
  remaining: number;
  tier: SubscriptionTier;
  upgradeUrl?: string;
  limitMessage?: string;
  warningMessage?: string;
}

export type OperationType = 'extraction' | 'conversion' | 'scoring';

// =============================================================================
// TIER LIMITS CONFIGURATION
// =============================================================================

export const TIER_LIMITS: Record<SubscriptionTier, UsageLimits> = {
  FREE: {
    scoringPerMonth: 1,       // 1 AI scoring per month
    extractionsPerWeek: 3,    // 3 extractions per week
    conversionsPerWeek: 1,    // 1 conversion per week
    cooldownMinutes: 5,       // 5 minute cooldown between operations
  },
  PRO: {
    scoringPerMonth: 300,     // 10 per day = ~300 per month
    extractionsPerWeek: 200,  // 200 extractions per week
    conversionsPerWeek: 200,  // 200 conversions per week
    cooldownMinutes: 0,       // No cooldown
  },
};

// =============================================================================
// UPGRADE URL GENERATOR
// =============================================================================

export interface UpgradeUrlParams {
  userId?: string;
  feature?: OperationType;
  currentTier?: SubscriptionTier;
  targetTier?: SubscriptionTier;
}

export function generateUpgradeUrl(params: UpgradeUrlParams): string {
  const baseUrl = 'https://aidd.app/upgrade';
  const searchParams = new URLSearchParams();

  // Add tracking parameters for analytics
  searchParams.set('source', 'mcp_claude');
  searchParams.set('utm_medium', 'mcp');
  searchParams.set('utm_campaign', 'limit_upgrade');

  if (params.feature) {
    searchParams.set('feature', params.feature);
  }
  if (params.currentTier) {
    searchParams.set('from', params.currentTier.toLowerCase());
  }
  if (params.targetTier) {
    searchParams.set('plan', params.targetTier.toLowerCase());
  }
  if (params.userId) {
    // Use last 8 chars for privacy while maintaining analytics capability
    searchParams.set('ref', params.userId.slice(-8));
  }

  return baseUrl + '?' + searchParams.toString();
}

// =============================================================================
// MESSAGE GENERATORS
// =============================================================================

const OPERATION_NAMES: Record<OperationType, string> = {
  extraction: 'AI extractions',
  conversion: 'task conversions',
  scoring: 'AI scoring runs',
};

const FEATURE_BENEFITS: Record<OperationType, string[]> = {
  extraction: [
    '200 AI extractions per week (vs 3 free)',
    'Batch processing for multiple notes',
    'No cooldown between operations',
  ],
  conversion: [
    '200 task conversions per week (vs 1 free)',
    'Advanced ADHD-optimized breakdowns',
    'No cooldown between operations',
  ],
  scoring: [
    '10 AI scoring runs per day (vs 1/month free)',
    'Real-time priority updates',
    'Personalized ADHD scoring factors',
  ],
};

export function generateLimitMessage(params: {
  operation: OperationType;
  current: number;
  limit: number;
  tier: SubscriptionTier;
  resetDate: string;
  upgradeUrl: string;
}): string {
  const { operation, current, limit, tier, resetDate, upgradeUrl } = params;

  const featureName = OPERATION_NAMES[operation];
  const benefits = FEATURE_BENEFITS[operation];
  const resetDateFormatted = new Date(resetDate).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric'
  });

  // Scoring is monthly, extractions/conversions are weekly
  const periodText = operation === 'scoring' ? 'this month' : 'this week';

  // Actual pricing: PRO Monthly $4.99/mo, PRO Annual $49.99/yr (save $10)
  const recommendedPlan = 'Pro';
  const recommendedPrice = '$4.99/mo or $49.99/yr';

  return `⚠️ **${tier} Tier Limit Reached**

You've used **${current}/${limit}** ${featureName} ${periodText}.
Your usage resets on **${resetDateFormatted}**.

---

### Upgrade to ${recommendedPlan} (${recommendedPrice})

${benefits.map(b => '✓ ' + b).join('\n')}

**All ${recommendedPlan} features:**
• Priority AI processing
• Advanced ADHD task optimization
• Email support
• Cancel anytime

---

👉 **[Upgrade to ${recommendedPlan}](${upgradeUrl})**

_Your work is saved. After upgrading, return here to continue where you left off._`;
}

export function generateUsageWarning(params: {
  operation: OperationType;
  current: number;
  limit: number;
  tier: SubscriptionTier;
}): string | null {
  const { operation, current, limit, tier } = params;

  // Don't warn for unlimited tiers
  if (limit === -1) {
    return null;
  }

  const remaining = limit - current;
  const percentUsed = (current / limit) * 100;

  // Warning at 80% usage
  if (percentUsed >= 80 && remaining > 0) {
    const featureName = OPERATION_NAMES[operation];
    // Scoring is monthly, extractions/conversions are weekly
    const periodText = operation === 'scoring' ? 'this month' : 'this week';
    return `📊 _${tier} tier: ${remaining} ${featureName} remaining ${periodText}_`;
  }

  return null;
}

// =============================================================================
// SUBSCRIPTION MANAGER CLASS
// =============================================================================

export class SubscriptionManager {
  private cachedStatus: SubscriptionStatus | null = null;
  private cacheExpiry: number = 0;
  private readonly CACHE_TTL_MS = 60000; // 1 minute cache

  constructor(private userId?: string) {}

  /**
   * Check if an operation is allowed based on current usage
   */
  checkUsage(
    operation: OperationType,
    status: SubscriptionStatus
  ): UsageCheckResult {
    const { tier, limits, currentUsage } = status;

    // Get the relevant limit and current usage
    let limit: number;
    let current: number;

    switch (operation) {
      case 'extraction':
        limit = limits.extractionsPerWeek;
        current = currentUsage.extractionsThisWeek;
        break;
      case 'conversion':
        limit = limits.conversionsPerWeek;
        current = currentUsage.conversionsThisWeek;
        break;
      case 'scoring':
        limit = limits.scoringPerMonth;
        current = currentUsage.scoringThisMonth;
        break;
      default:
        return { allowed: true, current: 0, limit: -1, remaining: -1, tier };
    }

    // Unlimited check
    if (limit === -1) {
      return { allowed: true, current, limit, remaining: -1, tier };
    }

    const remaining = Math.max(0, limit - current);
    const allowed = current < limit;

    const result: UsageCheckResult = {
      allowed,
      current,
      limit,
      remaining,
      tier,
    };

    // Generate upgrade URL if at or near limit
    if (!allowed || remaining <= Math.ceil(limit * 0.2)) {
      result.upgradeUrl = generateUpgradeUrl({
        userId: this.userId,
        feature: operation,
        currentTier: tier,
        targetTier: 'PRO',
      });
    }

    // Generate appropriate message - use weekly reset for extraction/conversion, monthly for scoring
    const resetDate = operation === 'scoring'
      ? currentUsage.monthlyResetDate
      : currentUsage.weeklyResetDate;

    if (!allowed) {
      result.limitMessage = generateLimitMessage({
        operation,
        current,
        limit,
        tier,
        resetDate,
        upgradeUrl: result.upgradeUrl!,
      });
    } else {
      const warning = generateUsageWarning({
        operation,
        current,
        limit,
        tier,
      });
      result.warningMessage = warning || undefined;
    }

    return result;
  }

  /**
   * Get default status for when backend is unavailable
   */
  getDefaultStatus(): SubscriptionStatus {
    const now = new Date();
    // Weekly reset: next Monday
    const weeklyReset = new Date(now);
    weeklyReset.setDate(weeklyReset.getDate() + (8 - weeklyReset.getDay()) % 7 || 7);
    // Monthly reset: first of next month
    const monthlyReset = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    return {
      tier: 'FREE',
      limits: TIER_LIMITS.FREE,
      currentUsage: {
        scoringThisMonth: 0,
        extractionsThisWeek: 0,
        conversionsThisWeek: 0,
        weeklyResetDate: weeklyReset.toISOString(),
        monthlyResetDate: monthlyReset.toISOString(),
      },
    };
  }

  /**
   * Parse subscription status from backend response
   */
  parseBackendResponse(data: any): SubscriptionStatus {
    // Normalize tier - backend may return PREMIUM which is equivalent to PRO
    let tier = (data.tier || data.subscriptionTier || 'FREE').toUpperCase();
    if (tier === 'PREMIUM') tier = 'PRO';
    const normalizedTier = tier as SubscriptionTier;
    const limits = TIER_LIMITS[normalizedTier] || TIER_LIMITS.FREE;

    // Calculate reset dates
    const now = new Date();
    // Weekly reset: next Monday
    const weeklyReset = new Date(now);
    weeklyReset.setDate(weeklyReset.getDate() + (8 - weeklyReset.getDay()) % 7 || 7);
    // Monthly reset: first of next month
    const monthlyReset = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    return {
      tier: normalizedTier,
      validUntil: data.validUntil || data.subscriptionExpiry,
      limits,
      currentUsage: {
        scoringThisMonth: data.usage?.scoringThisMonth || data.scoringThisMonth || 0,
        extractionsThisWeek: data.usage?.extractionsThisWeek || data.extractionsThisWeek || 0,
        conversionsThisWeek: data.usage?.conversionsThisWeek || data.conversionsThisWeek || 0,
        weeklyResetDate: data.usage?.weeklyResetDate || weeklyReset.toISOString(),
        monthlyResetDate: data.usage?.monthlyResetDate || monthlyReset.toISOString(),
      },
    };
  }
}
