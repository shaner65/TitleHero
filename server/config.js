import dotenv from 'dotenv';
dotenv.config();

import mysql from 'mysql2/promise';
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
            port: process.env.port
        };
    } else {
        console.log('Using AWS Secrets Manager for DB config');
        const secret = await getSecret('prod/db-creds');
        return {
            host: secret.host,
            user: secret.username,
            password: secret.password,
            database: secret.dbname
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