import { withDomainErrors } from '@/lib/errors';
import { clientIp, enforceRateLimit } from '@/providers/rate-limit';
import { readOriginalPhoto } from '@/services/server/bookings';
import { requireAdminSession } from '@/services/server/auth';
import { guestPhotoParamsSchema } from '@/types/admin';
import { assertSameOriginFetch, parseWithSchema, privateResponse } from '@/utils/http';

export const dynamic = 'force-dynamic';

export const GET = withDomainErrors(
    async (request: Request, context: { params: Promise<{ id: string; guestIndex: string }> }) => {
        assertSameOriginFetch(request);

        const admin = await requireAdminSession();
        const actor = `admin:${admin.userId}`;
        await enforceRateLimit('aadhaarReveal', actor);

        const { id, guestIndex } = await context.params;
        const params = parseWithSchema({ guestIndex }, guestPhotoParamsSchema);

        const photo = await readOriginalPhoto(id, params.guestIndex, actor, clientIp(request));

        return privateResponse(photo, 'image/jpeg');
    },
);
