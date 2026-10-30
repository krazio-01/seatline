'use client';
import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { SearchIcon } from 'lucide-react';
import './searchMenu.scss';
import { Hotkey } from '@/components/ui/Hotkey/Hotkey';
import { useClientValue } from '@/hooks/useHydrated';

const SearchDialog = dynamic(loadSearchDialog, { ssr: false });
const APPLE_PLATFORM_PATTERN = /mac|iphone|ipad/i;

function loadSearchDialog() {
    return import('@/components/menus/SearchMenu/SearchDialog').then(
        (module) => module.SearchDialog,
    );
}

function isApplePlatform(): boolean {
    const { userAgentData } = navigator as Navigator & { userAgentData?: { platform: string } };

    return APPLE_PLATFORM_PATTERN.test(userAgentData?.platform ?? navigator.platform);
}

export function SearchMenu({ placeholder }: { placeholder: string }) {
    const [isOpen, setIsOpen] = useState(false);
    const [hasOpened, setHasOpened] = useState(false);
    const isApple = useClientValue(isApplePlatform, true);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (!(event.metaKey || event.ctrlKey) || event.key?.toLowerCase() !== 'k') return;

            event.preventDefault();
            setHasOpened(true);
            setIsOpen((current) => !current);
        };

        document.addEventListener('keydown', handleKeyDown);

        return () => document.removeEventListener('keydown', handleKeyDown);
    }, []);

    const open = () => {
        setHasOpened(true);
        setIsOpen(true);
    };

    return (
        <>
            <button
                type="button"
                className="search-menu-trigger"
                aria-keyshortcuts="Meta+K Control+K"
                onClick={open}
                onPointerEnter={() => void loadSearchDialog()}
                onFocus={() => void loadSearchDialog()}
            >
                <SearchIcon aria-hidden="true" />
                <span className="search-menu-label">{placeholder}</span>
                <Hotkey>{isApple ? '⌘K' : 'Ctrl K'}</Hotkey>
            </button>

            {hasOpened && <SearchDialog open={isOpen} onOpenChange={setIsOpen} />}
        </>
    );
}
