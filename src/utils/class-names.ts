export type WithStringClassName<Props> = Omit<Props, 'className'> & { className?: string };

export function classNames(...classes: Array<string | false | null | undefined>): string {
    return classes.filter(Boolean).join(' ');
}
