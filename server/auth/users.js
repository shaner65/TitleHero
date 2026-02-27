import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { getPool } from '../config.js';

export async function authenticateUser(username, password) {
    try {
        const pool = await getPool();
        console.log('Attempting to authenticate user:', username);
        console.log('Password provided:', password);
        
        const [userRows] = await pool.execute(
            'SELECT userID AS id, name, password, role, permissions FROM User WHERE name = ?',
            [username]
        );

        if (userRows.length > 0) {
            console.log('Found admin user, stored password hash:', userRows[0].password);
        }

        const user = userRows[0];
        
        if (!user) {
            console.log('No user found with this username');
            return null;
        }

        try {
            // Use bcrypt to compare the password
            console.log('Attempting password comparison');
            const match = await bcrypt.compare(password, user.password);
            console.log('Password comparison result:', match);
            
            if (match) {
                console.log('Password matched, login successful');
                const { password, ...userWithoutPassword } = user;
                
                // Check if user must change password
                let mustChangePassword = false;
                if (user.permissions) {
                    try {
                        const perms = JSON.parse(user.permissions);
                        mustChangePassword = perms.mustChangePassword === true;
                    } catch (e) {
                        // permissions is not JSON, ignore
                    }
                }
                
                return { ...userWithoutPassword, mustChangePassword };
            } else {
                console.log('Password did not match');
            }
        } catch (error) {
            console.error('Error comparing passwords:', error);
        }

        return null;
    } catch (error) {
        console.error('Database authentication error:', error);
        return null;
    }
}

export async function hashPassword(password) {
    const saltRounds = 10;
    return await bcrypt.hash(password, saltRounds);
}

export async function createUser(username, password, role = 'user', permissions = null) {
    const pool = await getPool();
    const hashedPassword = await hashPassword(password);
    const [result] = await pool.execute(
        'INSERT INTO User (name, password, role, permissions) VALUES (?, ?, ?, ?)',
        [username, hashedPassword, role, permissions]
    );
    return result.insertId;
}

export function generateRandomPassword(length = 12) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%';
    let password = '';
    const randomBytes = crypto.randomBytes(length);
    for (let i = 0; i < length; i++) {
        password += chars[randomBytes[i] % chars.length];
    }
    return password;
}

export async function resetUserPassword(userId) {
    const pool = await getPool();
    const tempPassword = generateRandomPassword();
    const hashedPassword = await hashPassword(tempPassword);
    
    // Set password and mark user as needing to change password
    const permissions = JSON.stringify({ mustChangePassword: true });
    await pool.execute(
        'UPDATE User SET password = ?, permissions = ? WHERE userID = ?',
        [hashedPassword, permissions, userId]
    );
    
    return tempPassword;
}

export async function changeUserPassword(userId, newPassword) {
    const pool = await getPool();
    const hashedPassword = await hashPassword(newPassword);
    
    // Clear the mustChangePassword flag
    await pool.execute(
        'UPDATE User SET password = ?, permissions = NULL WHERE userID = ?',
        [hashedPassword, userId]
    );
    
    return true;
}