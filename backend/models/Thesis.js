const { Pool } = require('pg');
require('dotenv').config();

// PostgreSQL Connection Pool
const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'siyasat_db',
    password: process.env.DB_PASSWORD || 'postgres',
    port: process.env.DB_PORT || 5432,
});

const ThesisModel = {
    /**
     * Search and filter theses with optional query parameters and sorting.
     */
    findAll: async ({ q, year, branch, sort }) => {
        let queryStr = 'SELECT * FROM theses WHERE 1=1';
        const params = [];

        if (q) {
            params.push(`%${q}%`);
            queryStr += ` AND (title ILIKE $${params.length} OR author ILIKE $${params.length} OR keywords ILIKE $${params.length} OR abstract ILIKE $${params.length})`;
        }

        if (year && !isNaN(parseInt(year, 10))) {
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

    /**
     * Find a single thesis record by ID (safely parses ID to Integer).
     */
    findById: async (id) => {
        const numericId = parseInt(id, 10);
        if (isNaN(numericId)) return null;

        const res = await pool.query('SELECT * FROM theses WHERE id = $1', [numericId]);
        return res.rows[0];
    },

    /**
     * Retrieve all thesis records for N-Gram duplicate checking during uploads.
     */
    getAllForScanning: async () => {
        const res = await pool.query('SELECT id, title, abstract, file_path FROM theses');
        return res.rows;
    },

    /**
     * Create a new thesis record with safe Integer fallbacks for foreign key columns.
     */
    create: async ({ title, abstract, author, year, keywords, department, filePath, uploadedBy }) => {
        const query = `
      INSERT INTO theses (title, abstract, author, year, keywords, department, file_path, uploaded_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *;
    `;

        const numericYear = parseInt(year, 10) || new Date().getFullYear();
        const numericUploadedBy = parseInt(uploadedBy, 10) || 1; // Prevents "mock-admin" string insertion errors

        const values = [
            title || 'Untitled Thesis',
            abstract || '',
            author || 'Unknown Author',
            numericYear,
            keywords || '',
            department || 'Land and Water Resources Engineering',
            filePath || null,
            numericUploadedBy
        ];

        const res = await pool.query(query, values);
        return res.rows[0];
    },

    /**
     * Safely updates an existing thesis metadata record by ID.
     * Preserves existing values if updated fields are omitted or undefined.
     */
    update: async (id, { title, author, year, keywords, abstract, department, filePath }) => {
        const numericId = parseInt(id, 10);
        if (isNaN(numericId)) {
            throw new Error(`Invalid thesis ID: ${id}`);
        }

        // Fetch existing thesis record to fallback on current values for non-updated fields
        const existing = await ThesisModel.findById(numericId);
        if (!existing) {
            throw new Error(`Thesis with ID ${numericId} not found.`);
        }

        const updatedTitle = title !== undefined && title !== '' ? title : existing.title;
        const updatedAuthor = author !== undefined && author !== '' ? author : existing.author;
        const updatedYear = year && !isNaN(parseInt(year, 10)) ? parseInt(year, 10) : existing.year;
        const updatedKeywords = keywords !== undefined ? keywords : existing.keywords;
        const updatedAbstract = abstract !== undefined && abstract !== '' ? abstract : existing.abstract;
        const updatedDept = department !== undefined && department !== '' ? department : existing.department;
        const updatedFilePath = filePath || existing.file_path;

        const updateQuery = `
      UPDATE theses 
      SET title = $1, author = $2, year = $3, keywords = $4, abstract = $5, department = $6, file_path = $7
      WHERE id = $8 
      RETURNING *;
    `;

        const params = [
            updatedTitle,
            updatedAuthor,
            updatedYear,
            updatedKeywords,
            updatedAbstract,
            updatedDept,
            updatedFilePath,
            numericId
        ];

        const res = await pool.query(updateQuery, params);
        return res.rows[0];
    },

    /**
     * Permanently deletes a thesis record by ID.
     */
    delete: async (id) => {
        const numericId = parseInt(id, 10);
        if (isNaN(numericId)) {
            throw new Error(`Invalid thesis ID for deletion: ${id}`);
        }

        const res = await pool.query('DELETE FROM theses WHERE id = $1 RETURNING *;', [numericId]);
        return res.rows[0];
    }
};

module.exports = ThesisModel;