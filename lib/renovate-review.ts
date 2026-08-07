export const RENOVATE_REVIEW_DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;

export type RenovateReviewDay = (typeof RENOVATE_REVIEW_DAYS)[number] | "hidden";

export const DEFAULT_RENOVATE_REVIEW_DAY: RenovateReviewDay = "friday";

export function isRenovateReviewDay(value: unknown): value is RenovateReviewDay {
  return value === "hidden" || RENOVATE_REVIEW_DAYS.some((day) => day === value);
}

export function renovateReviewDayForDate(date: Date) {
  return RENOVATE_REVIEW_DAYS[date.getDay()];
}
