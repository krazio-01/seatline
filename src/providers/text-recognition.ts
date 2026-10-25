import 'server-only';
import { copyFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createWorker, OEM, type Worker } from 'tesseract.js';
import { ServiceBusyError } from '@/lib/errors';

export type RecognizedWord = {
    text: string;
    box: { x: number; y: number; width: number; height: number };
};

export type RecognitionLimits = { maxPending: number; timeoutMs: number };

export interface TextRecognizer {
    recognize(image: Buffer): Promise<RecognizedWord[]>;
    terminate(): Promise<void>;
}

const LANGUAGES = ['eng', 'hin'] as const;
const LANGUAGE_DATA_FOLDER = '4.0.0_best_int';
const LANGUAGE_DIRECTORY = path.join(tmpdir(), 'tesseract-language-data');

function languageFileName(language: (typeof LANGUAGES)[number]): string {
    return `${language}.traineddata.gz`;
}

async function prepareLanguageDirectory(): Promise<string> {
    await mkdir(LANGUAGE_DIRECTORY, { recursive: true });

    await Promise.all(
        LANGUAGES.map((language) =>
            copyFile(
                path.join(
                    process.cwd(),
                    'node_modules',
                    '@tesseract.js-data',
                    language,
                    LANGUAGE_DATA_FOLDER,
                    languageFileName(language),
                ),
                path.join(LANGUAGE_DIRECTORY, languageFileName(language)),
            ),
        ),
    );

    return LANGUAGE_DIRECTORY;
}

async function startWorker(): Promise<Worker> {
    const langPath = await prepareLanguageDirectory();

    return createWorker(LANGUAGES.join('+'), OEM.LSTM_ONLY, {
        langPath,
        gzip: true,
        cacheMethod: 'none',
    });
}

export function createTesseractRecognizer(): TextRecognizer {
    let worker: Promise<Worker> | null = null;

    return {
        async recognize(image) {
            worker ??= startWorker().catch((error: unknown) => {
                worker = null;
                throw error;
            });

            const running = await worker;
            const { data } = await running
                .recognize(image, {}, { blocks: true })
                .catch(async (error: unknown) => {
                    worker = null;
                    await running.terminate().catch(() => undefined);
                    throw error;
                });
            const paragraphs = (data.blocks ?? []).flatMap((block) => block.paragraphs);
            const lines = paragraphs.flatMap((paragraph) => paragraph.lines);

            return lines.flatMap((line) =>
                line.words.map(({ text, bbox }) => ({
                    text,
                    box: {
                        x: bbox.x0,
                        y: bbox.y0,
                        width: bbox.x1 - bbox.x0,
                        height: bbox.y1 - bbox.y0,
                    },
                })),
            );
        },
        async terminate() {
            const running = worker;
            worker = null;

            if (running) await (await running).terminate();
        },
    };
}

export function limitRecognizer(
    recognizer: TextRecognizer,
    { maxPending, timeoutMs }: RecognitionLimits,
): TextRecognizer {
    let pending = 0;

    return {
        async recognize(image) {
            if (pending >= maxPending) throw new ServiceBusyError();

            pending += 1;

            const job = recognizer.recognize(image);
            void job.then(
                () => (pending -= 1),
                () => (pending -= 1),
            );

            let timer: ReturnType<typeof setTimeout> | undefined;
            const timeout = new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new ServiceBusyError()), timeoutMs);
            });

            try {
                return await Promise.race([job, timeout]);
            } finally {
                clearTimeout(timer);
            }
        },
        terminate: () => recognizer.terminate(),
    };
}
