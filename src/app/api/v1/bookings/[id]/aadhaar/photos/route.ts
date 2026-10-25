import { withDomainErrors } from '@/lib/errors';
import { clientIp } from '@/providers/rate-limit';
import { deleteBookingPhotos } from '@/services/server/bookings';
import { requireAdminMutation } from '@/services/server/auth';

export const dynamic = 'force-dynamic';

export const DELETE = withDomainErrors(
    async (request: Request, context: { params: Promise<{ id: string }> }) => {
        const admin = await requireAdminMutation(request);
        const { id } = await context.params;

        return Response.json(
            await deleteBookingPhotos(id, `admin:${admin.userId}`, clientIp(request)),
        );
    },
);
