import 'server-only';
import type { Types } from 'mongoose';
import Papa from 'papaparse';
import { z } from 'zod';
import { connectDb, pagingQueryFields, resolvePaging } from '@/lib/db';
import { ValidationError } from '@/lib/errors';
import { StudentModel, type StudentDocument } from '@/models';
import {
    MAX_IMPORT_ROWS,
    type ImportResult,
    type StudentListQuery,
    type StudentPage,
    type StudentRow,
} from '@/types/admin';
import { escapeRegex } from '@/utils/text';
import type { StudentOption } from '@/types/booking';

type AvailableStudentRow = Pick<StudentDocument, 'name' | 'group'> & {
    _id: Types.ObjectId;
};

type StudentRecord = Pick<StudentDocument, 'name' | 'group' | 'idNumber' | 'hasBooked'> & {
    _id: Types.ObjectId;
};

const MAX_REPORTED_ERRORS = 50;

const HEADER_ALIASES: Record<string, 'name' | 'group' | 'idNumber'> = {
    name: 'name',
    studentname: 'name',
    group: 'group',
    idnumber: 'idNumber',
    id: 'idNumber',
};

const STUDENT_SORT = { group: 1, name: 1, _id: 1 } as const;
const STUDENT_COLLATION = { locale: 'en', numericOrdering: true };

export const studentListQuerySchema: z.ZodType<StudentListQuery, unknown> = z.object({
    search: z.string().trim().max(100).optional(),
    booked: z.stringbool().optional(),
    ...pagingQueryFields,
});

function canonicalHeader(header: string): string {
    const normalized = header.toLowerCase().replace(/[^a-z]/g, '');
    return HEADER_ALIASES[normalized] ?? normalized;
}

export async function listAvailableStudents(): Promise<StudentOption[]> {
    await connectDb();

    const students = await StudentModel.find({ hasBooked: false }, 'name group', {
        sort: STUDENT_SORT,
        collation: STUDENT_COLLATION,
    }).lean<AvailableStudentRow[]>();

    return students.map((student) => ({
        id: String(student._id),
        name: student.name,
        group: student.group,
    }));
}

export async function listStudents(query: StudentListQuery): Promise<StudentPage> {
    await connectDb();

    const { page, pageSize, skip } = resolvePaging(query);
    const filter: Record<string, unknown> = {};
    if (query.booked !== undefined) filter.hasBooked = query.booked;

    const search = query.search?.trim();
    if (search) {
        const pattern = new RegExp(escapeRegex(search), 'i');
        filter.$or = [{ name: pattern }, { group: pattern }, { idNumber: pattern }];
    }

    const [students, total] = await Promise.all([
        StudentModel.find(filter, 'name group idNumber hasBooked', {
            sort: STUDENT_SORT,
            collation: STUDENT_COLLATION,
            skip,
            limit: pageSize,
        }).lean<StudentRecord[]>(),
        StudentModel.countDocuments(filter),
    ]);

    const items: StudentRow[] = students.map((student) => ({
        id: String(student._id),
        name: student.name,
        group: student.group,
        idNumber: student.idNumber,
        hasBooked: student.hasBooked,
    }));

    return { items, total, page, pageSize };
}

export async function importStudentsCsv(csvText: string): Promise<ImportResult> {
    await connectDb();

    const parsed = Papa.parse<Record<string, string | undefined>>(csvText.replace(/^﻿/, ''), {
        header: true,
        skipEmptyLines: false,
        transformHeader: canonicalHeader,
    });

    const quoteError = parsed.errors.find((error) => error.type === 'Quotes');
    if (quoteError) {
        throw new ValidationError([
            { path: 'csv', message: `Malformed quoting near line ${(quoteError.row ?? 0) + 1}` },
        ]);
    }

    const missingColumns = (['name', 'group', 'idNumber'] as const).filter(
        (column) => !parsed.meta.fields?.includes(column),
    );
    if (missingColumns.length > 0) {
        throw new ValidationError([
            { path: 'csv', message: 'The file needs the columns: name, group, id number' },
        ]);
    }

    if (parsed.data.length > MAX_IMPORT_ROWS) {
        throw new ValidationError([
            { path: 'csv', message: `Import at most ${MAX_IMPORT_ROWS} rows at a time` },
        ]);
    }

    const errors: ImportResult['errors'] = [];
    const operations: Parameters<typeof StudentModel.bulkWrite>[0] = [];
    parsed.data.forEach((row, index) => {
        if (Object.values(row).every((value) => (value ?? '').trim() === '')) return;

        const name = row.name?.trim() ?? '';
        const group = row.group?.trim() ?? '';
        const idNumber = row.idNumber?.trim() ?? '';
        const invalid =
            !name ||
            !group ||
            !idNumber ||
            name.length > 100 ||
            group.length > 40 ||
            idNumber.length > 40;

        if (invalid) {
            if (errors.length < MAX_REPORTED_ERRORS) {
                errors.push({ line: index + 2, reason: 'Name, group and ID number are required' });
            }

            return;
        }

        operations.push({
            updateOne: {
                filter: { group, idNumber },
                update: { $setOnInsert: { name, hasBooked: false } },
                upsert: true,
            },
        });
    });

    const inserted = operations.length
        ? (await StudentModel.bulkWrite(operations, { ordered: false })).upsertedCount
        : 0;

    return { inserted, skipped: operations.length - inserted, errors };
}
