const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'siyasat_db',
    password: process.env.DB_PASSWORD || 'postgres',
    port: process.env.DB_PORT || 5432,
});

const UserModel = {
    // Find user by email
    findByEmail: async (email) => {
        const res = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        return res.rows[0];
    },

    // Create new registered user
    create: async (fullName, email, passwordHash, role) => {
        const query = `
      INSERT INTO users (full_name, email, password_hash, role, status)
      VALUES ($1, $2, $3, $4, 'ACTIVE')
      RETURNING id, full_name, email, role, status;
    `;
        const res = await pool.query(query, [fullName, email, passwordHash, role]);
        return res.rows[0];
    },

    // Record failed login attempt or lock account
    recordFailedAttempt: async (userId, attempts, lockoutUntil = null) => {
        if (lockoutUntil) {
            await pool.query(
                'UPDATE users SET failed_login_attempts = $1, lockout_until = $2 WHERE id = $3',
                [0, lockoutUntil, userId]
            );
        } else {
            await pool.query(
                'UPDATE users SET failed_login_attempts = $1 WHERE id = $2',
                [attempts, userId]
            );
        }
    },

    // Reset login attempts after successful login
    resetAttempts: async (userId) => {
        await pool.query(
            'UPDATE users SET failed_login_attempts = 0, lockout_until = NULL WHERE id = $1',
            [userId]
        );
    },

    // Get all users for admin dashboard
    getAllUsers: async () => {
        const res = await pool.query(
            'SELECT id, full_name, email, role, status, created_at FROM users ORDER BY id ASC'
        );
        return res.rows;
    },

    // Update user status (ACTIVE / BLOCKED)
    updateStatus: async (userId, status) => {
        await pool.query('UPDATE users SET status = $1 WHERE id = $2', [status, userId]);
    },

    // Update user role (ADMIN / ADVISER / STUDENT)
    updateRole: async (userId, role) => {
        await pool.query('UPDATE users SET role = $1 WHERE id = $2', [role, userId]);
    }
};

module.exports = UserModel;