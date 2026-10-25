'use client';
import { useState } from 'react';
import { LogOutIcon } from 'lucide-react';
import { Button } from '@/components/ui/Button/Button';
import { useToast } from '@/components/ui/Toast/Toast';
import { api } from '@/services/client/api';
import type { SessionRole } from '@/types/admin';

export function SignOutButton({
    role,
    redirectTo,
    display = 'labelled',
}: {
    role: SessionRole;
    redirectTo: string;
    display?: 'labelled' | 'icon';
}) {
    const { toast } = useToast();
    const [isSigningOut, setIsSigningOut] = useState(false);

    const signOut = async () => {
        setIsSigningOut(true);

        try {
            await api.sessions.delete(role);
            window.location.replace(redirectTo);
        } catch (error) {
            setIsSigningOut(false);
            toast({
                title: 'Sign out failed',
                description: (error as Error).message,
                tone: 'error',
            });
        }
    };

    if (display === 'icon') {
        return (
            <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Sign out"
                loading={isSigningOut}
                onClick={signOut}
            >
                <LogOutIcon />
            </Button>
        );
    }

    return (
        <Button variant="outline" size="sm" loading={isSigningOut} onClick={signOut}>
            <LogOutIcon aria-hidden="true" />
            Sign out
        </Button>
    );
}
