const crypto = require('crypto');
const { getPool } = require('../config');

function getMessageHash(messageBody) {
    return crypto.createHash('sha256').update(messageBody, 'utf8').digest('hex');
}

async function isMessageProcessed(message) {
    msgHash = getMessageHash(message);

    const connection = await getPool().getConnection();
    try {
        const [rows] = await connection.execute(
            'SELECT COUNT(1) AS count FROM Processed_Messages WHERE message_hash = ? AND queue_name = ?',
            [msgHash, 'ai-processor-queue']
        );
        return rows[0].count > 0;
    } finally {
        connection.release();
    }
}

async function markMessageProcessed(message) {
    msgHash = getMessageHash(message);
    
    const connection = await getPool().getConnection();
    try {
        await connection.execute(
            'INSERT INTO Processed_Messages (message_hash, queue_name) VALUES (?, ?)',
            [msgHash, 'ai-processor-queue']
        );
    } finally {
        connection.release();
    }
}

module.exports = {isMessageProcessed, markMessageProcessed};