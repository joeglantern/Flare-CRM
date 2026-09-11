/**
 * The words the console uses about a customer's life, shared with the screens that show them.
 *
 * Status and archiving are deliberately separate things. Status is enforcement: anything other than
 * active expires that customer's document and their CRM goes read only. Archiving is filing: it says
 * we have stopped working with them, hides them from the fleet by default, and keeps every row.
 * Folding the two together would mean a word like "archived" quietly locking somebody out.
 */
import { z } from 'zod';

/** The three that carry enforcement. Adding to this changes what a customer's own CRM allows. */
export const CUSTOMER_STATUSES = ['active', 'suspended', 'churned'] as const;
export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];

/**
 * How far along a customer is in being set up. The console can observe most of provisioning from
 * heartbeats; this is the part only a person knows.
 */
export const ONBOARDING_STAGES = ['signed_up', 'provisioning', 'live', 'handed_over'] as const;
export type OnboardingStage = (typeof ONBOARDING_STAGES)[number];

export const ONBOARDING_STAGE_COPY: Record<
  OnboardingStage,
  { label: string; description: string }
> = {
  signed_up: {
    label: 'Signed up',
    description: 'They have agreed to a plan. Nothing has been built for them yet.',
  },
  provisioning: {
    label: 'Being set up',
    description: 'Their server is being prepared and their stack is not settled yet.',
  },
  live: {
    label: 'Live',
    description: 'Their CRM is up and their own people are using it.',
  },
  handed_over: {
    label: 'Handed over',
    description: 'They have been trained and are running it themselves.',
  },
};

/** The things a person ticks, as opposed to the things a heartbeat proves. */
export const ONBOARDING_CHECKLIST = [
  { key: 'agreement_signed', label: 'Agreement signed' },
  { key: 'data_imported', label: 'Their existing data imported' },
  { key: 'training_done', label: 'Their staff trained' },
  { key: 'invoice_sent', label: 'First invoice sent' },
] as const;
export type OnboardingChecklistKey = (typeof ONBOARDING_CHECKLIST)[number]['key'];

export const onboardingChecklist = z.object(
  Object.fromEntries(ONBOARDING_CHECKLIST.map((i) => [i.key, z.boolean().optional()])),
);

/** Why somebody left, in the small number of answers that are actually useful later. */
export const CHURN_REASONS = [
  'price',
  'moved_to_competitor',
  'closed_business',
  'unhappy_with_product',
  'went_quiet',
  'other',
] as const;
export type ChurnReason = (typeof CHURN_REASONS)[number];

export const CHURN_REASON_COPY: Record<ChurnReason, string> = {
  price: 'Too expensive',
  moved_to_competitor: 'Moved to a competitor',
  closed_business: 'The business closed',
  unhappy_with_product: 'Unhappy with the product',
  went_quiet: 'Went quiet and stopped paying',
  other: 'Something else',
};

/** How the fleet and customer lists are narrowed. Archived customers are out of the way by default. */
export const ARCHIVE_FILTERS = ['exclude', 'only', 'include'] as const;
export type ArchiveFilter = (typeof ARCHIVE_FILTERS)[number];

export const CUSTOMER_SORTS = ['name', 'createdAt', 'lastSeenAt', 'expiresAt'] as const;
export type CustomerSort = (typeof CUSTOMER_SORTS)[number];

export const customerFilterQuery = z.object({
  q: z.string().trim().max(120).optional(),
  status: z
    .union([z.enum(CUSTOMER_STATUSES), z.array(z.enum(CUSTOMER_STATUSES))])
    .optional()
    .transform((v) => (v === undefined ? undefined : Array.isArray(v) ? v : [v])),
  archived: z.enum(ARCHIVE_FILTERS).default('exclude'),
  planId: z.uuid().optional(),
  connected: z.enum(['true', 'false']).optional(),
  expiringWithinDays: z.coerce.number().int().min(0).max(400).optional(),
  onboardingStage: z.enum(ONBOARDING_STAGES).optional(),
  sort: z.enum(CUSTOMER_SORTS).default('name'),
  direction: z.enum(['asc', 'desc']).default('asc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type CustomerFilter = z.infer<typeof customerFilterQuery>;
