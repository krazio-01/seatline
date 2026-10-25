'use client';
import type { ReactNode } from 'react';
import { AnimatePresence, m } from 'motion/react';
import { ArrowRightIcon, CircleAlertIcon } from 'lucide-react';
import { Controller, type UseFormReturn } from 'react-hook-form';
import './bookingForm.scss';
import { Alert, AlertAction, AlertDescription } from '@/components/ui/Alert/Alert';
import { Button } from '@/components/ui/Button/Button';
import { Label } from '@/components/ui/Label/Label';
import type { BookingDetailsValues } from '@/utils/booking-form';
import type { BotCheck, EmailVerification } from '@/components/forms/BookingForm/bookingFormHooks';
import { FieldError } from '@/components/forms/FieldError/FieldError';
import { GuestFields } from '@/components/forms/GuestFields/GuestFields';
import { OtpInput } from '@/components/ui/OtpInput/OtpInput';
import { StudentSelect } from '@/components/forms/StudentSelect/StudentSelect';
import { Turnstile } from '@/components/forms/Turnstile/Turnstile';
import type { StudentOption } from '@/types/booking';
import { VERIFICATION_CODE_LENGTH } from '@/types/booking';
import { DURATION, EASE_OUT } from '@/utils/motion';
import { maskEmail } from '@/utils/text';

function FormAlert({ message, action }: { message?: string; action?: ReactNode }) {
    return (
        <AnimatePresence initial={false}>
            {message && (
                <m.div
                    key={message}
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: DURATION.fast, ease: EASE_OUT }}
                >
                    <Alert variant="destructive">
                        <CircleAlertIcon />
                        <AlertDescription>{message}</AlertDescription>
                        {action && <AlertAction>{action}</AlertAction>}
                    </Alert>
                </m.div>
            )}
        </AnimatePresence>
    );
}

function BotCheckField({ botCheck }: { botCheck: BotCheck }) {
    if (!botCheck.turnstileSiteKey) return null;

    return (
        <>
            <div className="booking-form-bot-check">
                {botCheck.isBotCheckActive && (
                    <Turnstile
                        key={botCheck.turnstileResetKey}
                        siteKey={botCheck.turnstileSiteKey}
                        loadAttempt={botCheck.turnstileScriptAttempt}
                        onToken={botCheck.updateBotToken}
                        onError={botCheck.reportBotCheckFailure}
                    />
                )}
            </div>
            <FormAlert
                message={
                    botCheck.hasBotCheckFailed ? "Couldn't load the security check." : undefined
                }
                action={
                    <Button variant="outline" size="sm" onClick={botCheck.retryBotCheck}>
                        Retry
                    </Button>
                }
            />
        </>
    );
}

export function DetailsStep({
    form,
    maxGuestsPerBooking,
    botCheck,
    emailVerification,
    student,
    onStudentChange,
}: {
    form: UseFormReturn<BookingDetailsValues>;
    maxGuestsPerBooking: number;
    botCheck: BotCheck;
    emailVerification: EmailVerification;
    student: StudentOption | null;
    onStudentChange: (student: StudentOption) => void;
}) {
    const {
        control,
        register,
        setValue,
        handleSubmit,
        formState: { errors },
    } = form;

    return (
        <form
            className="booking-form-step-panel"
            noValidate
            onFocus={botCheck.activateBotCheck}
            onInput={botCheck.activateBotCheck}
            onPointerDown={botCheck.activateBotCheck}
            onSubmit={(event) => void handleSubmit(emailVerification.sendCode)(event)}
        >
            <div className="booking-form-field">
                <Label htmlFor="booking-student">Student</Label>
                <Controller
                    control={control}
                    name="studentId"
                    render={({ field, fieldState }) => (
                        <StudentSelect
                            ref={field.ref}
                            id="booking-student"
                            value={student}
                            invalid={Boolean(fieldState.error)}
                            describedBy={fieldState.error ? 'booking-student-error' : undefined}
                            onChange={(chosen) => {
                                onStudentChange(chosen);
                                field.onChange(chosen.id);
                            }}
                        />
                    )}
                />
                <FieldError id="booking-student-error" message={errors.studentId?.message} />
            </div>

            <GuestFields
                control={control}
                register={register}
                setValue={setValue}
                errors={errors}
                maxGuestsPerBooking={maxGuestsPerBooking}
            />

            <BotCheckField botCheck={botCheck} />

            <FormAlert message={emailVerification.formError} />

            <div className="booking-form-actions">
                <Button
                    type="submit"
                    loading={emailVerification.isSendingCode}
                    disabled={botCheck.isWaitingForBotCheck}
                >
                    Continue
                    <ArrowRightIcon />
                </Button>
                <p className="booking-form-hint">
                    We&apos;ll send a {VERIFICATION_CODE_LENGTH}-digit code to Guest 1&apos;s email.
                </p>
            </div>
        </form>
    );
}

export function VerifyStep({
    botCheck,
    emailVerification,
}: {
    botCheck: BotCheck;
    emailVerification: EmailVerification;
}) {
    const { verification, code, codeError, codeNotice, isBooking, isSendingCode } =
        emailVerification;

    return (
        <form
            className="booking-form-step-panel"
            noValidate
            onSubmit={(event) => {
                event.preventDefault();
                void emailVerification.confirmAndBook(code);
            }}
        >
            <div className="booking-form-field">
                <div className="booking-form-code-header">
                    <Label htmlFor="booking-code">Verification code</Label>
                    <Button
                        variant="link"
                        className="booking-form-link"
                        onClick={emailVerification.editDetails}
                    >
                        Change details
                    </Button>
                </div>
                <p className="booking-form-sent-to">
                    Sent to <strong>{verification ? maskEmail(verification.email) : ''}</strong>
                </p>
                <OtpInput
                    id="booking-code"
                    value={code}
                    onChange={emailVerification.changeCode}
                    onComplete={(digits) => void emailVerification.confirmAndBook(digits)}
                    shakeSignal={emailVerification.shakeSignal}
                    invalid={Boolean(codeError)}
                    readOnly={isBooking}
                    describedBy={codeError ? 'booking-code-error' : undefined}
                />
                <FieldError id="booking-code-error" message={codeError} />
            </div>

            <BotCheckField botCheck={botCheck} />

            <FormAlert message={emailVerification.formError} />

            <div className="booking-form-actions">
                <Button
                    type="submit"
                    loading={isBooking}
                    disabled={
                        code.length !== VERIFICATION_CODE_LENGTH || botCheck.isWaitingForBotCheck
                    }
                >
                    Verify and book
                </Button>
                <p className="booking-form-hint">
                    {codeNotice ?? "Didn't get the code?"}{' '}
                    <Button
                        variant="link"
                        className="booking-form-link"
                        disabled={isSendingCode || isBooking || botCheck.isWaitingForBotCheck}
                        onClick={emailVerification.resendCode}
                    >
                        Resend code
                    </Button>
                </p>
            </div>
        </form>
    );
}
