'use client';
import { useId, useState, type DragEvent } from 'react';
import { CircleAlertIcon, FileTextIcon, UploadIcon } from 'lucide-react';
import './studentImport.scss';
import { FieldError } from '@/components/forms/FieldError/FieldError';
import { Form, FormSubmit } from '@/components/forms/Form/Form';
import { Stagger } from '@/components/ui/Animations/Animations';
import { Progress } from '@/components/ui/Progress/Progress';
import { useToast } from '@/components/ui/Toast/Toast';
import { StatTiles } from '@/components/widgets/StatTiles/StatTiles';
import { useRefreshSlice } from '@/context/appContext';
import { ApiError, api, fieldErrorsOf } from '@/services/client/api';
import type { ImportResult } from '@/types/admin';
import { APP_LOCALE } from '@/utils/dates';
import { pluralize } from '@/utils/text';

type ImportStage = 'idle' | 'reading' | 'uploading' | 'done';

type ImportLimits = { maxRows: number; maxCsvLength: number };

const BYTES_PER_MEGABYTE = 1_000_000;

const STAGE_PROGRESS: Record<ImportStage, number> = {
    idle: 0,
    reading: 25,
    uploading: 70,
    done: 100,
};

const STAGE_LABELS: Record<ImportStage, string> = {
    idle: '',
    reading: 'Reading the file…',
    uploading: 'Importing students…',
    done: 'Import finished',
};

function checkFile(file: File, maxBytes: number): string | undefined {
    if (!/\.csv$/i.test(file.name)) return 'Choose a .csv file.';

    if (file.size > maxBytes) {
        return `The file is larger than ${maxBytes / BYTES_PER_MEGABYTE} MB. Split it and import each part.`;
    }

    if (file.size === 0) return 'The file is empty.';

    return undefined;
}

function importErrorMessage(error: unknown): string {
    if (!(error instanceof ApiError)) throw error;

    return fieldErrorsOf(error).csv ?? error.message;
}

export function StudentImport({ limits }: { limits: ImportLimits }) {
    const inputId = useId();
    const { toast } = useToast();
    const refreshSlice = useRefreshSlice();
    const [file, setFile] = useState<File | null>(null);
    const [stage, setStage] = useState<ImportStage>('idle');
    const [result, setResult] = useState<ImportResult | null>(null);
    const [errorMessage, setErrorMessage] = useState<string>();
    const [isDragging, setIsDragging] = useState(false);

    const isBusy = stage === 'reading' || stage === 'uploading';
    const errorId = `${inputId}-error`;

    const chooseFile = (nextFile: File | undefined) => {
        if (!nextFile) return;

        setFile(nextFile);
        setResult(null);
        setStage('idle');
        setErrorMessage(checkFile(nextFile, limits.maxCsvLength));
    };

    const handleDrop = (event: DragEvent<HTMLLabelElement>) => {
        event.preventDefault();
        setIsDragging(false);
        chooseFile(event.dataTransfer.files[0]);
    };

    const importFile = async () => {
        if (!file) {
            setErrorMessage('Choose a CSV file first.');
            return;
        }

        if (checkFile(file, limits.maxCsvLength) || isBusy) return;

        setErrorMessage(undefined);
        setResult(null);
        setStage('reading');

        try {
            const csv = await file.text();

            setStage('uploading');

            const imported = await api.students.import(csv);

            setResult(imported);
            setStage('done');
            refreshSlice('dashboard');
            toast({
                title: 'Students imported',
                description: `${imported.inserted} added, ${imported.skipped} already listed.`,
                tone: 'success',
            });
        } catch (error) {
            setStage('idle');
            setErrorMessage(importErrorMessage(error));
        }
    };

    return (
        <Form className="student-import" onValues={importFile}>
            <label
                htmlFor={inputId}
                className="student-import-drop-zone"
                data-dragging={isDragging || undefined}
                data-invalid={errorMessage ? true : undefined}
                onDragOver={(event) => {
                    event.preventDefault();
                    setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
            >
                <span className="student-import-icon" aria-hidden="true">
                    {file ? <FileTextIcon /> : <UploadIcon />}
                </span>
                <span className="student-import-prompt">
                    {file ? (
                        <span className="student-import-file-name">{file.name}</span>
                    ) : (
                        <>
                            <strong>Drop a CSV file here</strong> or click to choose one
                        </>
                    )}
                </span>
                <span className="student-import-hint">
                    Columns: name, group, id number. Up to{' '}
                    {limits.maxRows.toLocaleString(APP_LOCALE)} rows and{' '}
                    {limits.maxCsvLength / BYTES_PER_MEGABYTE} MB.
                </span>
                <input
                    id={inputId}
                    type="file"
                    accept=".csv,text/csv"
                    aria-label="CSV file"
                    aria-invalid={errorMessage ? true : undefined}
                    aria-describedby={errorMessage ? errorId : undefined}
                    className="visually-hidden"
                    disabled={isBusy}
                    onChange={(event) => {
                        chooseFile(event.target.files?.[0]);
                        event.target.value = '';
                    }}
                />
            </label>

            <FieldError id={errorId} message={errorMessage} />

            <div className="student-import-actions">
                <FormSubmit loading={isBusy} disabled={!file}>
                    Import CSV
                </FormSubmit>

                {stage !== 'idle' && (
                    <div className="student-import-progress" role="status">
                        <Progress value={STAGE_PROGRESS[stage]} aria-label="Import progress" />
                        <span className="student-import-stage">{STAGE_LABELS[stage]}</span>
                    </div>
                )}
            </div>

            {result && (
                <Stagger className="student-import-result">
                    <StatTiles
                        tiles={[
                            {
                                label: 'Added',
                                value: <span data-stat="inserted">{result.inserted}</span>,
                            },
                            {
                                label: 'Already listed',
                                value: <span data-stat="skipped">{result.skipped}</span>,
                            },
                            {
                                label: 'Rows with errors',
                                value: <span data-stat="errors">{result.errors.length}</span>,
                            },
                        ]}
                    />

                    {result.errors.length > 0 && (
                        <div className="student-import-errors">
                            <p className="student-import-errors-title">
                                <CircleAlertIcon aria-hidden="true" />
                                {result.errors.length}{' '}
                                {pluralize(result.errors.length, 'row was', 'rows were')} not
                                imported
                            </p>
                            <ul className="student-import-error-list">
                                {result.errors.map((error) => (
                                    <li key={error.line}>
                                        <span className="student-import-line">
                                            Line {error.line}
                                        </span>
                                        {error.reason}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </Stagger>
            )}
        </Form>
    );
}
