'use client';
import { useId, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import { LockKeyholeIcon, UserRoundIcon } from 'lucide-react';
import { useReducedMotion } from 'motion/react';
import './loginForm.scss';
import { Form, FormField, FormSubmit, readTextFields } from '@/components/forms/Form/Form';
import { Brand } from '@/components/layout/Brand/Brand';
import { Button } from '@/components/ui/Button/Button';
import { useAppContext, useUpdateAppContext } from '@/context/appContext';
import { advanceSignIn, type SignInEvent } from '@/context/appStore';
import { api } from '@/services/client/api';
import type { SessionRole } from '@/types/admin';
import { pluralize } from '@/utils/text';

type LoginField = 'username' | 'password';

type RoleCopy = { eyebrow: string; lede: string; opening: string };

const ROLE_COPY: Record<SessionRole, RoleCopy> = {
    admin: {
        eyebrow: 'Admin console',
        lede: 'Sign in to manage bookings, students and checkers.',
        opening: 'Opening the dashboard…',
    },
    checker: {
        eyebrow: 'Checker',
        lede: 'Sign in to scan guest passes at the gate.',
        opening: 'Opening the scanner…',
    },
};

const LOGIN_FIELD_NAMES: LoginField[] = ['username', 'password'];

const REQUIRED_MESSAGES: Record<LoginField, string> = {
    username: 'Enter your username',
    password: 'Enter your password',
};

const FALLBACK_EVENT_NAME = 'Event registration';
const SECONDS_PER_HOUR = 3600;
const SHAKE_KEYFRAMES = [0, -1, 3, -6, 6, -6, 6, -6, 3, -1, 0].map((offset) => ({
    transform: `translateX(${offset}px)`,
}));
const SHAKE_OPTIONS = { duration: 420, easing: 'cubic-bezier(0.36, 0.07, 0.19, 0.97)' };

export function LoginForm({
    role,
    redirectTo,
    sessionSeconds,
    eventName = FALLBACK_EVENT_NAME,
}: {
    role: SessionRole;
    redirectTo: string;
    sessionSeconds: number;
    eventName?: string;
}) {
    const router = useRouter();
    const prefersReducedMotion = useReducedMotion();
    const updateAppContext = useUpdateAppContext();
    const { phase } = useAppContext('signIn');
    const cardRef = useRef<HTMLFormElement>(null);
    const headingId = useId();
    const errorId = useId();
    const [fieldErrors, setFieldErrors] = useState<Partial<Record<LoginField, string>>>({});
    const [formError, setFormError] = useState('');
    const [isPasswordVisible, setIsPasswordVisible] = useState(false);
    const [isCapsLockOn, setIsCapsLockOn] = useState(false);

    const copy = ROLE_COPY[role];
    const sessionHours = Math.round(sessionSeconds / SECONDS_PER_HOUR);
    const isBusy = phase === 'submitting' || phase === 'succeeded';

    const report = (event: SignInEvent) =>
        updateAppContext('signIn', (current) => advanceSignIn(current, event));

    const shakeCard = () => {
        if (prefersReducedMotion) return;

        cardRef.current?.animate(SHAKE_KEYFRAMES, SHAKE_OPTIONS);
    };

    const reportBlur = (event: FocusEvent<HTMLFormElement>) => {
        if (event.currentTarget.contains(event.relatedTarget)) return;

        report('blur');
    };

    const readCapsLock = (event: KeyboardEvent<HTMLInputElement>) => {
        setIsCapsLockOn(event.getModifierState('CapsLock'));
    };

    const signIn = async (formData: FormData) => {
        const values = readTextFields(formData, LOGIN_FIELD_NAMES);
        const missing = LOGIN_FIELD_NAMES.filter((field) => !values[field].trim());

        setFormError('');
        setFieldErrors(
            Object.fromEntries(missing.map((field) => [field, REQUIRED_MESSAGES[field]])),
        );

        if (missing.length > 0) return;

        report('submit');

        try {
            await api.sessions.create(role, values.username.trim(), values.password);
        } catch (error) {
            setFormError((error as Error).message);
            report('fail');
            shakeCard();
            return;
        }

        report('succeed');
        router.replace(redirectTo);
    };

    return (
        <div className="login-form" data-phase={phase}>
            <Form
                ref={cardRef}
                className="login-form-card"
                aria-labelledby={headingId}
                aria-describedby={formError ? errorId : undefined}
                onValues={signIn}
                onFocus={() => report('focus')}
                onBlur={reportBlur}
                onInput={() => report('keystroke')}
            >
                <div className="login-form-brand">
                    <Brand name={eventName} isCompact className="login-form-crest" />
                    <p className="login-form-eyebrow">
                        {copy.eyebrow}
                        <strong className="login-form-event">{eventName}</strong>
                    </p>
                </div>

                <h1 id={headingId} className="login-form-title">
                    Welcome back
                </h1>
                <p className="login-form-lede">{copy.lede}</p>

                <div className="login-form-fields">
                    <FormField
                        name="username"
                        label="Username"
                        type="text"
                        autoComplete="username"
                        autoCapitalize="none"
                        spellCheck={false}
                        icon={<UserRoundIcon />}
                        error={fieldErrors.username}
                    />

                    <FormField
                        name="password"
                        label="Password"
                        hint="Case sensitive"
                        type={isPasswordVisible ? 'text' : 'password'}
                        autoComplete="current-password"
                        autoCapitalize="none"
                        spellCheck={false}
                        icon={<LockKeyholeIcon />}
                        error={fieldErrors.password}
                        onKeyDown={readCapsLock}
                        onKeyUp={readCapsLock}
                        adornment={
                            <Button
                                type="button"
                                variant="ghost"
                                size="xs"
                                className="login-form-reveal"
                                aria-pressed={isPasswordVisible}
                                onClick={() => setIsPasswordVisible((isVisible) => !isVisible)}
                            >
                                {isPasswordVisible ? 'Hide' : 'Show'}
                                <span className="visually-hidden"> password</span>
                            </Button>
                        }
                    />

                    <p
                        className="login-form-caps-lock"
                        data-visible={isCapsLockOn || undefined}
                        aria-live="polite"
                    >
                        <span className="login-form-caps-lock-text">
                            {isCapsLockOn ? 'Caps Lock is on' : ''}
                        </span>
                    </p>
                </div>

                <p
                    id={errorId}
                    className="login-form-error"
                    role="alert"
                    data-visible={formError ? true : undefined}
                >
                    <span className="login-form-error-text">{formError}</span>
                </p>

                <FormSubmit className="login-form-submit" size="lg" loading={isBusy}>
                    Sign in
                    <kbd className="login-form-submit-key" aria-hidden="true">
                        ↵
                    </kbd>
                </FormSubmit>

                <p className="login-form-footer">
                    <i className="login-form-footer-dot" aria-hidden="true" />
                    Secure session · signs out after {sessionHours}{' '}
                    {pluralize(sessionHours, 'hour')}
                </p>
            </Form>

            <p className="login-form-status" role="status">
                {phase === 'succeeded' ? copy.opening : ''}
            </p>
        </div>
    );
}
