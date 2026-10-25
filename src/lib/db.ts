import mongoose from 'mongoose';
import { z } from 'zod';
import { getEnv } from '@/lib/env';

type PagingLimits = { defaultPageSize: number; maxPageSize: number; maxPage: number };

const CONNECTION_OPTIONS = {
    maxPoolSize: 5,
    serverSelectionTimeoutMS: 5000,
    bufferCommands: false,
};

const DEFAULT_PAGING: PagingLimits = { defaultPageSize: 25, maxPageSize: 100, maxPage: 10000 };
const globalForMongoose = globalThis as { mongooseConnection?: Promise<typeof mongoose> };

const queryNumber = z.coerce.number().int();

export const pagingQueryFields = {
    page: queryNumber.min(1).optional(),
    pageSize: queryNumber.min(1).max(DEFAULT_PAGING.maxPageSize).optional(),
};

export async function connectDb(uri = getEnv().MONGODB_URI): Promise<typeof mongoose> {
    globalForMongoose.mongooseConnection ??= mongoose.connect(uri, CONNECTION_OPTIONS);

    try {
        return await globalForMongoose.mongooseConnection;
    } catch (error) {
        globalForMongoose.mongooseConnection = undefined;
        throw error;
    }
}

export async function disconnectDb(): Promise<void> {
    globalForMongoose.mongooseConnection = undefined;
    await mongoose.disconnect();
}

export function resolvePaging(
    query: { page?: number; pageSize?: number },
    { defaultPageSize, maxPageSize, maxPage }: PagingLimits = DEFAULT_PAGING,
): { page: number; pageSize: number; skip: number } {
    const requestedPage = Number.isFinite(query.page) ? Math.floor(query.page ?? 1) : 1;
    const requestedPageSize = Number.isFinite(query.pageSize)
        ? Math.floor(query.pageSize ?? defaultPageSize)
        : defaultPageSize;
    const page = Math.min(maxPage, Math.max(1, requestedPage));
    const pageSize = Math.min(maxPageSize, Math.max(1, requestedPageSize));

    return { page, pageSize, skip: (page - 1) * pageSize };
}
