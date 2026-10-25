'use client';
import { useId } from 'react';
import { AnimatePresence, m, useReducedMotion } from 'motion/react';
import { PlusIcon, XIcon } from 'lucide-react';
import {
    Controller,
    useFieldArray,
    useWatch,
    type Control,
    type FieldErrors,
    type UseFormRegister,
    type UseFormSetValue,
} from 'react-hook-form';
import { z } from 'zod/mini';
import './guestFields.scss';
import { Badge } from '@/components/ui/Badge/Badge';
import { Button } from '@/components/ui/Button/Button';
import { Input } from '@/components/ui/Input/Input';
import { Label } from '@/components/ui/Label/Label';
import { Separator } from '@/components/ui/Separator/Separator';
import { AadhaarPhotoField } from '@/components/forms/AadhaarPhotoField/AadhaarPhotoField';
import { FieldError } from '@/components/forms/FieldError/FieldError';
import { EMPTY_GUEST, type BookingDetailsValues, type GuestValues } from '@/utils/booking-form';
import {
    AADHAAR_GROUP_SIZE,
    AADHAAR_LENGTH,
    guestInputSchema,
    PHONE_GROUP_SIZES,
    PHONE_LENGTH,
} from '@/types/booking';
import { groupCharacters } from '@/utils/text';
import { DURATION, EASE_OUT } from '@/utils/motion';

const GUEST_INPUTS: {
    field: keyof GuestValues;
    label: string;
    placeholder: string;
    type: string;
    inputMode?: 'numeric' | 'tel' | 'email';
    autoComplete?: string;
}[] = [
    {
        field: 'name',
        label: 'Full name',
        placeholder: 'Rahul Verma',
        type: 'text',
        autoComplete: 'name',
    },
    {
        field: 'aadhaar',
        label: 'Aadhaar',
        placeholder: 'XXXX XXXX XXXX',
        type: 'text',
        inputMode: 'numeric',
        autoComplete: 'off',
    },
    {
        field: 'phone',
        label: 'Phone',
        placeholder: '98765 43210',
        type: 'tel',
        inputMode: 'tel',
        autoComplete: 'tel-national',
    },
    {
        field: 'email',
        label: 'Email',
        placeholder: 'you@example.com',
        type: 'email',
        inputMode: 'email',
        autoComplete: 'email',
    },
];

function formatDigitsInput(field: keyof GuestValues, value: string): string {
    const isAadhaar = field === 'aadhaar';
    const allDigits = value.replace(/\D/g, '');
    const localDigits = isAadhaar ? allDigits : allDigits.replace(/^(91|0)(?=\d{10}$)/, '');
    const digits = localDigits.slice(0, isAadhaar ? AADHAAR_LENGTH : PHONE_LENGTH);

    return groupCharacters(digits, isAadhaar ? AADHAAR_GROUP_SIZE : PHONE_GROUP_SIZES);
}

function GuestPhoto({
    control,
    guestIndex,
    errorMessage,
}: {
    control: Control<BookingDetailsValues>;
    guestIndex: number;
    errorMessage?: string;
}) {
    const [aadhaar, name] = useWatch({
        control,
        name: [`guests.${guestIndex}.aadhaar`, `guests.${guestIndex}.name`],
    });

    const isReady =
        z.safeParse(guestInputSchema.shape.aadhaar, aadhaar).success &&
        z.safeParse(guestInputSchema.shape.name, name).success;

    return (
        <Controller
            control={control}
            name={`guests.${guestIndex}.photoId`}
            render={({ field }) => (
                <AadhaarPhotoField
                    key={`${aadhaar}|${name}`}
                    aadhaar={aadhaar}
                    name={name}
                    isReady={isReady}
                    photoId={field.value}
                    errorMessage={errorMessage}
                    onChange={field.onChange}
                />
            )}
        />
    );
}

