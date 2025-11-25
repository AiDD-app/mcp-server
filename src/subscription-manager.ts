// =============================================================================
// SUBSCRIPTION & USAGE MANAGEMENT FOR AIDD MCP SERVER
// =============================================================================
// This module handles subscription tier checking, usage limits, and upgrade prompts
// in a way that complies with Anthropic MCP policies (no direct payment processing)
// =============================================================================

// =============================================================================
// TYPES
// =============================================================================

export type SubscriptionTier = 'FREE' | 'PREMIUM' | 'PRO';

export interface SubscriptionStatus {
  tier: SubscriptionTier;
  validUntil?: string;
  limits: UsageLimits;
  currentUsage: CurrentUsage;
}

export interface UsageLimits {
  notesPerMonth: number;
  extractionsPerMonth: number;
  conversionsPerMonth: number;
  scoringPerMonth: number;
  maxNotesStored: number;
}

export interface CurrentUsage {
  notesThisMonth: number;
  extractionsThisMonth: number;
  conversionsThisMonth: number;
  scoringThisMonth: number;
  totalNotesStored: number;
  resetDate: string;
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

export type OperationType = 'extraction' | 'conversion' | 'scoring' | 'notes' | 'storage';

// =============================================================================
// TIER LIMITS CONFIGURATION
// =============================================================================

export const TIER_LIMITS: Record<SubscriptionTier, UsageLimits> = {
  FREE: {
    notesPerMonth: 10,
    extractionsPerMonth: 5,
    conversionsPerMonth: 5,
    scoringPerMonth: 3,
    maxNotesStored: 25,
  },
  PREMIUM: {
    notesPerMonth: 100,
    extractionsPerMonth: 50,
    conversionsPerMonth: 50,
    scoringPerMonth: 25,
    maxNotesStored: 500,
  },
  PRO: {
    notesPerMonth: -1, // Unlimited
    extractionsPerMonth: -1,
    conversionsPerMonth: -1,
    scoringPerMonth: -1,
    maxNotesStored: -1,
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
  notes: 'notes created',
  storage: 'notes stored',
};

const FEATURE_BENEFITS: Record<OperationType, string[]> = {
  extraction: [
    '10x more AI-powered action item extraction',
    'Batch processing for multiple notes',
    'Higher accuracy extraction mode',
  ],
  conversion: [
    '10x more ADHD-optimized task conversions',
    'Advanced task breakdown algorithms',
    'Custom conversion preferences',
  ],
  scoring: [
    '8x more AI task scoring runs',
    'Real-time priority updates',
    'Personalized ADHD scoring factors',
  ],
  notes: [
    '10x more notes per month',
    'Unlimited note length',
    'Rich formatting support',
  ],
  storage: [
    '20x more note storage',
    'Automatic backups',
    'Cross-device sync',
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

  // Determine recommended plan based on current tier
  const recommendedPlan = tier === 'FREE' ? 'Premium' : 'Pro';
  const recommendedPrice = tier === 'FREE' ? '$9.99/mo' : '$19.99/mo';

  return `⚠️ **${tier} Tier Limit Reached**

You've used **${current}/${limit}** ${featureName} this month.
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
    return `📊 _${tier} tier: ${remaining} ${featureName} remaining this month_`;
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
        limit = limits.extractionsPerMonth;
        current = currentUsage.extractionsThisMonth;
        break;
      case 'conversion':
        limit = limits.conversionsPerMonth;
        current = currentUsage.conversionsThisMonth;
        break;
      case 'scoring':
        limit = limits.scoringPerMonth;
        current = currentUsage.scoringThisMonth;
        break;
      case 'notes':
        limit = limits.notesPerMonth;
        current = currentUsage.notesThisMonth;
        break;
      case 'storage':
        limit = limits.maxNotesStored;
        current = currentUsage.totalNotesStored;
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
        targetTier: tier === 'FREE' ? 'PREMIUM' : 'PRO',
      });
    }

    // Generate appropriate message
    if (!allowed) {
      result.limitMessage = generateLimitMessage({
        operation,
        current,
        limit,
        tier,
        resetDate: currentUsage.resetDate,
        upgradeUrl: result.upgradeUrl!,
      });
    } else {
      result.warningMessage = generateUsageWarning({
        operation,
        current,
        limit,
        tier,
      });
    }

    return result;
  }

  /**
   * Get default status for when backend is unavailable
   */
  getDefaultStatus(): SubscriptionStatus {
    const now = new Date();
    const resetDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    return {
      tier: 'FREE',
      limits: TIER_LIMITS.FREE,
      currentUsage: {
        notesThisMonth: 0,
        extractionsThisMonth: 0,
        conversionsThisMonth: 0,
        scoringThisMonth: 0,
        totalNotesStored: 0,
        resetDate: resetDate.toISOString(),
      },
    };
  }

  /**
   * Parse subscription status from backend response
   */
  parseBackendResponse(data: any): SubscriptionStatus {
    const tier = (data.tier || data.subscriptionTier || 'FREE').toUpperCase() as SubscriptionTier;
    const limits = TIER_LIMITS[tier] || TIER_LIMITS.FREE;

    // Calculate reset date (first of next month)
    const now = new Date();
    const resetDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    return {
      tier,
      validUntil: data.validUntil || data.subscriptionExpiry,
      limits,
      currentUsage: {
        notesThisMonth: data.usage?.notesThisMonth || data.notesThisMonth || 0,
        extractionsThisMonth: data.usage?.extractionsThisMonth || data.extractionsThisMonth || 0,
        conversionsThisMonth: data.usage?.conversionsThisMonth || data.conversionsThisMonth || 0,
        scoringThisMonth: data.usage?.scoringThisMonth || data.scoringThisMonth || 0,
        totalNotesStored: data.usage?.totalNotesStored || data.totalNotesStored || 0,
        resetDate: data.usage?.resetDate || data.resetDate || resetDate.toISOString(),
      },
    };
  }
}
