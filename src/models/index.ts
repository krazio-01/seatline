export {
    default as AadhaarPhotoModel,
    AADHAAR_PHOTO_STATUSES,
    type AadhaarPhotoDocument,
} from './aadhaarPhoto';
export { default as AuditLogModel, type AuditLogDocument } from './auditLog';
export { default as BookingModel, type BookingDocument } from './booking';

export {
    default as EmailVerificationModel,
    type EmailVerificationDocument,
} from './emailVerification';

export {
    default as SettingsModel,
    EVENT_DEFAULTS,
    EVENT_SETTINGS_KEY,
    type SettingsDocument,
} from './settings';
export { default as StudentModel, type StudentDocument } from './student';
export { default as UserModel, type UserDocument, type UserRole } from './user';
