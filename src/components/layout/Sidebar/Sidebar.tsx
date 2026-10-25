'use client';
import { useId } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { m, useReducedMotion } from 'motion/react';
import './sidebar.scss';
import { SignOutButton } from '@/components/layout/Header/SignOutButton';
import { useAppContext } from '@/context/appContext';
import { DURATION, EASE_OUT } from '@/utils/motion';
import {
    ADMIN_NAVIGATION,
    ADMIN_ROOT_HREF,
    ADMIN_SIGN_IN_HREF,
    matchesPath,
} from '@/components/layout/navigation';
import { initials } from '@/utils/text';

export function Sidebar({ subtitle, userName }: { subtitle: string; userName: string }) {
    const pathname = usePathname();
    const prefersReducedMotion = useReducedMotion();
    const highlightId = useId();
    const { event, stats } = useAppContext('dashboard');

    return (
        <aside className="sidebar">
            <div className="sidebar-brand">
                <span className="sidebar-brand-mark" aria-hidden="true">
                    {event.eventName.charAt(0)}
                </span>
                <span className="sidebar-brand-text">
                    {event.eventName}
                    <small className="sidebar-brand-subtitle">{subtitle}</small>
                </span>
            </div>

            <div className="sidebar-nav">
                {ADMIN_NAVIGATION.map((group) => (
                    <nav key={group.label} className="sidebar-group" aria-label={group.label}>
                        <span className="sidebar-group-label">{group.label}</span>
                        <ul className="sidebar-links">
                            {group.items.map((item) => {
                                const isActive = matchesPath(pathname, item.href, {
                                    exact: item.href === ADMIN_ROOT_HREF,
                                });

                                return (
                                    <li key={item.href}>
                                        <Link
                                            href={item.href}
                                            className="sidebar-link"
                                            aria-current={isActive ? 'page' : undefined}
                                        >
                                            {isActive && (
                                                <m.span
                                                    layoutId={highlightId}
                                                    className="sidebar-highlight"
                                                    transition={{
                                                        duration: prefersReducedMotion
                                                            ? 0
                                                            : DURATION.base,
                                                        ease: EASE_OUT,
                                                    }}
                                                />
                                            )}
                                            <span className="sidebar-link-icon" aria-hidden="true">
                                                <item.icon />
                                            </span>
                                            <span className="sidebar-link-label">{item.label}</span>
                                            {item.countStat && (
                                                <span className="sidebar-link-count">
                                                    {stats[item.countStat]}
                                                </span>
                                            )}
                                        </Link>
                                    </li>
                                );
                            })}
                        </ul>
                    </nav>
                ))}
            </div>

            <div className="sidebar-footer">
                <span className="sidebar-avatar" aria-hidden="true">
                    {initials(userName)}
                </span>
                <span className="sidebar-user">
                    {userName}
                    <small className="sidebar-user-role">Admin</small>
                </span>
                <SignOutButton role="admin" redirectTo={ADMIN_SIGN_IN_HREF} display="icon" />
            </div>
        </aside>
    );
}
