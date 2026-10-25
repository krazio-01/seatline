'use client';
import { useEffect, useState } from 'react';
import './studentPicker.scss';
import {
    Command,
    CommandDialog,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from '@/components/ui/CommandMenu/CommandMenu';
import { Button } from '@/components/ui/Button/Button';
import { EmptyState } from '@/components/ui/EmptyState/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton/Skeleton';
import type { StudentOption } from '@/types/booking';

export type StudentsState =
    | { status: 'loading' }
    | { status: 'ready'; students: StudentOption[] }
    | { status: 'failed'; message: string };

export function StudentPicker({
    isOpen,
    onOpenChange,
    studentsState,
    selectedStudentId,
    onRetry,
    onChoose,
}: {
    isOpen: boolean;
    onOpenChange: (isOpen: boolean) => void;
    studentsState: StudentsState;
    selectedStudentId?: string;
    onRetry: () => void;
    onChoose: (student: StudentOption) => void;
}) {
    const [hasMounted, setHasMounted] = useState(false);

    useEffect(() => {
        const frame = requestAnimationFrame(() => setHasMounted(true));

        return () => cancelAnimationFrame(frame);
    }, []);

    return (
        <CommandDialog
            className="student-picker"
            open={isOpen && hasMounted}
            onOpenChange={onOpenChange}
            title="Select the student"
            description="Search by name, group or ID number."
        >
            <Command>
                <CommandInput placeholder="Search by name, group or ID number" />
                <CommandList>
                    {studentsState.status === 'loading' && (
                        <div className="student-picker-loading" aria-label="Loading students">
                            <Skeleton height={32} />
                            <Skeleton height={32} />
                            <Skeleton height={32} />
                        </div>
                    )}

                    {studentsState.status === 'failed' && (
                        <div className="student-picker-failure">
                            <p>{studentsState.message}</p>
                            <Button variant="outline" size="sm" onClick={onRetry}>
                                Try again
                            </Button>
                        </div>
                    )}

                    {studentsState.status === 'ready' && (
                        <>
                            <CommandEmpty>
                                <EmptyState
                                    size="compact"
                                    title="No student found"
                                    description="Check the spelling, or search by group or ID number."
                                    preview={{
                                        name: 'students',
                                        status: 'search',
                                        message: 'no matches',
                                    }}
                                />
                            </CommandEmpty>
                            <CommandGroup heading="Students">
                                {studentsState.students.map((student) => (
                                    <CommandItem
                                        key={student.id}
                                        value={`${student.name} ${student.group} ${student.id}`}
                                        data-checked={selectedStudentId === student.id}
                                        onSelect={() => onChoose(student)}
                                    >
                                        <span className="student-picker-option">
                                            {student.name}
                                            <span className="student-picker-meta">
                                                Group {student.group}
                                            </span>
                                        </span>
                                    </CommandItem>
                                ))}
                            </CommandGroup>
                        </>
                    )}
                </CommandList>
            </Command>
        </CommandDialog>
    );
}
