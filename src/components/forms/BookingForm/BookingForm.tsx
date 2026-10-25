'use client';
import { useState, type CSSProperties } from 'react';
import { AnimatePresence, m } from 'motion/react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, type Resolver } from 'react-hook-form';
import './bookingForm.scss';
import { AnimatedHeight, MotionProvider } from '@/components/ui/Animations/ClientAnimations';
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@/components/ui/Card/Card';
import { useAppContext, useUpdateAppContext } from '@/context/appContext';
import { admitBooking } from '@/context/appStore';
import {
    BOOKING_STEPS,
    EMPTY_GUEST,
    nextStep,
    type BookingDetailsValues,
    type BookingStep,
    type BookingStepEvent,
} from '@/utils/booking-form';
import { useBotCheck, useEmailVerification } from '@/components/forms/BookingForm/bookingFormHooks';
import { DetailsStep, VerifyStep } from '@/components/forms/BookingForm/BookingSteps';
import { BookingPass } from '@/components/widgets/BookingPass/BookingPass';
import type { BookingConfirmation } from '@/types/booking';
import type { StudentOption } from '@/types/booking';
import { createBookingBodySchema } from '@/types/booking';
import { DURATION, EASE_OUT } from '@/utils/motion';

const PLACEHOLDER_VERIFICATION_TOKEN = 'email-is-verified-in-the-next-step';
const STEP_SHIFT_PX = 16;

const STEP_DESCRIPTIONS: Record<BookingStep, string> = {
    details: 'Fill in the details exactly as on the Aadhaar card.',
    verify: "Confirm Guest 1's email to reserve your seats.",
    pass: 'Your seats are reserved.',
};

const validateBooking = zodResolver(createBookingBodySchema, undefined, { raw: true });

const detailsResolver: Resolver<BookingDetailsValues> = (values, context, options) =>
    validateBooking(
        { ...values, emailVerificationToken: PLACEHOLDER_VERIFICATION_TOKEN },
        context,
        options as never,
    ) as ReturnType<Resolver<BookingDetailsValues>>;

export function BookingForm({
    maxGuestsPerBooking,
    turnstileSiteKey,
}: {
    maxGuestsPerBooking: number;
    turnstileSiteKey?: string;
}) {
    const updateAppContext = useUpdateAppContext();
    const booking = useAppContext('booking');

    const [step, setStep] = useState<BookingStep>('details');
    const [student, setStudent] = useState<StudentOption | null>(null);
    const [confirmation, setConfirmation] = useState<BookingConfirmation | null>(null);

    const form = useForm<BookingDetailsValues>({
        resolver: detailsResolver,
        defaultValues: { studentId: '', guests: [{ ...EMPTY_GUEST }] },
    });

    const dispatchStepEvent = (event: BookingStepEvent) =>
        setStep((current) => nextStep(current, event));

    const botCheck = useBotCheck(turnstileSiteKey);

    const emailVerification = useEmailVerification({
        form,
        botCheck,
        dispatchStepEvent,
        onBooked: (booked) => {
            setConfirmation(booked);
            dispatchStepEvent('codeConfirmed');
            updateAppContext('booking', admitBooking(booking, booked));
        },
    });

    const activeStepIndex = BOOKING_STEPS.findIndex((item) => item.value === step);

    return (
        <MotionProvider>
            <Card raised className="booking-form">
                <CardHeader className="booking-form-header">
                    <CardTitle role="heading" aria-level={2}>
                        Book your seats
                    </CardTitle>
                    <CardDescription>{STEP_DESCRIPTIONS[step]}</CardDescription>
                </CardHeader>

                <ol
                    className="booking-form-steps"
                    aria-label="Booking steps"
                    style={{ '--active-step-index': activeStepIndex } as CSSProperties}
                >
                    {BOOKING_STEPS.map((item) => (
                        <li
                            key={item.value}
                            className="booking-form-step"
                            aria-current={item.value === step ? 'step' : undefined}
                        >
                            {item.label}
                        </li>
                    ))}
                </ol>

                <CardContent className="booking-form-content">
                    <AnimatedHeight>
                        <AnimatePresence mode="wait" initial={false}>
                            <m.div
                                key={step}
                                initial={{ opacity: 0, x: STEP_SHIFT_PX }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: -STEP_SHIFT_PX }}
                                transition={{ duration: DURATION.fast, ease: EASE_OUT }}
                            >
                                {step === 'details' && (
                                    <DetailsStep
                                        form={form}
                                        maxGuestsPerBooking={maxGuestsPerBooking}
                                        botCheck={botCheck}
                                        emailVerification={emailVerification}
                                        student={student}
                                        onStudentChange={setStudent}
                                    />
                                )}

                                {step === 'verify' && (
                                    <VerifyStep
                                        botCheck={botCheck}
                                        emailVerification={emailVerification}
                                    />
                                )}

                                {step === 'pass' && confirmation && (
                                    <BookingPass confirmation={confirmation} student={student} />
                                )}
                            </m.div>
                        </AnimatePresence>
                    </AnimatedHeight>
                </CardContent>
            </Card>
        </MotionProvider>
    );
}
