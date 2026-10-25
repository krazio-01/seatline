'use client';
import { useState } from 'react';
import type { ZoneName } from '@/types/booking';

type ZoneSeating = { name: ZoneName; capacity: number };

function seatingKey(zones: ZoneSeating[]): string {
    return zones.map((zone) => `${zone.name}:${zone.capacity}`).join(',');
}

export function useZoneSeating(zones: ZoneSeating[]): ZoneSeating[] {
    const key = seatingKey(zones);
    const [seating, setSeating] = useState(() => ({
        key,
        zones: zones.map(({ name, capacity }) => ({ name, capacity })),
    }));

    if (seating.key !== key) {
        const next = { key, zones: zones.map(({ name, capacity }) => ({ name, capacity })) };
        setSeating(next);

        return next.zones;
    }

    return seating.zones;
}
