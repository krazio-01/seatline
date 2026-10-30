'use client';
import { useCallback, useEffect, useRef, useState, type Ref } from 'react';
import dynamic from 'next/dynamic';
import { ChevronsUpDownIcon } from 'lucide-react';
import './studentSelect.scss';
import { Hotkey } from '@/components/ui/Hotkey/Hotkey';
import type { StudentsState } from '@/components/dialogs/StudentPicker/StudentPicker';
import { api } from '@/services/client/api';
import type { StudentOption } from '@/types/booking';

const StudentPicker = dynamic(
    () =>
        import('@/components/dialogs/StudentPicker/StudentPicker').then(
            (module) => module.StudentPicker,
        ),
    { ssr: false },
);

export function StudentSelect({
    ref,
    id,
    value,
    onChange,
    invalid = false,
    describedBy,
}: {
    ref?: Ref<HTMLButtonElement>;
    id: string;
    value: StudentOption | null;
    onChange: (student: StudentOption) => void;
    invalid?: boolean;
    describedBy?: string;
}) {
    const [isOpen, setIsOpen] = useState(false);
    const [shouldMountDialog, setShouldMountDialog] = useState(false);
    const [studentsState, setStudentsState] = useState<StudentsState>({ status: 'loading' });

    const loadStudents = useCallback(() => {
        api.students.listAvailable().then(
            (students) => setStudentsState({ status: 'ready', students }),
            (error: Error) => setStudentsState({ status: 'failed', message: error.message }),
        );
    }, []);

    const hasRequestedStudentsRef = useRef(false);

    const requestStudents = useCallback(() => {
        setShouldMountDialog(true);

        if (hasRequestedStudentsRef.current) return;

        hasRequestedStudentsRef.current = true;
        loadStudents();
    }, [loadStudents]);

    const openMenu = useCallback(() => {
        requestStudents();
        setIsOpen(true);
    }, [requestStudents]);

    useEffect(() => {
        if (!('requestIdleCallback' in window)) return;

        const handle = requestIdleCallback(() => setShouldMountDialog(true));

        return () => cancelIdleCallback(handle);
    }, []);

    useEffect(() => {
        const openOnShortcut = (event: KeyboardEvent) => {
            if (!(event.metaKey || event.ctrlKey) || event.key?.toLowerCase() !== 'k') return;

            event.preventDefault();
            openMenu();
        };

        document.addEventListener('keydown', openOnShortcut);

        return () => document.removeEventListener('keydown', openOnShortcut);
    }, [openMenu]);

    return (
        <>
            <button
                ref={ref}
                id={id}
                type="button"
                className="student-select"
                aria-haspopup="dialog"
                aria-expanded={isOpen}
                data-invalid={invalid || undefined}
                aria-describedby={describedBy}
                onPointerEnter={requestStudents}
                onFocus={requestStudents}
                onClick={openMenu}
            >
                {value ? (
                    <span className="student-select-value">
                        {value.name}
                        <span className="student-select-meta">Group {value.group}</span>
                    </span>
                ) : (
                    <span className="student-select-placeholder">Select the student…</span>
                )}
                <Hotkey className="student-select-hotkey">⌘K</Hotkey>
                <ChevronsUpDownIcon className="student-select-chevron" aria-hidden="true" />
            </button>

            {shouldMountDialog && (
                <StudentPicker
                    isOpen={isOpen}
                    onOpenChange={setIsOpen}
                    studentsState={studentsState}
                    selectedStudentId={value?.id}
                    onRetry={() => {
                        setStudentsState({ status: 'loading' });
                        loadStudents();
                    }}
                    onChoose={(student) => {
                        onChange(student);
                        setIsOpen(false);
                    }}
                />
            )}
        </>
    );
}
