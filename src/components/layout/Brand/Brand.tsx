import Image from 'next/image';
import './brand.scss';
import { classNames } from '@/utils/class-names';

const CREST = { src: '/images/crest.webp', width: 237, height: 256 };

export function Brand({
    name,
    subtitle,
    isCompact = false,
    className,
}: {
    name: string;
    subtitle?: string;
    isCompact?: boolean;
    className?: string;
}) {
    return (
        <span className={classNames('brand', className)}>
            <Image
                className="brand-crest"
                src={CREST.src}
                width={CREST.width}
                height={CREST.height}
                loading="eager"
                alt=""
            />
            <span className={classNames('brand-text', isCompact && 'visually-hidden')}>
                <span className="brand-name">{name}</span>
                {subtitle && <small className="brand-subtitle">{subtitle}</small>}
            </span>
        </span>
    );
}
