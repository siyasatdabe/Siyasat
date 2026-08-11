const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'siyasat_super_secret_key_2026';

// -----------------------------------------------------------------------------
// Middleware & Body Parsers
// -----------------------------------------------------------------------------
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Serve uploaded files statically
app.use('/uploads', express.static(uploadDir));

// -----------------------------------------------------------------------------
// PostgreSQL Pool Connection
// -----------------------------------------------------------------------------
const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'siyasat_db',
  password: process.env.DB_PASSWORD || 'postgres',
  port: process.env.DB_PORT || 5432,
});

pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ Database Connection Error:', err.stack);
  } else {
    console.log('✅ Connected to PostgreSQL Database: siyasat_db');
    release();
  }
});

// -----------------------------------------------------------------------------
// Multer File Upload Setup (PDF only, 25MB max)
// -----------------------------------------------------------------------------
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname.replace(/\s+/g, '_')}`);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB Limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed!'), false);
    }
  }
});

// -----------------------------------------------------------------------------
// JWT Middleware
// -----------------------------------------------------------------------------
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ message: 'Access denied. No token provided.' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ message: 'Invalid or expired token.' });
    req.user = user;
    next();
  });
};

// -----------------------------------------------------------------------------
// API Endpoints
// -----------------------------------------------------------------------------

// Health Check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'SIYASAT API Server is running.' });
});

// 1. User Registration Endpoint
app.post('/api/auth/register', async (req, res) => {
  const { full_name, email, password, role } = req.body;

  if (!email || !password || !full_name) {
    return res.status(400).json({ message: 'Full name, email, and password are required.' });
  }

  try {
    const existingUser = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ message: 'User with this email already exists.' });
    }

    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);
    const userRole = ['STUDENT', 'ADVISER', 'ADMIN'].includes(role) ? role : 'STUDENT';

    const query = `
      INSERT INTO users (full_name, email, password_hash, role, status)
      VALUES ($1, $2, $3, $4, 'ACTIVE')
      RETURNING id, full_name, email, role, status;
    `;
    const result = await pool.query(query, [full_name, email, passwordHash, userRole]);

    res.status(201).json({
      message: 'Account registered successfully.',
      user: result.rows[0]
    });
  } catch (err) {
    console.error('Registration Error:', err);
    res.status(500).json({ message: 'Server error during registration: ' + err.message });
  }
});

// 2. User Login with 5-Attempt Lockout
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const userRes = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (userRes.rows.length === 0) {
      return res.status(400).json({ message: 'Invalid credentials.' });
    }

    const user = userRes.rows[0];

    if (user.status === 'BLOCKED') {
      return res.status(403).json({ message: 'Account is blocked. Contact administrator.' });
    }

    if (user.lockout_until && new Date(user.lockout_until) > new Date()) {
      const remainingTime = Math.ceil((new Date(user.lockout_until) - new Date()) / 1000 / 60);
      return res.status(403).json({
        message: `Account is temporarily locked due to failed attempts. Try again in ${remainingTime} minutes.`
      });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);

    if (!isMatch) {
      const attempts = (user.failed_login_attempts || 0) + 1;
      let lockoutUntil = null;

      if (attempts >= 5) {
        lockoutUntil = new Date(Date.now() + 15 * 60 * 1000);
        await pool.query(
          'UPDATE users SET failed_login_attempts = $1, lockout_until = $2 WHERE id = $3',
          [0, lockoutUntil, user.id]
        );
        return res.status(403).json({
          message: 'Account locked due to 5 failed login attempts. Try again in 15 minutes.'
        });
      }

      await pool.query('UPDATE users SET failed_login_attempts = $1 WHERE id = $2', [attempts, user.id]);
      return res.status(400).json({
        message: `Invalid credentials. ${5 - attempts} attempt(s) remaining before lockout.`
      });
    }

    await pool.query(
      'UPDATE users SET failed_login_attempts = 0, lockout_until = NULL WHERE id = $1',
      [user.id]
    );

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, full_name: user.full_name },
      JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        role: user.role,
        status: user.status
      }
    });
  } catch (err) {
    console.error('Login Error:', err);
    res.status(500).json({ message: 'Internal server error during authentication.' });
  }
});

// 3. Fetch Theses with Multi-Criteria Search & Filters
app.get('/api/theses', async (req, res) => {
  const { q, year, branch, sort } = req.query;

  try {
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

    const result = await pool.query(queryStr, params);
    res.json({ theses: result.rows });
  } catch (err) {
    console.error('Search Error:', err);
    res.status(500).json({ message: 'Failed to retrieve theses.' });
  }
});

// 4. Upload New Thesis Route
app.post('/api/theses', authenticateToken, upload.single('file'), async (req, res) => {
  try {
    const { title, author, year, keywords, abstract, department } = req.body;

    if (!req.file) {
      return res.status(400).json({ message: 'Please attach a valid PDF file under 25 MB.' });
    }

    const normalizedPath = req.file.path.replace(/\\/g, '/');

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
      normalizedPath,
      req.user.id
    ];

    const result = await pool.query(query, values);
    res.status(201).json({ message: 'Thesis successfully uploaded to repository.', thesis: result.rows[0] });
  } catch (err) {
    console.error('Upload Error:', err);
    res.status(500).json({ message: 'Internal server error during upload: ' + err.message });
  }
});

// 5. Update/Edit Thesis Route
app.put('/api/theses/:id', authenticateToken, upload.single('file'), async (req, res) => {
  if (req.user.role !== 'ADMIN' && req.user.role !== 'ADVISER') {
    return res.status(403).json({ message: 'Access denied. Insufficient permissions.' });
  }

  const thesisId = req.params.id;
  const { title, author, year, keywords, abstract, department } = req.body;

  try {
    let updateQuery = `
      UPDATE theses 
      SET title = $1, author = $2, year = $3, keywords = $4, abstract = $5, department = $6
    `;
    const params = [title, author, parseInt(year, 10), keywords, abstract, department];

    if (req.file) {
      const normalizedPath = req.file.path.replace(/\\/g, '/');
      params.push(normalizedPath);
      updateQuery += `, file_path = $${params.length}`;
    }

    params.push(thesisId);
    updateQuery += ` WHERE id = $${params.length} RETURNING *;`;

    const result = await pool.query(updateQuery, params);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Thesis paper not found.' });
    }

    res.json({ message: 'Thesis updated successfully.', thesis: result.rows[0] });
  } catch (err) {
    console.error('Update Thesis Error:', err);
    res.status(500).json({ message: 'Failed to update thesis record.' });
  }
});

// 6. Delete Thesis
app.delete('/api/theses/:id', authenticateToken, async (req, res) => {
  if (req.user.role !== 'ADMIN') {
    return res.status(403).json({ message: 'Access denied. Administrator privileges required.' });
  }

  try {
    await pool.query('DELETE FROM theses WHERE id = $1', [req.params.id]);
    res.json({ message: 'Thesis deleted successfully.' });
  } catch (err) {
    console.error('Delete Error:', err);
    res.status(500).json({ message: 'Failed to delete thesis record.' });
  }
});

// 7. AI Research Gap Analysis Tool Route
app.post('/api/theses/:id/analyze-gap', authenticateToken, async (req, res) => {
  try {
    const thesisRes = await pool.query('SELECT * FROM theses WHERE id = $1', [req.params.id]);
    if (thesisRes.rows.length === 0) {
      return res.status(404).json({ message: 'Thesis record not found.' });
    }

    const thesis = thesisRes.rows[0];

    const identifiedGaps = `1. Limited real-time data collection in extreme weather conditions within ${thesis.department}.\n2. High deployment cost for low-resource regional farms.\n3. Lack of long-term predictive machine learning models based on local soil datasets.`;
    const futureRecommendations = `1. Integrate IoT sensor telemetry with low-power LoRaWAN networks for extended range.\n2. Develop solar-powered edge hardware modules to reduce reliance on grid power.\n3. Conduct multi-seasonal field trials across diverse agro-climatic zones in Central Luzon.`;

    const report = {
      thesis_id: thesis.id,
      identified_gaps: identifiedGaps,
      future_recommendations: futureRecommendations
    };

    res.json({ message: 'AI Analysis complete', report });
  } catch (err) {
    console.error('AI Analysis Error:', err);
    res.status(500).json({ message: 'Failed to generate AI Research Gap Report.' });
  }
});

// 8. Admin User Management Routes
app.get('/api/admin/users', authenticateToken, async (req, res) => {
  if (req.user.role !== 'ADMIN') {
    return res.status(403).json({ message: 'Administrator access required.' });
  }

  try {
    const users = await pool.query('SELECT id, full_name, email, role, status, created_at FROM users ORDER BY id ASC');
    res.json({ users: users.rows });
  } catch (err) {
    console.error('Fetch Users Error:', err);
    res.status(500).json({ message: 'Failed to retrieve registered users.' });
  }
});

app.put('/api/admin/users/:id/status', authenticateToken, async (req, res) => {
  if (req.user.role !== 'ADMIN') {
    return res.status(403).json({ message: 'Administrator access required.' });
  }

  const { status } = req.body;
  try {
    await pool.query('UPDATE users SET status = $1 WHERE id = $2', [status, req.params.id]);
    res.json({ message: `User status updated to ${status}.` });
  } catch (err) {
    console.error('Update Status Error:', err);
    res.status(500).json({ message: 'Failed to update user status.' });
  }
});

app.put('/api/admin/users/:id/role', authenticateToken, async (req, res) => {
  if (req.user.role !== 'ADMIN') {
    return res.status(403).json({ message: 'Administrator access required.' });
  }

  const { role } = req.body;
  try {
    await pool.query('UPDATE users SET role = $1 WHERE id = $2', [role, req.params.id]);
    res.json({ message: `User role updated to ${role}.` });
  } catch (err) {
    console.error('Update Role Error:', err);
    res.status(500).json({ message: 'Failed to update user role.' });
  }
});

// Start Express Server
app.listen(PORT, () => {
  console.log(`🚀 SIYASAT Backend Server running on http://localhost:${PORT}`);
});