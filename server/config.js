require('dotenv').config();
const AWS = require('aws-sdk');
const mysql = require('mysql2/promise');

const isDev = process.env.NODE_ENV === 'development';
let pool;

async function getDbConfig(){
    console.log('Getting DB config...');
    if(isDev){
        // local dev from .env
        console.log('Using local DB config');
        return{
            host: "127.0.0.1",
            user: process.env.user,
            password: process.env.password,
            database: process.env.dbname,
            port: process.env.port
        };
    }else{
        console.log('Using AWS Secrets Manager for DB config');
        const client = new AWS.SecretsManager({ region: 'us-east-2' });
        const data = await client.getSecretValue({ SecretId: 'prod/db-creds' }).promise();
        const secret = JSON.parse(data.SecretString);
    
        return{
            host: secret.host,
            user: secret.username,
            password: secret.password,
            database: secret.dbname
        };
    }
}

async function getOpenAPIKey(){
    if(isDev){
        return process.env.OPENAPI_KEY;
    }else{
        const client = new AWS.SecretsManager({ region: 'us-east-2' });
        const data = await client.getSecretValue({ SecretId: 'prod/db-creds' }).promise();
        const secret = JSON.parse(data.SecretString);
            
        return secret.openai_key;
    }
}

async function getPool(){
    if(pool){
        return pool;
    }

    let config = await getDbConfig();

    pool = mysql.createPool(config);
    
    return pool;
}

async function getS3BucketName() {
  if (isDev) {
    return process.env.AWS_S3_BUCKET_NAME;
  } else {
    const client = new AWS.SecretsManager({ region: 'us-east-2' });
    const data = await client.getSecretValue({ SecretId: 'prod/db-creds' }).promise();
    const secret = JSON.parse(data.SecretString);
    return secret.s3_bucket_name;
  }
}

async function getDbUpdaterQueueName() {
  if (isDev) {
    return process.env.DB_UPDATER_QUEUE;
  } else {
    const client = new AWS.SecretsManager({ region: 'us-east-2' });
    const data = await client.getSecretValue({ SecretId: 'prod/db-creds' }).promise();
    const secret = JSON.parse(data.SecretString);
    return secret.db_updater_queue;
  }
}

async function getAIProcessorQueueName() {
  if (isDev) {
    return process.env.AI_PROCESSOR_QUEUE;
  } else {
    const client = new AWS.SecretsManager({ region: 'us-east-2' });
    const data = await client.getSecretValue({ SecretId: 'prod/db-creds' }).promise();
    const secret = JSON.parse(data.SecretString);
    return secret.ai_processor_queue;
  }
}


module.exports = {getPool, getOpenAPIKey, getS3BucketName, getDbUpdaterQueueName,getAIProcessorQueueName};