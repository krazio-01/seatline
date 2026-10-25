import { withDomainErrors } from '@/lib/errors';
import { clientIp, enforceRateLimit } from '@/providers/rate-limit';
import { readMaskedPhoto } from '@/services/server/bookings';
import { requireCheckerSession } from '@/services/server/auth';
import { photoTokenQuerySchema } from '@/types/admin';
import { parseQuery, privateResponse } from '@/utils/http';

export const dynamic = 'force-dynamic';

export const GET = withDomainErrors(async (request: Request) => {
    const checker = await requireCheckerSession();
    await enforceRateLimit('aadhaarPhotoView', `checker:${checker.userId}`);

    const { token } = parseQuery(request, photoTokenQuerySchema);

    const photo = await readMaskedPhoto(token, checker.userId, clientIp(request));

    return privateResponse(photo, 'image/jpeg');
});
