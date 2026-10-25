import {
    GraduationCapIcon,
    LayoutDashboardIcon,
    ScanLineIcon,
    SettingsIcon,
    TicketIcon,
    type LucideIcon,
} from 'lucide-react';
import type { DashboardStats } from '@/types/admin';

export type NavigationItem = {
    href: string;
    label: string;
    icon: LucideIcon;
    countStat?: keyof DashboardStats;
};

export type NavigationGroup = { label: string; items: NavigationItem[] };

export const ADMIN_ROOT_HREF = '/admin';

export const ADMIN_SIGN_IN_HREF = `${ADMIN_ROOT_HREF}/login`;

export const SCANNER_HREF = '/scanner';

export const SCANNER_SIGN_IN_HREF = `${SCANNER_HREF}/login`;

export const ADMIN_NAVIGATION: NavigationGroup[] = [
    {
        label: 'Overview',
        items: [
            { href: ADMIN_ROOT_HREF, label: 'Dashboard', icon: LayoutDashboardIcon },
            {
                href: `${ADMIN_ROOT_HREF}/bookings`,
                label: 'Bookings',
                icon: TicketIcon,
                countStat: 'bookings',
            },
            {
                href: `${ADMIN_ROOT_HREF}/students`,
                label: 'Students',
                icon: GraduationCapIcon,
                countStat: 'studentsTotal',
            },
        ],
    },
    {
        label: 'Event day',
        items: [
            {
                href: `${ADMIN_ROOT_HREF}/checkers`,
                label: 'Checkers',
                icon: ScanLineIcon,
                countStat: 'checkers',
            },
            { href: `${ADMIN_ROOT_HREF}/settings`, label: 'Settings', icon: SettingsIcon },
        ],
    },
];

export const ADMIN_PAGES: NavigationItem[] = ADMIN_NAVIGATION.flatMap((group) => group.items);

export function matchesPath(pathname: string, href: string, { exact = false } = {}): boolean {
    if (pathname === href) return true;

    return !exact && pathname.startsWith(`${href}/`);
}
