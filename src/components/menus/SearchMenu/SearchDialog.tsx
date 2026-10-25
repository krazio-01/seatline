'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
    Command,
    CommandDialog,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from '@/components/ui/CommandMenu/CommandMenu';
import { EmptyState } from '@/components/ui/EmptyState/EmptyState';
import './searchMenu.scss';
import { api } from '@/services/client/api';
import type { BookingRow } from '@/types/admin';
import { ZONE_LABELS } from '@/types/booking';
import { ADMIN_PAGES, ADMIN_ROOT_HREF } from '@/components/layout/navigation';

type BookingResults = { query: string; items: BookingRow[]; errorMessage?: string };

const SEARCH_DEBOUNCE_MS = 250;
const BOOKING_RESULT_LIMIT = 5;

function describeBooking(booking: BookingRow): string {
    const parts = [booking.studentGroup, booking.guests[0]?.name, ZONE_LABELS[booking.zone]];
    const filledParts = parts.filter((part): part is string => Boolean(part));

    return filledParts.join(' · ');
}

export function SearchDialog({
    open,
    onOpenChange,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const router = useRouter();
    const [search, setSearch] = useState('');
    const [results, setResults] = useState<BookingResults | null>(null);

    const query = search.trim();
    const normalizedQuery = query.toLowerCase();
    const pages = ADMIN_PAGES.filter((page) => page.label.toLowerCase().includes(normalizedQuery));
    const currentResults = results?.query === query ? results : null;

    useEffect(() => {
        if (!query) return;

        const controller = new AbortController();

        const timer = setTimeout(() => {
            api.bookings
                .list({ search: query, pageSize: BOOKING_RESULT_LIMIT }, controller.signal)
                .then(
                    (page) => setResults({ query, items: page.items }),
                    (error: Error) => {
                        if (!controller.signal.aborted) {
                            setResults({ query, items: [], errorMessage: error.message });
                        }
                    },
                );
        }, SEARCH_DEBOUNCE_MS);

        return () => {
            clearTimeout(timer);
            controller.abort();
        };
    }, [query]);

    const goTo = (href: string) => {
        onOpenChange(false);
        router.push(href);
    };

    const hasNoMatches =
        pages.length === 0 && currentResults?.items.length === 0 && !currentResults.errorMessage;

    const bookingsMessage = !currentResults
        ? 'Searching bookings…'
        : (currentResults.errorMessage ??
          (currentResults.items.length === 0 ? 'No bookings match.' : undefined));

    return (
        <CommandDialog
            open={open}
            onOpenChange={onOpenChange}
            onOpenChangeComplete={(isOpen) => !isOpen && setSearch('')}
            title="Search"
            description="Jump to a console page or find a booking by student or guest name."
        >
            <Command className="search-menu-dialog" shouldFilter={false} loop>
                <CommandInput
                    value={search}
                    onValueChange={setSearch}
                    placeholder="Search pages and bookings…"
                />
                <CommandList>
                    {pages.length > 0 && (
                        <CommandGroup heading="Pages">
                            {pages.map((page) => (
                                <CommandItem
                                    key={page.href}
                                    value={`page:${page.href}`}
                                    onSelect={() => goTo(page.href)}
                                >
                                    <page.icon aria-hidden="true" />
                                    {page.label}
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    )}

                    {query && hasNoMatches && (
                        <EmptyState
                            size="compact"
                            title="Nothing matches your search"
                            description="Search by page name, or by a student or guest name for bookings."
                            preview={{
                                name: 'search',
                                status: `"${query}"`,
                                message: 'no matches',
                            }}
                        />
                    )}

                    {query && !hasNoMatches && (
                        <CommandGroup heading="Bookings">
                            {currentResults?.items.map((booking) => (
                                <CommandItem
                                    key={booking.id}
                                    value={`booking:${booking.id}`}
                                    onSelect={() =>
                                        goTo(
                                            `${ADMIN_ROOT_HREF}/bookings?search=${encodeURIComponent(booking.studentName)}`,
                                        )
                                    }
                                >
                                    <span className="search-menu-booking">
                                        <span className="search-menu-booking-name">
                                            {booking.studentName}
                                        </span>
                                        <span className="search-menu-booking-meta">
                                            {describeBooking(booking)}
                                        </span>
                                    </span>
                                </CommandItem>
                            ))}

                            {bookingsMessage && (
                                <p className="search-menu-status" role="status">
                                    {bookingsMessage}
                                </p>
                            )}
                        </CommandGroup>
                    )}
                </CommandList>
            </Command>
        </CommandDialog>
    );
}
