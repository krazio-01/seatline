import { Suspense } from 'react';
import type { Metadata } from 'next';
import './page.scss';
import { PageHeading } from '@/components/layout/PageHeading/PageHeading';
import { BookingsTable } from '@/components/tables/BookingsTable/BookingsTable';
import { Card } from '@/components/ui/Card/Card';
import { Skeleton } from '@/components/ui/Skeleton/Skeleton';
import { requireAdminPage } from '@/services/server/auth';

export const metadata: Metadata = { title: 'Bookings' };

const BOOKINGS_PAGE_SIZE = 25;

export default async function Page() {
    await requireAdminPage();

    return (
        <div className="bookings-page">
            <PageHeading
                title="Bookings"
                description="Every registration with its zone, email delivery and check-in. Aadhaar numbers stay masked until you reveal them; every reveal is logged."
            />

            <Card className="bookings-page-card">
                <Suspense fallback={<Skeleton height={480} className="bookings-page-fallback" />}>
                    <BookingsTable pageSize={BOOKINGS_PAGE_SIZE} />
                </Suspense>
            </Card>
        </div>
    );
}
