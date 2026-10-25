export class DomainError extends Error {
    constructor(
        readonly code: string,
        readonly status: number,
        message: string,
        readonly details?: unknown,
    ) {
        super(message);
        this.name = new.target.name;
    }
}

export class ValidationError extends DomainError {
    constructor(issues: { path: string; message: string }[]) {
        super('validation_failed', 422, 'The submitted data is invalid', issues);
    }
}

export class RateLimitedError extends DomainError {
    constructor(readonly retryAfterSeconds: number) {
        super('rate_limited', 429, 'Too many requests. Please try again shortly.');
    }
}

export class BotCheckFailedError extends DomainError {
    constructor() {
        super('bot_check_failed', 403, 'Verification failed. Please refresh and try again.');
    }
}

export class StudentAlreadyBookedError extends DomainError {
    constructor() {
        super('student_already_booked', 409, 'This student already has a booking.');
    }
}

export class IdempotencyKeyConflictError extends DomainError {
    constructor() {
        super(
            'idempotency_key_conflict',
            409,
            'This request key was already used for a different booking.',
        );
    }
}

export class AadhaarPhotoRejectedError extends DomainError {
    constructor(message: string) {
        super('aadhaar_photo_rejected', 422, message, [{ path: 'image', message }]);
    }
}

export class NotEnoughSeatsError extends DomainError {
    constructor() {
        super('not_enough_seats', 409, 'Not enough seats are left for this many guests.');
    }
}

export class BookingsClosedError extends DomainError {
    constructor() {
        super('bookings_closed', 409, 'Bookings are currently closed.');
    }
}

export class TooManyGuestsError extends DomainError {
    constructor(maxGuests: number) {
        super('too_many_guests', 422, `A booking can have at most ${maxGuests} guests.`);
    }
}

export class UnauthorizedError extends DomainError {
    constructor() {
        super('unauthorized', 401, 'Authentication required.');
    }
}

export class InvalidCredentialsError extends DomainError {
    constructor() {
        super('invalid_credentials', 401, 'Invalid credentials.');
    }
}

export class UsernameTakenError extends DomainError {
    constructor() {
        super('username_taken', 409, 'That username is already in use.');
    }
}

export class ForbiddenOriginError extends DomainError {
    constructor() {
        super('forbidden_origin', 403, 'Cross-origin request rejected.');
    }
}

export class NotFoundError extends DomainError {
    constructor(message: string) {
        super('not_found', 404, message);
    }
}

export class SettingsConflictError extends DomainError {
    constructor(message: string) {
        super('settings_conflict', 409, message);
    }
}

export class InvalidVerificationCodeError extends DomainError {
    constructor(attemptsRemaining: number) {
        super('invalid_verification_code', 422, 'That code is not correct.', { attemptsRemaining });
    }
}

export class VerificationExpiredError extends DomainError {
    constructor() {
        super('verification_expired', 410, 'That code has expired. Request a new one.');
    }
}

export class VerificationLockedError extends DomainError {
    constructor() {
        super('verification_locked', 429, 'Too many incorrect attempts. Request a new code.');
    }
}

export class EmailCapacityError extends DomainError {
    constructor() {
        super(
            'email_capacity_exceeded',
            503,
            'Email verification is temporarily unavailable. Please try again later.',
        );
    }
}

export class EmailDeliveryFailedError extends DomainError {
    constructor() {
        super(
            'email_delivery_failed',
            502,
            'We could not send the verification email. Check the address and try again.',
        );
    }
}

export class EmailNotVerifiedError extends DomainError {
    constructor() {
        super('email_not_verified', 422, 'Verify the email address of Guest 1 before booking.');
    }
}

export class ServiceBusyError extends DomainError {
    readonly retryAfterSeconds = 20;

    constructor() {
        super(
            'service_busy',
            503,
            'We are checking a lot of cards right now. Try again in a moment.',
        );
    }
}

export function toErrorResponse(error: DomainError): Response {
    return Response.json(
        { error: { code: error.code, message: error.message, details: error.details } },
        {
            status: error.status,
            headers:
                error instanceof RateLimitedError || error instanceof ServiceBusyError
                    ? { 'Retry-After': String(error.retryAfterSeconds) }
                    : undefined,
        },
    );
}

export function withDomainErrors<Args extends unknown[]>(
    handler: (...args: Args) => Promise<Response>,
) {
    return async (...args: Args): Promise<Response> => {
        try {
            return await handler(...args);
        } catch (error) {
            if (error instanceof DomainError) return toErrorResponse(error);
            throw error;
        }
    };
}
