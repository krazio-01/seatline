import 'server-only';
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto';
import { getEnv } from '@/lib/env';

type SealedBytes = { keyId: string; iv: Buffer; authTag: Buffer; ciphertext: Buffer };

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;
const AUTH_TAG_BYTES = 16;
const HASH_KEY_INFO = 'field-hash';

function loadKey(): { key: Buffer; keyId: string } {
    const { FIELD_ENCRYPTION_KEY, FIELD_ENCRYPTION_KEY_ID } = getEnv();
    const key = Buffer.from(FIELD_ENCRYPTION_KEY, 'base64');
    if (key.length !== KEY_BYTES) {
        throw new Error(
            `FIELD_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes, got ${key.length}`,
        );
    }

    return { key, keyId: FIELD_ENCRYPTION_KEY_ID };
}

function seal(plaintext: Buffer): SealedBytes {
    const { key, keyId } = loadKey();
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_BYTES });
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);

    return { keyId, iv, authTag: cipher.getAuthTag(), ciphertext };
}

function open({ keyId, iv, authTag, ciphertext }: SealedBytes): Buffer {
    const { key, keyId: currentKeyId } = loadKey();
    if (keyId !== currentKeyId) throw new Error('Unknown encryption key id');

    if (iv.length !== IV_BYTES) throw new Error('Malformed encrypted payload: invalid IV length');

    if (authTag.length !== AUTH_TAG_BYTES) {
        throw new Error('Malformed encrypted payload: invalid auth tag length');
    }

    const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_BYTES });
    decipher.setAuthTag(authTag);

    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export function encryptField(plaintext: string): string {
    const { keyId, iv, authTag, ciphertext } = seal(Buffer.from(plaintext, 'utf8'));

    return [
        keyId,
        iv.toString('base64'),
        authTag.toString('base64'),
        ciphertext.toString('base64'),
    ].join(':');
}

export function decryptField(payload: string): string {
    const parts = payload.split(':');
    if (parts.length !== 4) throw new Error('Malformed encrypted payload');

    const [keyId, ivEncoded, authTagEncoded, ciphertextEncoded] = parts;

    return open({
        keyId,
        iv: Buffer.from(ivEncoded, 'base64'),
        authTag: Buffer.from(authTagEncoded, 'base64'),
        ciphertext: Buffer.from(ciphertextEncoded, 'base64'),
    }).toString('utf8');
}

export function encryptBytes(data: Buffer): Buffer {
    const { keyId, iv, authTag, ciphertext } = seal(data);
    const keyIdBytes = Buffer.from(keyId, 'utf8');

    return Buffer.concat([Buffer.from([keyIdBytes.length]), keyIdBytes, iv, authTag, ciphertext]);
}

export function decryptBytes(payload: Buffer): Buffer {
    const keyIdEnd = 1 + (payload[0] ?? 0);
    const ivEnd = keyIdEnd + IV_BYTES;
    const authTagEnd = ivEnd + AUTH_TAG_BYTES;
    if (payload.length < authTagEnd) throw new Error('Malformed encrypted payload');

    return open({
        keyId: payload.subarray(1, keyIdEnd).toString('utf8'),
        iv: payload.subarray(keyIdEnd, ivEnd),
        authTag: payload.subarray(ivEnd, authTagEnd),
        ciphertext: payload.subarray(authTagEnd),
    });
}

export function hashField(value: string): string {
    const { key } = loadKey();
    const hashKey = Buffer.from(hkdfSync('sha256', key, Buffer.alloc(0), HASH_KEY_INFO, KEY_BYTES));

    return createHmac('sha256', hashKey).update(value, 'utf8').digest('hex');
}
