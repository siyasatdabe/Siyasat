const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'siyasat_db',
    password: process.env.DB_PASSWORD || 'postgres',
    port: process.env.DB_PORT || 5432,
});

const ThesisModel = {
    // Search and filter theses
    findAll: async ({ q, year, branch, sort }) => {
        let queryStr = 'SELECT * FROM theses WHERE 1=1';
        const params = [];

        if (q) {
            params.push(`%${q}%`);
            queryStr += ` AND (title ILIKE $${params.length} OR author ILIKE $${params.length} OR keywords ILIKE $${params.length} OR abstract ILIKE $${params.length})`;
        }

        if (year) {
            params.push(parseInt(year, 10));
            queryStr += ` AND year = $${params.length}`;
        }

        if (branch) {
            params.push(`%${branch}%`);
            queryStr += ` AND department ILIKE $${params.length}`;
        }

        if (sort === 'year_desc' || sort === 'descending') {
            queryStr += ' ORDER BY year DESC, created_at DESC';
        } else if (sort === 'year_asc' || sort === 'ascending') {
            queryStr += ' ORDER BY year ASC, created_at ASC';
        } else if (sort === 'title_asc') {
            queryStr += ' ORDER BY title ASC';
        } else {
            queryStr += ' ORDER BY created_at DESC';
        }

        const res = await pool.query(queryStr, params);
        return res.rows;
    },

    // Find single thesis by ID
    findById: async (id) => {
        const res = await pool.query('SELECT * FROM theses WHERE id = $1', [id]);
        return res.rows[0];
    },

    // Get all thesis records for duplicate comparison
    getAllForScanning: async () => {
        const res = await pool.query('SELECT id, title, abstract, file_path FROM theses');
        return res.rows;
    },

    // Create new thesis record
    create: async ({ title, abstract, author, year, keywords, department, filePath, uploadedBy }) => {
        const query = `
      INSERT INTO theses (title, abstract, author, year, keywords, department, file_path, uploaded_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *;
    `;
        const values = [
            title,
            abstract,
            author,
            parseInt(year, 10) || new Date().getFullYear(),
            keywords || '',
            department || 'Land and Water Resources Engineering',
            filePath,
            uploadedBy
        ];
        const res = await pool.query(query, values);
        return res.rows[0];
    },

    // Update existing thesis metadata
    update: async (id, { title, author, year, keywords, abstract, department, filePath }) => {
        let updateQuery = `
      UPDATE theses 
      SET title = $1, author = $2, year = $3, keywords = $4, abstract = $5, department = $6
    `;
        const params = [title, author, parseInt(year, 10), keywords, abstract, department];

        if (filePath) {
            params.push(filePath);
            updateQuery += `, file_path = $${params.length}`;
        }

        params.push(id);
        updateQuery += ` WHERE id = $${params.length} RETURNING *;`;

        const res = await pool.query(updateQuery, params);
        return res.rows[0];
    },

    // Delete thesis by ID
    delete: async (id) => {
        await pool.query('DELETE FROM theses WHERE id = $1', [id]);
    }
};

module.exports = ThesisModel;