import { ValidationError, withDomainErrors } from '@/lib/errors';
import { getTextRecognizer } from '@/providers';
import { clientIp, enforceRateLimit } from '@/providers/rate-limit';
import { storeAadhaarPhoto } from '@/services/server/bookings';
import { aadhaarPhotoUploadSchema, MAX_AADHAAR_PHOTO_BYTES } from '@/types/booking';
import { parseForm } from '@/utils/http';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const FORM_OVERHEAD_BYTES = 64 * 1024;

export const POST = withDomainErrors(async (request: Request) => {
    await enforceRateLimit('aadhaarPhotoUpload', clientIp(request));

    const declaredBytes = Number(request.headers.get('content-length') ?? 0);
    if (declaredBytes > MAX_AADHAAR_PHOTO_BYTES + FORM_OVERHEAD_BYTES) {
        throw new ValidationError([{ path: 'image', message: 'Upload a photo smaller than 4 MB' }]);
    }

    const { image, aadhaar, name } = await parseForm(request, aadhaarPhotoUploadSchema);
    const upload = { image: Buffer.from(await image.arrayBuffer()), aadhaar, name };

    return Response.json(await storeAadhaarPhoto(upload, getTextRecognizer()), { status: 201 });
});
