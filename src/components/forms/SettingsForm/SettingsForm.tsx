'use client';
import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import './settingsForm.scss';
import { Form, FormField, FormSubmit, readTextFields } from '@/components/forms/Form/Form';
import { Alert, AlertDescription } from '@/components/ui/Alert/Alert';
import { Switch } from '@/components/ui/Switch/Switch';
import { useToast } from '@/components/ui/Toast/Toast';
import { useRefreshSlice } from '@/context/appContext';
import { ApiError, api, fieldErrorsOf } from '@/services/client/api';
import type { EventSettings } from '@/types/admin';
import { EVENT_ZONES, ZONE_LABELS, type ZoneName } from '@/types/booking';
import { fromDateTimeInputValue, toDateTimeInputValue } from '@/utils/dates';

type ZoneField = `zoneCapacities.${ZoneName}`;

type SettingsField =
    'eventName' | 'eventDate' | 'gatesOpenAt' | 'venue' | ZoneField | 'maxGuestsPerBooking';

type FieldKind = 'text' | 'dateTime' | 'number';

type FieldConfig = {
    name: SettingsField;
    label: string;
    kind: FieldKind;
    hint?: string;
    min?: number;
};

const FIELD_SECTIONS: { title: string; columns: number; fields: FieldConfig[] }[] = [
    {
        title: 'Event',
        columns: 2,
        fields: [
            { name: 'eventName', label: 'Event name', kind: 'text' },
            { name: 'venue', label: 'Venue', kind: 'text' },
            { name: 'eventDate', label: 'Event date and time', kind: 'dateTime' },
            {
                name: 'gatesOpenAt',
                label: 'Gates open',
                kind: 'dateTime',
                hint: 'On or before the event starts.',
            },
        ],
    },
    {
        title: 'Seating',
        columns: 3,
        fields: [
            ...EVENT_ZONES.map((zone): FieldConfig => ({
                name: zoneField(zone),
                label: `${ZONE_LABELS[zone]} seats`,
                kind: 'number',
                hint: "Can't go below the seats already allocated in the zone.",
                min: 0,
            })),
            {
                name: 'maxGuestsPerBooking',
                label: 'Guest limit',
                kind: 'number',
                hint: 'Guests one student can bring.',
                min: 1,
            },
        ],
    },
];

const INPUT_TYPES: Record<FieldKind, string> = {
    text: 'text',
    dateTime: 'datetime-local',
    number: 'number',
};

const ALL_FIELDS = FIELD_SECTIONS.flatMap((section) => section.fields);

const ALL_FIELD_NAMES = ALL_FIELDS.map((field) => field.name);

function zoneField(zone: ZoneName): ZoneField {
    return `zoneCapacities.${zone}`;
}

function zoneInputValues(settings: EventSettings): Record<ZoneField, string> {
    return Object.fromEntries(
        EVENT_ZONES.map((zone) => [
            zoneField(zone),
            String(settings.zones.find((candidate) => candidate.name === zone)?.capacity ?? 0),
        ]),
    ) as Record<ZoneField, string>;
}

function toInputValues(settings: EventSettings): Record<SettingsField, string> {
    return {
        eventName: settings.eventName,
        eventDate: toDateTimeInputValue(new Date(settings.eventDate)),
        gatesOpenAt: toDateTimeInputValue(new Date(settings.gatesOpenAt)),
        venue: settings.venue,
        ...zoneInputValues(settings),
        maxGuestsPerBooking: String(settings.maxGuestsPerBooking),
    };
}

function checkField(field: FieldConfig, value: string): string | undefined {
    if (!value.trim()) return field.kind === 'dateTime' ? 'Choose a date and time' : 'Required';

    if (field.kind === 'number' && !Number.isInteger(Number(value))) return 'Enter a whole number';

    return undefined;
}

export function SettingsForm({ settings }: { settings: EventSettings }) {
    const router = useRouter();
    const fieldId = useId();
    const refreshSlice = useRefreshSlice();
    const { toast } = useToast();
    const initialValues = toInputValues(settings);
    const [fieldErrors, setFieldErrors] = useState<Partial<Record<SettingsField, string>>>({});
    const [formError, setFormError] = useState<string>();
    const [isSaving, setIsSaving] = useState(false);

    const bookingsOpenId = `${fieldId}-bookings-open`;

    const save = async (formData: FormData) => {
        const values = readTextFields(formData, ALL_FIELD_NAMES);

        const clientErrors = Object.fromEntries(
            ALL_FIELDS.map((field) => [field.name, checkField(field, values[field.name])]).filter(
                ([, message]) => message,
            ),
        );

        setFieldErrors(clientErrors);
        setFormError(undefined);

        if (Object.keys(clientErrors).length > 0) return;

        setIsSaving(true);

        try {
            await api.settings.update({
                eventName: values.eventName,
                eventDate: fromDateTimeInputValue(values.eventDate).toISOString(),
                gatesOpenAt: fromDateTimeInputValue(values.gatesOpenAt).toISOString(),
                venue: values.venue,
                zoneCapacities: Object.fromEntries(
                    EVENT_ZONES.map((zone) => [zone, Number(values[zoneField(zone)])]),
                ) as Record<ZoneName, number>,
                maxGuestsPerBooking: Number(values.maxGuestsPerBooking),
                bookingsOpen: formData.get('bookingsOpen') === 'on',
            });

            toast({ title: 'Settings saved', tone: 'success' });
            router.refresh();
            refreshSlice('dashboard');
        } catch (error) {
            if (!(error instanceof ApiError)) throw error;

            const serverErrors = fieldErrorsOf(error);

            setFieldErrors(serverErrors);
            setFormError(
                serverErrors.zoneCapacities ??
                    (Object.keys(serverErrors).length ? undefined : error.message),
            );
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <Form className="settings-form" onValues={save}>
            {FIELD_SECTIONS.map((section) => (
                <fieldset key={section.title} className="settings-form-section">
                    <legend className="settings-form-legend">{section.title}</legend>

                    <div className="settings-form-grid" data-columns={section.columns}>
                        {section.fields.map((field) => (
                            <FormField
                                key={field.name}
                                name={field.name}
                                label={field.label}
                                hint={field.hint}
                                error={fieldErrors[field.name]}
                                type={INPUT_TYPES[field.kind]}
                                min={field.min}
                                inputMode={field.kind === 'number' ? 'numeric' : undefined}
                                defaultValue={initialValues[field.name]}
                            />
                        ))}
                    </div>
                </fieldset>
            ))}

            <fieldset className="settings-form-section">
                <legend className="settings-form-legend">Bookings</legend>

                <div className="settings-form-toggle">
                    <div>
                        <span id={`${bookingsOpenId}-label`} className="settings-form-toggle-label">
                            Bookings open
                        </span>
                        <p id={`${bookingsOpenId}-hint`} className="settings-form-hint">
                            {settings.allocatedSeats} of {settings.totalSeats} seats allocated.
                            Close bookings to stop new registrations.
                        </p>
                    </div>
                    <Switch
                        name="bookingsOpen"
                        defaultChecked={settings.bookingsOpen}
                        aria-labelledby={`${bookingsOpenId}-label`}
                        aria-describedby={`${bookingsOpenId}-hint`}
                    />
                </div>
            </fieldset>

            {formError && (
                <Alert variant="destructive">
                    <AlertDescription>{formError}</AlertDescription>
                </Alert>
            )}

            <div className="settings-form-footer">
                <FormSubmit loading={isSaving}>Save settings</FormSubmit>
            </div>
        </Form>
    );
}
