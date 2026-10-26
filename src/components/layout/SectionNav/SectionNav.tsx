'use client';
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { ArrowRightIcon } from 'lucide-react';
import './sectionNav.scss';

type NavItem = { href: string; label: string };

type NavAction = { href: string | null; label: string };

type MenuState = 'unopened' | 'open' | 'closed';

type GlowTarget = { link: HTMLElement | null; mode: 'hover' | 'active' };

const HIDE_AFTER_VIEWPORTS = 0.8;
const LIGHT_AFTER_VIEWPORTS = 0.75;
const SCROLL_STEP_PX = 8;
const SPY_MARGIN = '-45% 0px -50% 0px';
const MAGNET_PX = 6;

function RollingLabel({ text }: { text: string }) {
    const letters = [...text];

    return (
        <span className="section-nav-roll" aria-hidden="true">
            {[0, 1].map((copy) => (
                <span key={copy} className="section-nav-roll-line">
                    {letters.map((letter, index) => (
                        <span
                            key={index}
                            className="section-nav-roll-letter"
                            style={{ '--letter': index } as CSSProperties}
                        >
                            {letter === ' ' ? ' ' : letter}
                        </span>
                    ))}
                </span>
            ))}
        </span>
    );
}

function ActionContent({ label }: { label: string }) {
    return (
        <>
            <RollingLabel text={label} />
            <span className="section-nav-arrow" aria-hidden="true">
                <ArrowRightIcon />
                <ArrowRightIcon />
            </span>
        </>
    );
}

function followPointer(event: PointerEvent<HTMLElement>) {
    if (event.pointerType !== 'mouse') return;

    const target = event.currentTarget;
    const box = target.getBoundingClientRect();
    const x = (event.clientX - box.left) / box.width;
    const y = (event.clientY - box.top) / box.height;

    target.style.setProperty('--spot-x', `${(x * 100).toFixed(1)}%`);
    target.style.setProperty('--spot-y', `${(y * 100).toFixed(1)}%`);
    target.style.setProperty('--pull-x', `${((x - 0.5) * MAGNET_PX).toFixed(2)}px`);
    target.style.setProperty('--pull-y', `${((y - 0.5) * MAGNET_PX * 0.6).toFixed(2)}px`);
}

function releasePointer(event: PointerEvent<HTMLElement>) {
    for (const property of ['--spot-x', '--spot-y', '--pull-x', '--pull-y'])
        event.currentTarget.style.removeProperty(property);
}

function placeGlow(links: HTMLElement | null, { link, mode }: GlowTarget) {
    if (!links) return;

    if (!link) {
        delete links.dataset.glow;
        return;
    }

    links.style.setProperty('--glow-x', `${link.offsetLeft}px`);
    links.style.setProperty('--glow-width', `${link.offsetWidth}px`);
    links.dataset.glow = mode;
}

function currentLink(links: HTMLElement | null): HTMLElement | null {
    return links?.querySelector<HTMLElement>('[aria-current]') ?? null;
}

function NavActionButton({ action, size }: { action: NavAction; size: 'compact' | 'large' }) {
    if (!action.href) {
        return (
            <button type="button" className="section-nav-action" data-size={size} disabled>
                {action.label}
            </button>
        );
    }

    return (
        <Link
            href={action.href}
            className="section-nav-action"
            data-size={size}
            aria-label={action.label}
            onPointerMove={followPointer}
            onPointerLeave={releasePointer}
            data-call-to-action
        >
            <ActionContent label={action.label} />
        </Link>
    );
}

