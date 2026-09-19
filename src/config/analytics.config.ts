/**
 * Stage 10 Part 4 — analytics configuration.
 *
 * Every tunable number for the dashboards lives here, on purpose: the brief
 * requires the performance-score weights to be editable in one place without
 * touching query or UI code.
 *
 * Editing a weight changes the score immediately. The weights must add up to 1,
 * which is checked at import time so a typo fails fast at boot instead of
 * quietly producing scores above 100.
 */

export type PerformanceScoreComponent =
  | 'views'
  | 'engagement'
  | 'readingTime'
  | 'shares'
  | 'relativeRank';

/**
 * Weights from the brief:
 *   score = views×0.35 + engagement×0.25 + readingTime×0.20
 *         + shares×0.10 + relativeRank×0.10
 */
export const performanceScoreWeights: Record<PerformanceScoreComponent, number> = {
  views: 0.35,
  engagement: 0.25,
  readingTime: 0.2,
  shares: 0.1,
  relativeRank: 0.1,
};

const weightSum = Object.values(performanceScoreWeights).reduce((sum, weight) => sum + weight, 0);
if (Math.abs(weightSum - 1) > 1e-9) {
  throw new Error(
    `analytics.config: performanceScoreWeights must sum to 1, got ${weightSum}. ` +
      'Fix the weights before starting the server.',
  );
}

export const performanceScoreConfig = {
  weights: performanceScoreWeights,
  /**
   * Each raw value is mapped onto 0..100 where the peer average sits at
   * `averageScore`. Twice the average therefore reaches `maxScore` and is
   * capped there, so one viral article cannot produce a score of 400.
   */
  normalisation: { averageScore: 50, maxScore: 100 },
  /** "20 similar articles from the last 30 days", per the brief. */
  comparison: { sampleSize: 20, windowDays: 30 },
  /** > good → «عملکرد بسیار خوب», >= average → «متوسط», else «ضعیف‌تر». */
  bands: { good: 80, average: 50 },
  /**
   * The special sentence in the brief: clearly more views than similar
   * articles, but clearly less interaction.
   */
  attentionRules: { highViewsRatio: 1.2, lowEngagementRatio: 0.6 },
} as const;

export const analyticsConfig = {
  /** A view whose reading session is shorter than this counts as a bounce. */
  bounceMaxSeconds: 5,
  /** Rows in the dashboard's "top news" card before «مشاهده همه». */
  topNewsLimit: 5,
  /** 6 hours: a tab left open overnight must not skew the average. */
  maxReadingSessionSeconds: 21_600,
  /** "Active user" = at least one view, like or comment in this window. */
  activeUsersWindowDays: 7,
  /** Cumulative views after publication: 1h, 6h, 24h, first 7 days. */
  launchCheckpointHours: [1, 6, 24, 168] as readonly number[],
  /** Beyond this span a chart switches from daily to monthly buckets. */
  dailyBucketMaxDays: 400,
} as const;
