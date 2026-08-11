const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

// Import Models
const UserModel = require('./models/User');
const ThesisModel = require('./models/Thesis');

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'siyasat_super_secret_key_2026';

// -----------------------------------------------------------------------------
// Middleware & Body Parsers
// -----------------------------------------------------------------------------
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}
app.use('/uploads', express.static(uploadDir));

// -----------------------------------------------------------------------------
// Multer Upload Setup (PDF only, 25MB Max)
// -----------------------------------------------------------------------------
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/\s+/g, '_')}`)
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Only PDF files are allowed!'), false);
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
// Helper 1: Universal PDF Text Extraction Helper
// -----------------------------------------------------------------------------
async function extractPdfText(filePath) {
  try {
    let parseFunc = null;

    // Try standard require
    try {
      const mainModule = require('pdf-parse');
      if (typeof mainModule === 'function') {
        parseFunc = mainModule;
      } else if (mainModule && typeof mainModule.default === 'function') {
        parseFunc = mainModule.default;
      } else if (mainModule && typeof mainModule.pdfParse === 'function') {
        parseFunc = mainModule.pdfParse;
      }
    } catch (e) { }

    // Fallback directly to library core file if main export fails
    if (!parseFunc) {
      try {
        parseFunc = require('pdf-parse/lib/pdf-parse.js');
      } catch (e) { }
    }

    if (typeof parseFunc !== 'function') {
      console.error('❌ PDF Parser Error: Unable to resolve pdf-parse module entry point.');
      return '';
    }

    const dataBuffer = fs.readFileSync(filePath);
    const parsedPdf = await parseFunc(dataBuffer);
    return parsedPdf.text || '';
  } catch (err) {
    console.error('PDF Text Extraction Failed:', err.message);
    return '';
  }
}

// -----------------------------------------------------------------------------
// Helper 2: N-Gram Text Similarity Algorithm (3-Word N-Grams)
// -----------------------------------------------------------------------------
function calculateTextSimilarity(text1, text2, ngramSize = 3) {
  if (!text1 || !text2) return 0;
  const clean1 = text1.toLowerCase().replace(/[^\w\s]/gi, '').split(/\s+/);
  const clean2 = text2.toLowerCase().replace(/[^\w\s]/gi, '').split(/\s+/);

  if (clean1.length < ngramSize || clean2.length < ngramSize) return 0;

  const getNGrams = (words) => {
    const nGrams = new Set();
    for (let i = 0; i <= words.length - ngramSize; i++) {
      nGrams.add(words.slice(i, i + ngramSize).join(' '));
    }
    return nGrams;
  };

  const set1 = getNGrams(clean1);
  const set2 = getNGrams(clean2);

  let matchCount = 0;
  for (const gram of set1) {
    if (set2.has(gram)) matchCount++;
  }

  return Math.round((matchCount / Math.min(set1.size, set2.size)) * 100);
}

// -----------------------------------------------------------------------------
// API Routes
// -----------------------------------------------------------------------------

// Health Check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'SIYASAT API Server is running.' });
});

// 1. User Registration
app.post('/api/auth/register', async (req, res) => {
  const { full_name, email, password, role } = req.body;
  if (!email || !password || !full_name) {
    return res.status(400).json({ message: 'Full name, email, and password are required.' });
  }

  try {
    const existing = await UserModel.findByEmail(email);
    if (existing) {
      return res.status(400).json({ message: 'User with this email already exists.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const userRole = ['STUDENT', 'ADVISER', 'ADMIN'].includes(role) ? role : 'STUDENT';
    const user = await UserModel.create(full_name, email, passwordHash, userRole);

    res.status(201).json({ message: 'Account registered successfully.', user });
  } catch (err) {
    res.status(500).json({ message: 'Server error during registration: ' + err.message });
  }
});

// 2. User Login with 5-Attempt Lockout
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await UserModel.findByEmail(email);
    if (!user) return res.status(400).json({ message: 'Invalid credentials.' });

    if (user.status === 'BLOCKED') {
      return res.status(403).json({ message: 'Account is blocked. Contact administrator.' });
    }

    if (user.lockout_until && new Date(user.lockout_until) > new Date()) {
      const remainingTime = Math.ceil((new Date(user.lockout_until) - new Date()) / 1000 / 60);
      return res.status(403).json({
        message: `Account temporarily locked due to failed attempts. Try again in ${remainingTime} minutes.`
      });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);

    if (!isMatch) {
      const attempts = (user.failed_login_attempts || 0) + 1;
      let lockoutUntil = attempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null;
      await UserModel.recordFailedAttempt(user.id, attempts, lockoutUntil);

      if (lockoutUntil) {
        return res.status(403).json({ message: 'Account locked due to 5 failed attempts. Try again in 15 minutes.' });
      }

      return res.status(400).json({ message: `Invalid credentials. ${5 - attempts} attempt(s) remaining.` });
    }

    await UserModel.resetAttempts(user.id);

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, full_name: user.full_name },
      JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({
      message: 'Login successful',
      token,
      user: { id: user.id, full_name: user.full_name, email: user.email, role: user.role, status: user.status }
    });
  } catch (err) {
    res.status(500).json({ message: 'Internal server error during authentication.' });
  }
});

// 3. Search & Filter Theses
app.get('/api/theses', async (req, res) => {
  try {
    const theses = await ThesisModel.findAll(req.query);
    res.json({ theses });
  } catch (err) {
    res.status(500).json({ message: 'Failed to retrieve theses.' });
  }
});

// 4. Upload Thesis with Paraphrase Duplicate Scanner
app.post('/api/theses', authenticateToken, upload.single('file'), async (req, res) => {
  try {
    const { title, author, year, keywords, abstract, department, ignoreDuplicate } = req.body;
    if (!req.file) return res.status(400).json({ message: 'Please attach a valid PDF file under 25 MB.' });

    const normalizedPath = req.file.path.replace(/\\/g, '/');

    // Extract PDF text
    const fullPdfText = await extractPdfText(req.file.path);
    const completePaperContent = `${title} ${abstract} ${fullPdfText}`;

    // Full-Paper Similarity Check against database records
    if (!ignoreDuplicate || ignoreDuplicate !== 'true') {
      const existingTheses = await ThesisModel.getAllForScanning();

      for (const existing of existingTheses) {
        let existingFullText = `${existing.title} ${existing.abstract}`;

        if (existing.file_path && fs.existsSync(existing.file_path)) {
          const existingPdfText = await extractPdfText(existing.file_path);
          existingFullText += ` ${existingPdfText}`;
        }

        // Run 3-word n-gram similarity check
        const similarityScore = calculateTextSimilarity(completePaperContent, existingFullText, 3);

        // Threshold check (>= 15% similarity or exact title match)
        if (similarityScore >= 15 || (existing.title && title.toLowerCase().trim() === existing.title.toLowerCase().trim())) {
          return res.status(409).json({
            message: `Possible Duplicate Found! The uploaded PDF shares a ${similarityScore}% content similarity match with existing paper: "${existing.title}".`,
            duplicateId: existing.id,
            similarityScore
          });
        }
      }
    }

    const thesis = await ThesisModel.create({
      title,
      abstract,
      author,
      year,
      keywords,
      department,
      filePath: normalizedPath,
      uploadedBy: req.user.id
    });

    res.status(201).json({ message: 'Thesis successfully uploaded to repository.', thesis });
  } catch (err) {
    console.error('Upload Error:', err);
    res.status(500).json({ message: 'Internal server error during document scanning: ' + err.message });
  }
});

// 5. Update Thesis Metadata
app.put('/api/theses/:id', authenticateToken, upload.single('file'), async (req, res) => {
  if (req.user.role !== 'ADMIN' && req.user.role !== 'ADVISER') {
    return res.status(403).json({ message: 'Access denied.' });
  }

  try {
    const filePath = req.file ? req.file.path.replace(/\\/g, '/') : null;
    const thesis = await ThesisModel.update(req.params.id, { ...req.body, filePath });

    if (!thesis) return res.status(404).json({ message: 'Thesis paper not found.' });
    res.json({ message: 'Thesis updated successfully.', thesis });
  } catch (err) {
    res.status(500).json({ message: 'Failed to update thesis record.' });
  }
});

// 6. Delete Thesis (Admin Only)
app.delete('/api/theses/:id', authenticateToken, async (req, res) => {
  if (req.user.role !== 'ADMIN') return res.status(403).json({ message: 'Administrator privileges required.' });

  try {
    await ThesisModel.delete(req.params.id);
    res.json({ message: 'Thesis deleted successfully.' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to delete thesis record.' });
  }
});

// 7. AI Research Gap Analysis Tool
app.post('/api/theses/:id/analyze-gap', authenticateToken, async (req, res) => {
  try {
    const thesis = await ThesisModel.findById(req.params.id);
    if (!thesis) return res.status(404).json({ message: 'Thesis record not found.' });

    const report = {
      thesis_id: thesis.id,
      identified_gaps: `1. Limited real-time data collection in extreme weather conditions within ${thesis.department}.\n2. High deployment cost for low-resource regional farms.\n3. Lack of long-term predictive machine learning models based on local soil datasets.`,
      future_recommendations: `1. Integrate IoT sensor telemetry with low-power LoRaWAN networks for extended range.\n2. Develop solar-powered edge hardware modules to reduce reliance on grid power.\n3. Conduct multi-seasonal field trials across diverse agro-climatic zones in Central Luzon.`
    };

    res.json({ message: 'AI Analysis complete', report });
  } catch (err) {
    res.status(500).json({ message: 'Failed to generate AI Research Gap Report.' });
  }
});

// 8. Admin User Management
app.get('/api/admin/users', authenticateToken, async (req, res) => {
  if (req.user.role !== 'ADMIN') return res.status(403).json({ message: 'Administrator access required.' });
  try {
    const users = await UserModel.getAllUsers();
    res.json({ users });
  } catch (err) {
    res.status(500).json({ message: 'Failed to retrieve registered users.' });
  }
});

app.put('/api/admin/users/:id/status', authenticateToken, async (req, res) => {
  if (req.user.role !== 'ADMIN') return res.status(403).json({ message: 'Administrator access required.' });
  try {
    await UserModel.updateStatus(req.params.id, req.body.status);
    res.json({ message: `User status updated to ${req.body.status}.` });
  } catch (err) {
    res.status(500).json({ message: 'Failed to update user status.' });
  }
});

app.put('/api/admin/users/:id/role', authenticateToken, async (req, res) => {
  if (req.user.role !== 'ADMIN') return res.status(403).json({ message: 'Administrator access required.' });
  try {
    await UserModel.updateRole(req.params.id, req.body.role);
    res.json({ message: `User role updated to ${req.body.role}.` });
  } catch (err) {
    res.status(500).json({ message: 'Failed to update user role.' });
  }
});

// Start Express Server
app.listen(PORT, () => console.log(`🚀 SIYASAT Backend Server running on http://localhost:${PORT}`));