export function GuestFields({
    control,
    register,
    setValue,
    errors,
    maxGuestsPerBooking,
}: {
    control: Control<BookingDetailsValues>;
    register: UseFormRegister<BookingDetailsValues>;
    setValue: UseFormSetValue<BookingDetailsValues>;
    errors: FieldErrors<BookingDetailsValues>;
    maxGuestsPerBooking: number;
}) {
    const fieldIdPrefix = useId();
    const { fields, append, remove } = useFieldArray({ control, name: 'guests' });
    const prefersReducedMotion = useReducedMotion();

    const expandTransition = prefersReducedMotion
        ? { duration: 0 }
        : { duration: DURATION.base, ease: EASE_OUT };

    const guestErrorsRoot = errors.guests?.root?.message ?? errors.guests?.message;

    return (
        <div className="guest-fields">
            <AnimatePresence initial={false}>
                {fields.map((guestField, guestIndex) => {
                    const guestErrors = errors.guests?.[guestIndex];
                    const guestNumber = guestIndex + 1;

                    return (
                        <m.div
                            key={guestField.id}
                            className="guest-fields-guest"
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            transition={expandTransition}
                        >
                            <div className="guest-fields-body">
                                <Separator />

                                <div className="guest-fields-header">
                                    <h3 className="guest-fields-title">Guest {guestNumber}</h3>
                                    {guestIndex === 0 ? (
                                        <Badge variant="outline">Receives the QR</Badge>
                                    ) : (
                                        <Button
                                            variant="ghost"
                                            size="icon-sm"
                                            aria-label={`Remove guest ${guestNumber}`}
                                            onClick={() => remove(guestIndex)}
                                        >
                                            <XIcon />
                                        </Button>
                                    )}
                                </div>

                                <div className="guest-fields-grid">
                                    {GUEST_INPUTS.map((input) => {
                                        const inputId = `${fieldIdPrefix}-guest-${guestIndex}-${input.field}`;
                                        const errorId = `${inputId}-error`;
                                        const message = guestErrors?.[input.field]?.message;
                                        const path = `guests.${guestIndex}.${input.field}` as const;
                                        const sharedProps = {
                                            id: inputId,
                                            type: input.type,
                                            placeholder: input.placeholder,
                                            inputMode: input.inputMode,
                                            autoComplete: input.autoComplete,
                                            'aria-invalid': message ? true : undefined,
                                            'aria-describedby': message ? errorId : undefined,
                                        };

                                        return (
                                            <div key={input.field} className="guest-fields-field">
                                                <Label htmlFor={inputId}>{input.label}</Label>

                                                {input.field === 'aadhaar' ||
                                                input.field === 'phone' ? (
                                                    <Controller
                                                        control={control}
                                                        name={path}
                                                        render={({ field }) => (
                                                            <Input
                                                                {...sharedProps}
                                                                ref={field.ref}
                                                                name={field.name}
                                                                value={field.value}
                                                                onBlur={field.onBlur}
                                                                onChange={(event) => {
                                                                    const value = formatDigitsInput(
                                                                        input.field,
                                                                        event.target.value,
                                                                    );

                                                                    if (
                                                                        input.field === 'aadhaar' &&
                                                                        value !== field.value
                                                                    ) {
                                                                        setValue(
                                                                            `guests.${guestIndex}.photoId`,
                                                                            '',
                                                                        );
                                                                    }

                                                                    field.onChange(value);
                                                                }}
                                                            />
                                                        )}
                                                    />
                                                ) : (
                                                    <Input
                                                        {...sharedProps}
                                                        {...register(
                                                            path,
                                                            input.field === 'name'
                                                                ? {
                                                                      onChange: () =>
                                                                          setValue(
                                                                              `guests.${guestIndex}.photoId`,
                                                                              '',
                                                                          ),
                                                                  }
                                                                : undefined,
                                                        )}
                                                    />
                                                )}

                                                <FieldError id={errorId} message={message} />
                                            </div>
                                        );
                                    })}
                                </div>

                                <GuestPhoto
                                    control={control}
                                    guestIndex={guestIndex}
                                    errorMessage={guestErrors?.photoId?.message}
                                />
                            </div>
                        </m.div>
                    );
                })}
            </AnimatePresence>

            <FieldError id="guests-error" message={guestErrorsRoot} />

            <AnimatePresence initial={false}>
                {fields.length < maxGuestsPerBooking && (
                    <m.div
                        key="add-guest"
                        className="guest-fields-add"
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={expandTransition}
                    >
                        <Button
                            variant="outline"
                            className="guest-fields-add-button"
                            onClick={() => append({ ...EMPTY_GUEST })}
                        >
                            <PlusIcon />
                            Add guest
                        </Button>
                    </m.div>
                )}
            </AnimatePresence>
        </div>
    );
}
