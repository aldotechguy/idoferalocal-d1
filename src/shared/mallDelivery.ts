export type MallDeliveryZone = 'pickup' | 'uyo_central' | 'uyo_outer' | 'other';

export const MALL_DELIVERY_ZONES: ReadonlyArray<{
  id: MallDeliveryZone;
  label: string;
  feeKobo: number | null;
}> = [
  { id: 'pickup', label: 'Pickup', feeKobo: 0 },
  { id: 'uyo_central', label: 'Uyo central', feeKobo: 150_000 },
  { id: 'uyo_outer', label: 'Uyo outer areas', feeKobo: 250_000 },
  { id: 'other', label: 'Other locations', feeKobo: null },
];

export const MALL_DELIVERY_ZONE_IDS = new Set<MallDeliveryZone>(MALL_DELIVERY_ZONES.map((zone) => zone.id));

export function mallDeliveryZone(zone: unknown): MallDeliveryZone {
  return typeof zone === 'string' && MALL_DELIVERY_ZONE_IDS.has(zone as MallDeliveryZone)
    ? zone as MallDeliveryZone
    : 'pickup';
}

export function mallDeliveryFeeKobo(zone: MallDeliveryZone): number | null {
  return MALL_DELIVERY_ZONES.find((option) => option.id === zone)?.feeKobo ?? null;
}

export function mallDeliveryLabel(zone: MallDeliveryZone): string {
  return MALL_DELIVERY_ZONES.find((option) => option.id === zone)?.label ?? 'Pickup';
}