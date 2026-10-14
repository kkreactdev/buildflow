import { z } from 'zod';
import { objectIdSchema } from '../../lib/ids';
import { pageQuerySchema } from '../../lib/listQuery';

const nullableId = objectIdSchema.nullable();
const text = (max: number) => z.string().trim().max(max);
const num = (min: number, max: number) => z.number().finite().min(min).max(max);
const price = num(0, 100_000_000_000);
const area = num(0, 10_000_000);
const lat = num(-90, 90);
const lng = num(-180, 180);
const count = z.number().int().min(0).max(50);

/** Descriptive fields shared by create and update. Status, owner, branch, media and the unit code are NOT here. */
const descriptive = {
  name: z.string().trim().min(1).max(150),
  propertyTypeId: objectIdSchema,
  buildingTypeId: objectIdSchema,
  locationId: objectIdSchema,
  address: text(300),
  city: text(100),
  state: text(100),
  pincode: text(12),
  latitude: lat,
  longitude: lng,
  plotArea: area,
  builtUpArea: area,
  expectedPrice: price,
  bedrooms: count,
  bathrooms: count,
  description: text(3000),
};

const together = (v: { latitude?: unknown; longitude?: unknown }) => (v.latitude === undefined) === (v.longitude === undefined);
const togetherMsg = { message: 'Latitude and longitude must be given together', path: ['latitude'] };

export const createUnitBody = z
  .object({
    ...descriptive,
    branchId: objectIdSchema.optional(),
    assignedTo: objectIdSchema.optional(),
  })
  .partial({ propertyTypeId: true, buildingTypeId: true, locationId: true, address: true, city: true, state: true, pincode: true, latitude: true, longitude: true, plotArea: true, builtUpArea: true, expectedPrice: true, bedrooms: true, bathrooms: true, description: true })
  .strict()
  .refine(together, togetherMsg);

/** Every field optional; `null` clears an optional value. A coordinate pair is set or cleared together. */
export const updateUnitBody = z
  .object({
    name: descriptive.name,
    propertyTypeId: nullableId,
    buildingTypeId: nullableId,
    locationId: nullableId,
    address: descriptive.address.nullable(),
    city: descriptive.city.nullable(),
    state: descriptive.state.nullable(),
    pincode: descriptive.pincode.nullable(),
    latitude: lat.nullable(),
    longitude: lng.nullable(),
    plotArea: area.nullable(),
    builtUpArea: area.nullable(),
    expectedPrice: price.nullable(),
    bedrooms: count.nullable(),
    bathrooms: count.nullable(),
    description: descriptive.description.nullable(),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update')
  .refine((v) => (v.latitude === undefined) === (v.longitude === undefined) && (v.latitude === null) === (v.longitude === null), togetherMsg);

export const assignBody = z.object({ assignedTo: objectIdSchema, reason: text(300).optional() }).strict();

/** `from` is the status the screen believes the unit has; a mismatch means someone else changed it (409). */
export const statusBody = z.object({ statusId: objectIdSchema, from: objectIdSchema.optional(), reason: text(300).optional() }).strict();

export const mediaUploadBody = z.object({ typeId: objectIdSchema, caption: text(200).optional() }).strict();
export const mediaParams = z.object({ id: objectIdSchema, mediaId: objectIdSchema });

const csv = z.string().transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean)).pipe(z.array(objectIdSchema).min(1).max(30));
const money = z.coerce.number().min(0).max(100_000_000_000);

export const unitFilters = z.object({
  search: z.string().trim().max(100).optional(),
  statusId: csv.optional(),
  propertyTypeId: objectIdSchema.optional(),
  buildingTypeId: objectIdSchema.optional(),
  locationId: objectIdSchema.optional(),
  assignedTo: z.union([objectIdSchema, z.literal('unassigned')]).optional(),
  branchId: objectIdSchema.optional(),
  minPrice: money.optional(),
  maxPrice: money.optional(),
  isArchived: z.enum(['true', 'false']).default('false'),
});
export type UnitFilters = z.infer<typeof unitFilters>;

export const listUnitQuery = pageQuerySchema.omit({ search: true }).merge(unitFilters).refine((q) => q.minPrice === undefined || q.maxPrice === undefined || q.minPrice <= q.maxPrice, { message: 'minPrice cannot exceed maxPrice', path: ['minPrice'] });
