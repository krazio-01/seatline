'use client';
import { useCallback, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { m, useReducedMotion } from 'motion/react';
import { UploadIcon } from 'lucide-react';
import './bookingsTable.scss';
import type { RevealResult, RevealTarget } from '@/components/dialogs/AadhaarReveal/AadhaarReveal';
import { ADMIN_ROOT_HREF } from '@/components/layout/navigation';
import { FilterMenu, type FilterOption } from '@/components/menus/FilterMenu/FilterMenu';
import { Badge } from '@/components/ui/Badge/Badge';
import { Button, ButtonLink } from '@/components/ui/Button/Button';
import { EmptyState } from '@/components/ui/EmptyState/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton/Skeleton';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TablePagination,
    TableRow,
    TableSearch,
    TableToolbar,
    describeTableRange,
    type TablePageRange,
} from '@/components/ui/Table/Table';
import { useToast } from '@/components/ui/Toast/Toast';
import { EMAIL_STATUS_LABELS, EmailStatus } from '@/components/widgets/EmailStatus/EmailStatus';
import { useLivePolling } from '@/context/liveSlices';
import { useUrlQuery, useUrlSearch } from '@/hooks/useUrlQuery';
import {
    EVENT_ZONES,
    ZONE_LABELS,
    type EmailStatus as EmailStatusValue,
    type ZoneName,
} from '@/types/booking';
import { api } from '@/services/client/api';
import type { BookingPage, BookingRow } from '@/types/admin';
import { formatDate } from '@/utils/dates';
import { DURATION, EASE_OUT } from '@/utils/motion';

type BookingStatus = BookingRow['status'];

type BookingQuery = {
    search?: string;
    status?: BookingStatus;
    emailStatus?: EmailStatusValue;
    zone?: ZoneName;
    page?: number;
};

type LoadedPage = { queryKey: string; page: BookingPage };

const AadhaarReveal = dynamic(
    () =>
        import('@/components/dialogs/AadhaarReveal/AadhaarReveal').then(
            (module) => module.AadhaarReveal,
        ),
    { ssr: false },
);

const POLL_INTERVAL_MS = 5000;
const SKELETON_ROW_COUNT = 5;
const COLUMN_COUNT = 8;

const STATUS_OPTIONS: FilterOption<BookingStatus>[] = [
    { value: 'confirmed', label: 'Not checked in' },
    { value: 'checkedIn', label: 'Checked in' },
];

const EMAIL_OPTIONS: FilterOption<EmailStatusValue>[] = (
    ['sent', 'pending', 'failed'] as const
).map((value) => ({ value, label: EMAIL_STATUS_LABELS[value] }));

const ZONE_OPTIONS: FilterOption<ZoneName>[] = EVENT_ZONES.map((zone) => ({
    value: zone,
    label: ZONE_LABELS[zone],
}));

function pickOption<Value extends string>(
    options: FilterOption<Value>[],
    value: string | null,
): Value | undefined {
    return options.find((option) => option.value === value)?.value;
}

function readQuery(params: URLSearchParams): BookingQuery {
    const page = Number(params.get('page'));

    return {
        search: params.get('search')?.trim() || undefined,
        status: pickOption(STATUS_OPTIONS, params.get('status')),
        emailStatus: pickOption(EMAIL_OPTIONS, params.get('emailStatus')),
        zone: pickOption(ZONE_OPTIONS, params.get('zone')),
        page: Number.isInteger(page) && page > 1 ? page : undefined,
    };
}

function rowSignature(row: BookingRow): string {
    return [row.status, row.email.status, row.checkedInAt, row.email.attempts].join('|');
}

function findChangedRows(previous: BookingPage | null, next: BookingPage): string[] {
    const previousSignatures = new Map(
        previous?.items.map((row) => [row.id, rowSignature(row)]) ?? [],
    );

    const changedRows = next.items.filter((row) => {
        const previousSignature = previousSignatures.get(row.id);

        return previousSignature !== undefined && previousSignature !== rowSignature(row);
    });

    return changedRows.map((row) => row.id);
}

function toPageRange(page: BookingPage): TablePageRange {
    return {
        page: page.page,
        pageSize: page.pageSize,
        total: page.total,
        itemCount: page.items.length,
    };
}

