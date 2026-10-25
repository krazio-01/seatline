import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { LoginForm } from '@/components/forms/LoginForm/LoginForm';
import { SCANNER_HREF } from '@/components/layout/navigation';
import { DotTerrain } from '@/components/scenes/DotTerrain/DotTerrain';
import { MotionProvider } from '@/components/ui/Animations/ClientAnimations';
import { Reveal } from '@/components/ui/Animations/Animations';
import { AppProvider } from '@/context/appContext';
import { INITIAL_SIGN_IN } from '@/context/appStore';
import { CHECKER_SESSION_SECONDS } from '@/lib/security/tokens';
import { getCheckerSession } from '@/services/server/auth';
import { findEventSettings } from '@/services/server/settings';

export const metadata: Metadata = { title: 'Scanner sign in' };

export default async function Page() {
    const session = await getCheckerSession();

    if (session) redirect(SCANNER_HREF);

    const settings = await findEventSettings();

    return (
        <AppProvider initialState={{ signIn: INITIAL_SIGN_IN }}>
            <MotionProvider>
                <main>
                    <DotTerrain isFullScreen>
                        <Reveal>
                            <LoginForm
                                role="checker"
                                redirectTo={SCANNER_HREF}
                                sessionSeconds={CHECKER_SESSION_SECONDS}
                                eventName={settings?.eventName}
                            />
                        </Reveal>
                    </DotTerrain>
                </main>
            </MotionProvider>
        </AppProvider>
    );
}
