/**
 * The REFERRAL_TYPE system keys the three creation flows map to. Labels are editable masters; these keys
 * are the stable contract (seeded with `systemKey`). The flow, not the caller, decides the type.
 */
export const REFERRAL_TYPE_KEYS = { client: 'CLIENT', employee: 'EMPLOYEE', external: 'EXTERNAL' } as const;
export type ReferralTypeKey = (typeof REFERRAL_TYPE_KEYS)[keyof typeof REFERRAL_TYPE_KEYS];
