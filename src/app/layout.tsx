import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.scss';
import { classNames } from '@/utils/class-names';

const geistSans = Geist({
    variable: '--font-geist-sans',
    subsets: ['latin'],
});

const geistMono = Geist_Mono({
    variable: '--font-geist-mono',
    subsets: ['latin'],
    preload: false,
});

export const metadata: Metadata = {
    title: 'Event Registration',
    description: 'Register for the event and receive your zone and QR code by email.',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
    return (
        <html lang="en" className={classNames(geistSans.variable, geistMono.variable)}>
            <body>{children}</body>
        </html>
    );
}
