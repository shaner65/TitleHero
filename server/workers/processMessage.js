import crypto from 'crypto';
import { getPool } from '../config.js';

function getMessageHash(messageBody) {
    return crypto.createHash('sha256').update(messageBody, 'utf8').digest('hex');
}

export async function isMessageProcessed(message, queue_name) {
    const msgHash = getMessageHash(message);

    const pool = await getPool();
    const connection = await pool.getConnection();

    try {
        const [rows] = await connection.execute(
            'SELECT COUNT(1) AS count FROM Processed_Messages WHERE message_hash = ? AND queue_name = ?',
            [msgHash, queue_name]
        );
        return rows[0].count > 0;
    } finally {
        connection.release();
    }
}

export async function markMessageProcessed(message, queue_name) {
    const msgHash = getMessageHash(message);

    const pool = await getPool();
    const connection = await pool.getConnection();

    try {
        await connection.execute(
            'INSERT INTO Processed_Messages (message_hash, queue_name) VALUES (?, ?)',
            [msgHash, queue_name]
        );
    } finally {
        connection.release();
    }
}