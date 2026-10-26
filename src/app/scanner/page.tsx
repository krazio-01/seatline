import type { Metadata } from 'next';
import { CalendarX2Icon } from 'lucide-react';
import './page.scss';
import { Brand } from '@/components/layout/Brand/Brand';
import { Header } from '@/components/layout/Header/Header';
import { SignOutButton } from '@/components/layout/Header/SignOutButton';
import { SCANNER_SIGN_IN_HREF } from '@/components/layout/navigation';
import { Camera } from '@/components/media/Camera/Camera';
import { ToastProvider } from '@/components/ui/Toast/Toast';
import { GateProgress } from '@/components/widgets/GateProgress/GateProgress';
import { Notice } from '@/components/widgets/Notice/Notice';
import { ScanResult, ScanTally } from '@/components/widgets/ScanResult/ScanResult';
import { AppProvider } from '@/context/appContext';
import { INITIAL_SCANNER } from '@/context/appStore';
import { LiveSlices } from '@/context/liveSlices';
import { requireCheckerPage } from '@/services/server/auth';
import { findGateProgress } from '@/services/server/checkIns';
import { initials } from '@/utils/text';

export const metadata: Metadata = { title: 'Scanner' };

const GATE_PROGRESS_POLL_MS = 15000;

export default async function Page() {
    const session = await requireCheckerPage();

    const gateProgress = await findGateProgress();

    const header = (
        <Header
            className="scanner-header"
            start={
                <div className="scanner-checker">
                    <Brand name="Indian Air Force" isCompact className="scanner-crest" />
                    <span className="scanner-checker-avatar" aria-hidden="true">
                        {initials(session.name)}
                    </span>
                    <p className="scanner-checker-name">
                        {session.name}
                        <small className="scanner-checker-role">Checker</small>
                    </p>
                </div>
            }
            end={<SignOutButton role="checker" redirectTo={SCANNER_SIGN_IN_HREF} />}
        />
    );

    if (!gateProgress) {
        return (
            <ToastProvider>
                <AppProvider initialState={{}} signInPath={SCANNER_SIGN_IN_HREF}>
                    <div className="scanner">
                        {header}

                        <main className="scanner-unavailable">
                            <h1 className="visually-hidden">Scan guest passes</h1>
                            <Notice
                                icon={CalendarX2Icon}
                                title="The event is not set up yet"
                                description="Ask an admin to finish Settings, then reload this page."
                            />
                        </main>
                    </div>
                </AppProvider>
            </ToastProvider>
        );
    }

    return (
        <ToastProvider>
            <AppProvider
                initialState={{ scanner: INITIAL_SCANNER, gateProgress }}
                signInPath={SCANNER_SIGN_IN_HREF}
            >
                <LiveSlices slices={{ gateProgress: GATE_PROGRESS_POLL_MS }} />

                <div className="scanner">
                    {header}

                    <main className="scanner-main">
                        <h1 className="visually-hidden">Scan guest passes</h1>

                        <div className="scanner-progress">
                            <GateProgress />
                        </div>

                        <div className="scanner-camera">
                            <Camera />
                        </div>

                        <div className="scanner-side">
                            <ScanResult />
                            <ScanTally checkerId={session.userId} />
                        </div>
                    </main>
                </div>
            </AppProvider>
        </ToastProvider>
    );
}