export function SectionNav({ items, action }: { items: NavItem[]; action: NavAction }) {
    const linksRef = useRef<HTMLDivElement>(null);
    const sheetRef = useRef<HTMLDivElement>(null);
    const menuButtonRef = useRef<HTMLButtonElement>(null);
    const pendingHashRef = useRef<string | null>(null);
    const glowTargetRef = useRef<GlowTarget>({ link: null, mode: 'active' });
    const [activeHref, setActiveHref] = useState<string | null>(null);
    const [menu, setMenu] = useState<MenuState>('unopened');
    const isMenuOpen = menu === 'open';

    const moveGlow = (target: GlowTarget) => {
        glowTargetRef.current = target;
        placeGlow(linksRef.current, target);
    };

    const restGlow = () => moveGlow({ link: currentLink(linksRef.current), mode: 'active' });

    useEffect(() => {
        const links = linksRef.current;
        if (glowTargetRef.current.mode === 'hover') return;

        glowTargetRef.current = { link: currentLink(links), mode: 'active' };
        placeGlow(links, glowTargetRef.current);
    }, [activeHref]);

    useEffect(() => {
        const links = linksRef.current;
        if (!links) return;

        const observer = new ResizeObserver(() => placeGlow(links, glowTargetRef.current));
        observer.observe(links);

        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        const hrefs = new Set(items.map((item) => item.href));
        const sections = document.querySelectorAll<HTMLElement>('main section[id]');
        const observer = new IntersectionObserver(
            (entries) => {
                for (const entry of entries) {
                    if (!entry.isIntersecting) continue;

                    const href = `#${entry.target.id}`;
                    setActiveHref(hrefs.has(href) ? href : null);
                }
            },
            { rootMargin: SPY_MARGIN },
        );

        for (const section of sections) observer.observe(section);

        return () => observer.disconnect();
    }, [items]);

    useEffect(() => {
        const root = document.documentElement;
        let lastY = scrollY;
        let frame = 0;

        const update = () => {
            frame = 0;
            root.toggleAttribute('data-nav-light', scrollY > innerHeight * LIGHT_AFTER_VIEWPORTS);

            const step = scrollY - lastY;
            if (Math.abs(step) < SCROLL_STEP_PX) return;

            root.toggleAttribute(
                'data-nav-hidden',
                step > 0 && scrollY > innerHeight * HIDE_AFTER_VIEWPORTS,
            );
            lastY = scrollY;
        };
        const onScroll = () => {
            if (!frame) frame = requestAnimationFrame(update);
        };

        update();
        addEventListener('scroll', onScroll, { passive: true });

        return () => {
            removeEventListener('scroll', onScroll);
            cancelAnimationFrame(frame);
            root.removeAttribute('data-nav-hidden');
            root.removeAttribute('data-nav-light');
        };
    }, []);

    useEffect(() => {
        if (menu !== 'open') return;

        const root = document.documentElement;
        const sheet = sheetRef.current;
        const menuButton = menuButtonRef.current;
        const previousOverflow = root.style.overflow;
        const backgroundElements = [...document.body.children].filter(
            (element) => element !== sheet && !element.hasAttribute('inert'),
        );

        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setMenu('closed');
        };

        root.style.overflow = 'hidden';
        for (const element of backgroundElements) element.setAttribute('inert', '');
        document.addEventListener('keydown', closeOnEscape);
        sheet?.querySelector<HTMLElement>('.section-nav-sheet-link')?.focus();

        return () => {
            root.style.overflow = previousOverflow;
            for (const element of backgroundElements) element.removeAttribute('inert');
            document.removeEventListener('keydown', closeOnEscape);

            const hash = pendingHashRef.current;
            pendingHashRef.current = null;
            const target = hash ? document.querySelector<HTMLElement>(hash) : null;
            if (!hash || !target) {
                menuButton?.focus({ preventScroll: true });
                return;
            }

            history.pushState(null, '', hash);
            if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
            target.focus({ preventScroll: true });
            target.scrollIntoView();
        };
    }, [menu]);

    const sheet =
        menu === 'unopened'
            ? null
            : createPortal(
                  <div
                      ref={sheetRef}
                      className="section-nav-sheet"
                      data-open={isMenuOpen ? '' : undefined}
                      role="dialog"
                      aria-modal="true"
                      aria-label="Sections"
                      inert={!isMenuOpen}
                  >
                      <div className="section-nav-sheet-top">
                          <span className="section-nav-sheet-title">Sections</span>
                          <button
                              type="button"
                              className="section-nav-menu-button"
                              data-open=""
                              aria-label="Close menu"
                              onClick={() => setMenu('closed')}
                          >
                              <span />
                              <span />
                          </button>
                      </div>

                      <ol className="section-nav-sheet-links">
                          {items.map((item, index) => (
                              <li key={item.href} style={{ '--item': index } as CSSProperties}>
                                  <a
                                      href={item.href}
                                      className="section-nav-sheet-link"
                                      aria-current={
                                          activeHref === item.href ? 'location' : undefined
                                      }
                                      onClick={(event) => {
                                          event.preventDefault();
                                          pendingHashRef.current = item.href;
                                          setMenu('closed');
                                      }}
                                  >
                                      <span className="section-nav-sheet-index">
                                          {String(index + 1).padStart(2, '0')}
                                      </span>
                                      <span className="section-nav-sheet-label">{item.label}</span>
                                  </a>
                              </li>
                          ))}
                      </ol>

                      <div className="section-nav-sheet-footer">
                          <NavActionButton action={action} size="large" />
                      </div>
                  </div>,
                  document.body,
              );

    return (
        <nav className="section-nav" aria-label="Sections">
            <div ref={linksRef} className="section-nav-links" onPointerLeave={restGlow}>
                <span className="section-nav-glow" aria-hidden="true" />
                {items.map((item) => (
                    <a
                        key={item.href}
                        href={item.href}
                        className="section-nav-link"
                        aria-label={item.label}
                        aria-current={activeHref === item.href ? 'location' : undefined}
                        onPointerEnter={(event) =>
                            moveGlow({ link: event.currentTarget, mode: 'hover' })
                        }
                        onFocus={(event) => moveGlow({ link: event.currentTarget, mode: 'hover' })}
                        onBlur={restGlow}
                    >
                        <RollingLabel text={item.label} />
                    </a>
                ))}
            </div>

            <button
                ref={menuButtonRef}
                type="button"
                className="section-nav-menu-button"
                aria-label="Open menu"
                aria-expanded={isMenuOpen}
                aria-haspopup="dialog"
                onClick={() => setMenu('open')}
            >
                <span />
                <span />
            </button>

            <NavActionButton action={action} size="compact" />
            {sheet}
        </nav>
    );
}