export function BookingsTable({ pageSize }: { pageSize: number }) {
    const { queryKey, updateQuery: writeQuery } = useUrlQuery();
    const prefersReducedMotion = useReducedMotion();
    const { toast } = useToast();
    const [revealTarget, setRevealTarget] = useState<RevealTarget | null>(null);
    const [hasOpenedReveal, setHasOpenedReveal] = useState(false);
    const [resendingId, setResendingId] = useState<string | null>(null);

    const query = useMemo(() => readQuery(new URLSearchParams(queryKey)), [queryKey]);

    const updateQuery = useCallback(
        (changes: Partial<Record<keyof BookingQuery, string | undefined>>) =>
            writeQuery({ page: undefined, ...changes }),
        [writeQuery],
    );

    const commitSearch = useCallback(
        (search: string | undefined) => updateQuery({ search }),
        [updateQuery],
    );

    const { searchText, setSearchText, clearSearch } = useUrlSearch(query.search, commitSearch);

    const loadPage = useCallback(
        async (signal: AbortSignal): Promise<LoadedPage> => ({
            queryKey,
            page: await api.bookings.list({ ...query, pageSize }, signal),
        }),
        [pageSize, query, queryKey],
    );

    const { data, refresh } = useLivePolling<LoadedPage | null>(loadPage, {
        intervalMs: POLL_INTERVAL_MS,
        initialData: null,
        immediate: true,
    });

    const shownPage = data?.page ?? null;
    const isStale = Boolean(data) && data?.queryKey !== queryKey;
    const [rowHistory, setRowHistory] = useState({
        source: null as LoadedPage | null,
        flashCounts: new Map<string, number>(),
    });
    const [announcement, setAnnouncement] = useState<{ queryKey: string | null; text: string }>({
        queryKey: null,
        text: '',
    });

    if (data && rowHistory.source !== data) {
        const isSameQuery = rowHistory.source?.queryKey === data.queryKey;
        const flashCounts = new Map(isSameQuery ? rowHistory.flashCounts : []);

        if (isSameQuery) {
            for (const id of findChangedRows(rowHistory.source?.page ?? null, data.page)) {
                flashCounts.set(id, (flashCounts.get(id) ?? 0) + 1);
            }
        }

        setRowHistory({ source: data, flashCounts });
    }

    if (data && data.queryKey === queryKey && announcement.queryKey !== queryKey) {
        setAnnouncement({ queryKey, text: describeTableRange(toPageRange(data.page)) });
    }

    const resendEmail = async (row: BookingRow) => {
        setResendingId(row.id);

        try {
            const delivery = await api.bookings.resendConfirmationEmail(row.id);

            toast(
                delivery.status === 'sent'
                    ? { title: 'Confirmation email sent', tone: 'success' }
                    : {
                          title: 'The email could not be sent',
                          description: delivery.lastError ?? undefined,
                          tone: 'error',
                      },
            );
        } catch (error) {
            toast({
                title: 'The email could not be sent',
                description: (error as Error).message,
                tone: 'error',
            });
        } finally {
            setResendingId(null);
            refresh();
        }
    };

    const openReveal = (row: BookingRow) => {
        setHasOpenedReveal(true);
        setRevealTarget({
            bookingId: row.id,
            studentName: row.studentName,
            guestCount: row.guests.length,
            result: api.bookings.revealAadhaar(row.id).then(
                ({ guests }): RevealResult => ({ status: 'loaded', guests }),
                (error: Error): RevealResult => ({ status: 'failed', message: error.message }),
            ),
        });
    };

    const goToPage = (page: number) => updateQuery({ page: page > 1 ? String(page) : undefined });

    const clearFilters = () => {
        clearSearch();
        updateQuery({
            search: undefined,
            status: undefined,
            emailStatus: undefined,
            zone: undefined,
        });
    };

    const pageNumber = query.page ?? 1;
    const currentPage = isStale ? null : shownPage;
    const isPastLastPage = Boolean(
        currentPage && currentPage.items.length === 0 && currentPage.total > 0,
    );
    const hasFilters = Boolean(query.search || query.status || query.emailStatus || query.zone);

    return (
        <div className="bookings-table">
            <TableToolbar>
                <TableSearch
                    label="Search bookings"
                    placeholder="Search by student or guest…"
                    value={searchText}
                    onChange={(event) => setSearchText(event.target.value)}
                />

                <FilterMenu
                    label="Status"
                    options={STATUS_OPTIONS}
                    value={query.status}
                    onValueChange={(status) => updateQuery({ status })}
                />

                <FilterMenu
                    label="Email"
                    options={EMAIL_OPTIONS}
                    value={query.emailStatus}
                    onValueChange={(emailStatus) => updateQuery({ emailStatus })}
                />

                <FilterMenu
                    label="Zone"
                    options={ZONE_OPTIONS}
                    value={query.zone}
                    onValueChange={(zone) => updateQuery({ zone })}
                />
            </TableToolbar>

            <Table aria-busy={!shownPage || isStale} data-stale={isStale || undefined}>
                <TableHeader>
                    <TableRow>
                        <TableHead>Student</TableHead>
                        <TableHead>Group</TableHead>
                        <TableHead>Guests</TableHead>
                        <TableHead>Zone</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Check-in</TableHead>
                        <TableHead>Aadhaar</TableHead>
                        <TableHead>
                            <span className="visually-hidden">Actions</span>
                        </TableHead>
                    </TableRow>
                </TableHeader>

                <TableBody>
                    {!shownPage &&
                        Array.from(
                            { length: Math.min(SKELETON_ROW_COUNT, pageSize) },
                            (_, index) => (
                                <TableRow key={index} className="bookings-table-skeleton-row">
                                    {Array.from({ length: COLUMN_COUNT }, (_, cellIndex) => (
                                        <TableCell key={cellIndex}>
                                            <Skeleton
                                                height={14}
                                                width={cellIndex === 0 ? 120 : 56}
                                            />
                                        </TableCell>
                                    ))}
                                </TableRow>
                            ),
                        )}

                    {shownPage?.items.map((row) => {
                        const firstGuest = row.guests[0];
                        const maskedAadhaar = firstGuest?.aadhaarMasked;

                        const flashCount = rowHistory.flashCounts.get(row.id);

                        return (
                            <TableRow
                                key={row.id}
                                className="bookings-table-row"
                                data-flash={
                                    flashCount ? (flashCount % 2 ? 'odd' : 'even') : undefined
                                }
                                render={
                                    <m.tr
                                        initial={{ opacity: 0, y: -6 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{
                                            duration: prefersReducedMotion ? 0 : DURATION.base,
                                            ease: EASE_OUT,
                                        }}
                                    />
                                }
                            >
                                <TableCell>
                                    <span className="bookings-table-student">
                                        {row.studentName}
                                    </span>
                                    {firstGuest && (
                                        <span className="bookings-table-guest">
                                            {firstGuest.name}
                                        </span>
                                    )}
                                </TableCell>
                                <TableCell className="bookings-table-muted">
                                    {row.studentGroup}
                                </TableCell>
                                <TableCell>{row.guests.length}</TableCell>
                                <TableCell>
                                    <span className="bookings-table-zone" data-zone={row.zone}>
                                        {ZONE_LABELS[row.zone]}
                                    </span>
                                </TableCell>
                                <TableCell>
                                    <EmailStatus
                                        delivery={row.email}
                                        isResending={resendingId === row.id}
                                        onResend={() => resendEmail(row)}
                                    />
                                </TableCell>
                                <TableCell>
                                    {row.checkedInAt ? (
                                        <span className="bookings-table-check-in">
                                            <Badge variant="solid">
                                                Checked in ·{' '}
                                                {formatDate(new Date(row.checkedInAt), 'time')}
                                            </Badge>
                                            {row.checkedInByName && (
                                                <span className="bookings-table-checker">
                                                    {row.checkedInByName}
                                                </span>
                                            )}
                                        </span>
                                    ) : (
                                        <span className="bookings-table-muted">Not yet</span>
                                    )}
                                </TableCell>
                                <TableCell className="bookings-table-aadhaar">
                                    {maskedAadhaar ?? '—'}
                                </TableCell>
                                <TableCell>
                                    {maskedAadhaar && (
                                        <Button
                                            variant="link"
                                            size="xs"
                                            onClick={() => openReveal(row)}
                                        >
                                            Reveal
                                        </Button>
                                    )}
                                </TableCell>
                            </TableRow>
                        );
                    })}

                    {shownPage?.items.length === 0 && (
                        <TableRow>
                            <TableCell colSpan={COLUMN_COUNT}>
                                {isPastLastPage ? (
                                    <EmptyState
                                        title="This page is past the last booking"
                                        description="Bookings may have moved since this link was made."
                                        preview={{
                                            name: 'bookings',
                                            status: `page ${pageNumber}`,
                                            message: 'nothing here',
                                        }}
                                        actions={
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => goToPage(1)}
                                            >
                                                Go to first page
                                            </Button>
                                        }
                                    />
                                ) : hasFilters ? (
                                    <EmptyState
                                        title="No bookings match these filters"
                                        description="Try a different name, or clear the filters to see every booking."
                                        preview={{
                                            name: 'bookings',
                                            status: 'filtered',
                                            message: 'no matches',
                                        }}
                                        actions={
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={clearFilters}
                                            >
                                                Clear filters
                                            </Button>
                                        }
                                    />
                                ) : (
                                    <EmptyState
                                        title="No bookings yet"
                                        description="When guests register on the booking page, their zones and passes appear here."
                                        preview={{
                                            name: 'bookings',
                                            status: '0 total',
                                            message: 'waiting for the first guest',
                                        }}
                                        actions={
                                            <>
                                                <ButtonLink
                                                    variant="outline"
                                                    size="sm"
                                                    href="/"
                                                    target="_blank"
                                                >
                                                    Open booking page
                                                </ButtonLink>
                                                <ButtonLink
                                                    size="sm"
                                                    href={`${ADMIN_ROOT_HREF}/students`}
                                                >
                                                    <UploadIcon aria-hidden="true" />
                                                    Import students
                                                </ButtonLink>
                                            </>
                                        }
                                    />
                                )}
                            </TableCell>
                        </TableRow>
                    )}
                </TableBody>
            </Table>

            <TablePagination
                range={shownPage && toPageRange(shownPage)}
                pageNumber={pageNumber}
                isBusy={isStale}
                loadingLabel="Loading bookings…"
                announcement={announcement.text}
                onPageChange={goToPage}
            />

            {hasOpenedReveal && (
                <AadhaarReveal target={revealTarget} onClose={() => setRevealTarget(null)} />
            )}
        </div>
    );
}
