const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const PDFDocument = require('pdfkit');
const multer = require('multer');
const path = require('path');
const nodemailer = require('nodemailer');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' })); // Increased limit for base64 signature images

// Initialize AWS S3 Client (v3)
const s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
const S3_BUCKET_NAME = process.env.AWS_S3_BUCKET || 'directcare-pft-secure-reports';
const upload = multer({ storage: multer.memoryStorage() });

const PORT = process.env.PORT || 5000;
const JWT_SECRET = 'super_secure_directcare_hipaa_jwt_key_2026';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:sVE1%5B%27ag4G@directcare-pft-db.cs5m8662wh1z.us-east-1.rds.amazonaws.com:5432/postgres',
  ssl: { rejectUnauthorized: false }
});

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || 'smtp.gmail.com',
  port: process.env.EMAIL_PORT || 587,
  secure: false,
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
});

async function initializeDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS clinics (
        clinic_id SERIAL PRIMARY KEY,
        clinic_name VARCHAR(255) UNIQUE,
        billing_email VARCHAR(255),
        phone_number VARCHAR(50),
        authorized_rep_email VARCHAR(255),
        address TEXT,
        baa_signer_name VARCHAR(255),
        baa_signer_title VARCHAR(255),
        baa_signature TEXT,
        admin_signature TEXT,
        baa_signed_date TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS users (
        user_id SERIAL PRIMARY KEY,
        full_name VARCHAR(255),
        email VARCHAR(255) UNIQUE,
        password_hash VARCHAR(255),
        signature_pin_hash VARCHAR(255),
        role VARCHAR(50) DEFAULT 'admin',
        clinic_name VARCHAR(255),
        credentials VARCHAR(100),
        npi VARCHAR(20),
        must_change_password BOOLEAN DEFAULT FALSE,
        baa_signed BOOLEAN DEFAULT FALSE,
        baa_signed_date TIMESTAMP,
        baa_signer_name VARCHAR(255),
        baa_ip_address VARCHAR(100)
      );

      CREATE TABLE IF NOT EXISTS password_history (
        history_id SERIAL PRIMARY KEY,
        user_id INT REFERENCES users(user_id) ON DELETE CASCADE,
        password_hash VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS clinic_schedules (
        schedule_id SERIAL PRIMARY KEY,
        clinic_name VARCHAR(255) UNIQUE,
        allowed_dates TEXT
      );

      CREATE TABLE IF NOT EXISTS service_requests (
        request_id SERIAL PRIMARY KEY,
        clinic_name VARCHAR(255),
        patient_name VARCHAR(255),
        patient_dob DATE,
        insurance_type VARCHAR(255),
        ordering_reason VARCHAR(1000),
        tests_ordered VARCHAR(1000),
        requested_date DATE,
        time_block VARCHAR(50),
        status VARCHAR(50) DEFAULT 'PENDING',
        interpretation TEXT,
        rrt_notes TEXT,
        recommended_interpretation TEXT,
        mdi_education TEXT,
        provider_id INT,
        assigned_rrt_id INT,
        physician_id INT,
        uploaded_report_path TEXT,
        is_deleted BOOLEAN DEFAULT FALSE,
        requested_date_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      ALTER TABLE clinics ADD COLUMN IF NOT EXISTS admin_signature TEXT;
    `);
  } catch (err) { console.error("Database init error:", err); }
}

initializeDatabase();

const verifyToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Access denied.' });
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid token.' });
    req.user = user;
    next();
  });
};

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) return res.status(400).json({ error: 'Invalid email/password' });
    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) return res.status(400).json({ error: 'Invalid email/password' });

    const token = jwt.sign(
      { user_id: user.user_id, email: user.email, role: user.role, clinic_name: user.clinic_name, credentials: user.credentials, npi: user.npi }, 
      JWT_SECRET, { expiresIn: '8h' }
    );

    res.json({ message: 'Login successful', token, user: { user_id: user.user_id, full_name: user.full_name, email: user.email, role: user.role, clinic_name: user.clinic_name, credentials: user.credentials, npi: user.npi, must_change_password: user.must_change_password, baa_signed: user.baa_signed } });
  } catch (err) { res.status(500).json({ error: 'Server error during login' }); }
});

// CLINIC CREATION & EXECUTED BAA ENDPOINT
app.post('/api/clinics', verifyToken, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Unauthorized' });
  const { clinic_name, billing_email, phone_number, authorized_rep_email, address, baa_signer_name, baa_signer_title, baa_signature, admin_signature } = req.body;

  if (!clinic_name || !billing_email || !baa_signature || !admin_signature) {
    return res.status(400).json({ error: 'Clinic details and both signatures are required.' });
  }

  try {
    const query = `
      INSERT INTO clinics (clinic_name, billing_email, phone_number, authorized_rep_email, address, baa_signer_name, baa_signer_title, baa_signature, admin_signature, baa_signed_date)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)
      ON CONFLICT (clinic_name) DO UPDATE SET 
        billing_email = EXCLUDED.billing_email, phone_number = EXCLUDED.phone_number, authorized_rep_email = EXCLUDED.authorized_rep_email, address = EXCLUDED.address, baa_signer_name = EXCLUDED.baa_signer_name, baa_signer_title = EXCLUDED.baa_signer_title, baa_signature = EXCLUDED.baa_signature, admin_signature = EXCLUDED.admin_signature, baa_signed_date = CURRENT_TIMESTAMP
      RETURNING *;
    `;
    const result = await pool.query(query, [clinic_name, billing_email, phone_number, authorized_rep_email, address, baa_signer_name, baa_signer_title, baa_signature, admin_signature]);
    res.status(201).json({ message: 'Clinic saved successfully', clinic: result.rows[0] });
  } catch (err) { res.status(500).json({ error: 'Failed to save clinic: ' + err.message }); }
});

app.get('/api/clinics', verifyToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM clinics ORDER BY clinic_name ASC');
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: 'Failed to fetch clinics' }); }
});

// GENERATE EXECUTED BAA PDF FOR A SPECIFIC CLINIC WITH INJECTED SIGNATURE IMAGES
app.get('/api/clinics/:id/baa-pdf', verifyToken, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Unauthorized' });

  try {
    const { id } = req.params;
    const clinicResult = await pool.query('SELECT * FROM clinics WHERE clinic_id = $1', [id]);
    if (clinicResult.rows.length === 0) return res.status(404).json({ error: 'Clinic not found' });
    const clinic = clinicResult.rows[0];

    const doc = new PDFDocument({ margin: 50, autoFirstPage: true });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=Executed_BAA_${clinic.clinic_name.replace(/\s+/g, '_')}.pdf`);
    doc.pipe(res);

    const effectiveDate = new Date(clinic.baa_signed_date).toLocaleDateString();

    doc.fontSize(16).fillColor('#002b5c').font('Helvetica-Bold').text('HIPAA BUSINESS ASSOCIATE AGREEMENT', { align: 'center' });
    doc.moveDown(1.5);

    doc.fontSize(9).fillColor('#2d3748').font('Helvetica').text(
      `This HIPAA Business Associate Agreement (“Agreement”) is entered into as of ${effectiveDate} (“Effective Date”) by and between ${clinic.clinic_name}, a participating healthcare entity (“Covered Entity”), and DirectCare Pulmonary Diagnostics LLC, an Ohio limited liability company (“Business Associate”).`,
      { align: 'justify', lineGap: 3 }
    );
    doc.moveDown(1);

    doc.font('Helvetica-Bold').text('RECITALS');
    doc.font('Helvetica').text(
      'WHEREAS, Covered Entity possesses Protected Health Information (PHI) that is protected under HIPAA;\n' +
      'WHEREAS, Business Associate provides diagnostic pulmonary testing and portal management services involving PHI;\n' +
      'NOW, THEREFORE, the parties agree as follows:', { align: 'justify', lineGap: 3 }
    );
    doc.moveDown(1);

    doc.font('Helvetica-Bold').text('1. Definitions');
    doc.font('Helvetica').text('Terms used, but not otherwise defined, in this Agreement shall have the same meaning as those terms in 45 CFR § 160.103 and § 164.501.', { align: 'justify', lineGap: 3 });
    doc.moveDown(1);

    doc.font('Helvetica-Bold').text('2. Obligations and Activities of Business Associate');
    doc.font('Helvetica').text('Business Associate agrees to not use or disclose PHI other than as permitted or required by the Agreement or as required by law. Business Associate shall use appropriate safeguards to prevent use or disclosure of PHI. Business Associate agrees to report to Covered Entity any use or disclosure of PHI not provided for by the Agreement, including breaches of unsecured PHI.', { align: 'justify', lineGap: 3 });
    doc.moveDown(1);

    doc.font('Helvetica-Bold').text('3. Permitted Uses and Disclosures');
    doc.font('Helvetica').text('Business Associate may use or disclose PHI to perform functions, activities, or services for, or on behalf of, Covered Entity as specified in the service agreements.', { align: 'justify', lineGap: 3 });
    doc.moveDown(1);

    doc.font('Helvetica-Bold').text('4. Term and Termination');
    doc.font('Helvetica').text('This Agreement shall be effective as of the Effective Date and terminate when all PHI provided by Covered Entity to Business Associate is destroyed or returned.', { align: 'justify', lineGap: 3 });
    doc.moveDown(1);

    doc.font('Helvetica-Bold').text('5. Miscellaneous');
    doc.font('Helvetica').text('This Agreement shall be governed by and construed in accordance with the laws of the State of Ohio. The parties agree to amend this Agreement from time to time as necessary to comply with the requirements of HIPAA.', { align: 'justify', lineGap: 3 });
    doc.moveDown(2);

    doc.font('Helvetica-Bold').text('IN WITNESS WHEREOF, the parties hereto have executed this Business Associate Agreement below.');
    doc.moveDown(2);

    // SIGNATURE BLOCKS
    const sigY = doc.y;

    // Clinic Signature Block
    doc.font('Helvetica-Bold').text('COVERED ENTITY', 50, sigY);
    doc.font('Helvetica').text(`Name: ${clinic.clinic_name}`, 50, sigY + 15);
    doc.text(`Signer: ${clinic.baa_signer_name} (${clinic.baa_signer_title})`, 50, sigY + 30);
    doc.text(`Date: ${effectiveDate}`, 50, sigY + 45);
    if (clinic.baa_signature) {
      const clinicImgBuffer = Buffer.from(clinic.baa_signature.replace(/^data:image\/\w+;base64,/, ""), 'base64');
      doc.image(clinicImgBuffer, 50, sigY + 60, { width: 200, height: 60 });
    }
    doc.moveTo(50, sigY + 120).lineTo(250, sigY + 120).stroke();

    // Admin Signature Block
    doc.font('Helvetica-Bold').text('BUSINESS ASSOCIATE', 300, sigY);
    doc.font('Helvetica').text('Name: DirectCare Pulmonary Diagnostics LLC', 300, sigY + 15);
    doc.text('Signer: Robert Beaty, MHA, RRT-ACCS', 300, sigY + 30);
    doc.text(`Date: ${effectiveDate}`, 300, sigY + 45);
    if (clinic.admin_signature) {
      const adminImgBuffer = Buffer.from(clinic.admin_signature.replace(/^data:image\/\w+;base64,/, ""), 'base64');
      doc.image(adminImgBuffer, 300, sigY + 60, { width: 200, height: 60 });
    }
    doc.moveTo(300, sigY + 120).lineTo(500, sigY + 120).stroke();

    doc.end();
  } catch (err) {
    console.error("PDF generation error:", err);
    res.status(500).json({ error: 'Failed to generate PDF package' });
  }
});

// (Leave all other standard endpoints exactly as they were: /api/auth/me, /api/users, /api/requests, etc. For brevity, I am omitting them here so you can just paste this over the top of the file up to the other endpoints.)
app.listen(PORT, () => { console.log(`DirectCare API Server listening on port ${PORT}`); });
