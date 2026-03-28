import dotenv from 'dotenv';
dotenv.config();

import mysql from 'mysql2/promise';
import { Client as OpenSearchClient } from '@opensearch-project/opensearch';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

const isDev = process.env.NODE_ENV === 'development';
let pool;

const secretsClient = new SecretsManagerClient({ region: 'us-east-2' });

async function getSecret(secretId) {
    const command = new GetSecretValueCommand({ SecretId: secretId });
    const data = await secretsClient.send(command);
    return JSON.parse(data.SecretString);
}

async function getDbConfig(){
    console.log('Getting DB config...');
    if (isDev) {
        console.log('Using local DB config');
        return {
            host: "127.0.0.1",
            user: process.env.user,
            password: process.env.password,
            database: process.env.dbname,
            port: process.env.port,
            connectTimeout: 60000,
        };
    } else {
        console.log('Using AWS Secrets Manager for DB config');
        const secret = await getSecret('prod/db-creds');
        return {
            host: secret.host,
            user: secret.username,
            password: secret.password,
            database: secret.dbname,
            connectTimeout: 60000,
        };
    }
}

export async function getOpenAPIKey(){
    if (isDev) {
        return process.env.OPENAPI_KEY;
    } else {
        const secret = await getSecret('prod/db-creds');
        return secret.openai_key;
    }
}

export async function getPool(){
    if (pool) return pool;

    const config = await getDbConfig();
    pool = mysql.createPool(config);
    return pool;
}

export async function getS3BucketName() {
    if (isDev) {
        return process.env.AWS_S3_BUCKET_NAME;
    } else {
        const secret = await getSecret('prod/db-creds');
        return secret.s3_bucket_name;
    }
}

export async function getDbUpdaterQueueName() {
    if (isDev) {
        return process.env.DB_UPDATER_QUEUE;
    } else {
        const secret = await getSecret('prod/db-creds');
        return secret.db_updater_queue;
    }
}

export async function getAIProcessorQueueName() {
    if (isDev) {
        return process.env.AI_PROCESSOR_QUEUE;
    } else {
        const secret = await getSecret('prod/db-creds');
        return secret.ai_processor_queue;
    }
}

export async function getTifProcessQueueName() {
    if (isDev) {
        return process.env.TIF_PROCESS_QUEUE;
    } else {
        const secret = await getSecret('prod/db-creds');
        return secret.tif_process_queue;
    }
}

export async function getOpenSearchConfig() {
    let url = (process.env.OPENSEARCH_URL || '').trim();
    let user = process.env.OPENSEARCH_USER || '';
    let password = process.env.OPENSEARCH_PASSWORD || '';
    const rejectUnauthorized = process.env.OPENSEARCH_REJECT_UNAUTHORIZED !== 'false';

    if (!isDev) {
        try {
            const secret = await getSecret('prod/db-creds');
            if (secret.opensearch_url) {
                url = String(secret.opensearch_url).trim();
                user = secret.opensearch_user || user;
                password = secret.opensearch_password || password;
                return {
                    url,
                    user,
                    password,
                    rejectUnauthorized: secret.opensearch_reject_unauthorized !== false,
                };
            }
        } catch {
            // fall through to env-only
        }
    }

    if (!url) {
        return null;
    }

    return {
        url,
        user,
        password,
        rejectUnauthorized,
    };
}

// --- Search backend (Secrets Manager in production) ---

/**
 * Resolved search backend from env (development) or `prod/db-creds` (production).
 * Secret JSON may set `search_backend` or `SEARCH_BACKEND` (`opensearch` | `mysql` | empty).
 * Falls back to process.env.SEARCH_BACKEND when unset in the secret.
 */
export async function getSearchBackend() {
    if (isDev) {
        return String(process.env.SEARCH_BACKEND || '').toLowerCase().trim();
    }
    try {
        const secret = await getSecret('prod/db-creds');
        const raw = secret.search_backend ?? secret.SEARCH_BACKEND;
        if (raw != null && String(raw).trim() !== '') {
            return String(raw).toLowerCase().trim();
        }
    } catch {
        // fall through to env
    }
    return String(process.env.SEARCH_BACKEND || '').toLowerCase().trim();
}

export function createOpenSearchClient(openSearchConfig) {
    return new OpenSearchClient({
        node: openSearchConfig.url,
        ssl: openSearchConfig.rejectUnauthorized === false ? { rejectUnauthorized: false } : undefined,
        auth:
            openSearchConfig.user || openSearchConfig.password
                ? { username: openSearchConfig.user || '', password: openSearchConfig.password || '' }
                : undefined,
        requestTimeout: 60000,
        maxRetries: 2,
    });
}