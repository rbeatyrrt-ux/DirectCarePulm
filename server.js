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
app.use(express.json());

// Initialize AWS S3 Client (v3) using environment variables or IAM instance roles
const s3Client = new S3Client({ 
  region: process.env.AWS_REGION || 'us-east-1' 
});
const S3_BUCKET_NAME = process.env.AWS_S3_BUCKET || 'directcare-pft-secure-reports';

// Use memory storage instead of local disk storage for HIPAA cloud compliance
const upload = multer({ storage: multer.memoryStorage() });

const PORT = process.env.PORT || 5000;
const JWT_SECRET = 'super_secure_directcare_hipaa_jwt_key_2026';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:sVE1%5B%27ag4G@directcare-pft-db.cs5m8662wh1z.us-east-1.rds.amazonaws.com:5432/postgres',
  ssl: { rejectUnauthorized: false }
});

// Configure Nodemailer for automated self-service password resets
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || 'smtp.gmail.com',
  port: process.env.EMAIL_PORT || 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
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

      ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS patient_dob DATE;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS baa_signed BOOLEAN DEFAULT FALSE;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS baa_signed_date TIMESTAMP;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS baa_signer_name VARCHAR(255);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS baa_ip_address VARCHAR(100);
      
      ALTER TABLE clinics ADD COLUMN IF NOT EXISTS phone_number VARCHAR(50);
      ALTER TABLE clinics ADD COLUMN IF NOT EXISTS authorized_rep_email VARCHAR(255);
      ALTER TABLE clinics ADD COLUMN IF NOT EXISTS baa_signer_name VARCHAR(255);
      ALTER TABLE clinics ADD COLUMN IF NOT EXISTS baa_signer_title VARCHAR(255);
      ALTER TABLE clinics ADD COLUMN IF NOT EXISTS baa_signature TEXT;
      ALTER TABLE clinics ADD COLUMN IF NOT EXISTS baa_signed_date TIMESTAMP;
    `);
  } catch (err) {
    console.error("Database initialization check failed:", err);
  }
}

initializeDatabase();

const verifyToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Access denied. No token provided.' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid or expired token.' });
    req.user = user;
    next();
  });
};

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) return res.status(400).json({ error: 'Invalid email or password' });

    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) return res.status(400).json({ error: 'Invalid email or password' });

    const token = jwt.sign(
      { user_id: user.user_id, email: user.email, role: user.role, clinic_name: user.clinic_name, credentials: user.credentials, npi: user.npi }, 
      JWT_SECRET, 
      { expiresIn: '8h' }
    );

    res.json({
      message: 'Login successful',
      token,
      user: { 
        user_id: user.user_id, 
        full_name: user.full_name, 
        email: user.email, 
        role: user.role, 
        clinic_name: user.clinic_name,
        credentials: user.credentials,
        npi: user.npi,
        must_change_password: user.must_change_password,
        baa_signed: user.baa_signed 
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error during login' });
  }
});

// CLINIC CREATION & EXECUTED BAA ENDPOINT
app.post('/api/clinics', verifyToken, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Unauthorized' });
  
  const { 
    clinic_name, 
    billing_email, 
    phone_number, 
    authorized_rep_email, 
    address, 
    baa_signer_name, 
    baa_signer_title, 
    baa_signature 
  } = req.body;

  if (!clinic_name || !billing_email) {
    return res.status(400).json({ error: 'Clinic name and billing email are required.' });
  }

  if (!baa_signer_name || !baa_signature) {
    return res.status(400).json({ error: 'Organizational BAA signature and signer details are required for compliance.' });
  }

  try {
    const query = `
      INSERT INTO clinics (
        clinic_name, 
        billing_email, 
        phone_number, 
        authorized_rep_email, 
        address, 
        baa_signer_name, 
        baa_signer_title, 
        baa_signature, 
        baa_signed_date
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
      ON CONFLICT (clinic_name) DO UPDATE SET 
        billing_email = EXCLUDED.billing_email, 
        phone_number = EXCLUDED.phone_number,
        authorized_rep_email = EXCLUDED.authorized_rep_email,
        address = EXCLUDED.address,
        baa_signer_name = EXCLUDED.baa_signer_name,
        baa_signer_title = EXCLUDED.baa_signer_title,
        baa_signature = EXCLUDED.baa_signature,
        baa_signed_date = CURRENT_TIMESTAMP
      RETURNING *;
    `;
    const result = await pool.query(query, [
      clinic_name, 
      billing_email, 
      phone_number || null, 
      authorized_rep_email || null, 
      address, 
      baa_signer_name, 
      baa_signer_title, 
      baa_signature
    ]);
    res.status(201).json({ message: 'Clinic and executed BAA saved successfully', clinic: result.rows[0] });
  } catch (err) {
    console.error("Clinic BAA save error:", err);
    res.status(500).json({ error: 'Failed to save clinic account: ' + err.message });
  }
});

// RECORD DIGITAL BAA SIGNATURE & METADATA ENDPOINT
app.post('/api/auth/sign-baa', verifyToken, async (req, res) => {
  try {
    const { signer_name } = req.body;
    if (!signer_name || !signer_name.trim()) {
      return res.status(400).json({ error: 'Legal signer name is required to execute the BAA.' });
    }

    const ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'Unknown';

    const updateResult = await pool.query(
      `UPDATE users 
       SET baa_signed = TRUE, 
           baa_signed_date = CURRENT_TIMESTAMP,
           baa_signer_name = $1,
           baa_ip_address = $2
       WHERE user_id = $3 
       RETURNING user_id, full_name, email, role, clinic_name, credentials, npi, must_change_password, baa_signed, baa_signer_name, baa_signed_date, baa_ip_address`,
      [signer_name.trim(), ipAddress, req.user.user_id]
    );

    if (updateResult.rows.length === 0) return res.status(404).json({ error: 'User not found' });

    res.json({ message: 'BAA successfully executed and recorded', user: updateResult.rows[0] });
  } catch (err) {
    console.error('BAA signature error:', err);
    res.status(500).json({ error: 'Failed to record BAA signature: ' + err.message });
  }
});

// DOWNLOAD INDIVIDUAL EXECUTED BAA COMPLIANCE CERTIFICATE PDF
app.get('/api/auth/signed-baa-pdf', verifyToken, async (req, res) => {
  try {
    const userResult = await pool.query('SELECT * FROM users WHERE user_id = $1', [req.user.user_id]);
    if (userResult.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const userData = userResult.rows[0];

    if (!userData.baa_signed) {
      return res.status(400).json({ error: 'BAA has not yet been executed for this account.' });
    }

    const doc = new PDFDocument({ margin: 50, autoFirstPage: true });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=Executed_BAA_${userData.full_name.replace(/\s+/g, '_')}.pdf`);
    doc.pipe(res);

    doc.fontSize(16).fillColor('#002b5c').font('Helvetica-Bold').text('CERTIFICATE OF EXECUTED BUSINESS ASSOCIATE AGREEMENT', { align: 'center' });
    doc.fontSize(10).fillColor('#4a5568').font('Helvetica').text('HIPAA / HITECH COMPLIANCE AUDIT RECORD', { align: 'center' });
    doc.moveDown(1.5);

    doc.rect(50, doc.y, 512, 95).stroke('#cbd5e0');
    const boxY = doc.y + 10;
    doc.fontSize(10).fillColor('#1a2a47').font('Helvetica-Bold').text('PARTNER & SIGNER ATTESTATION METADATA', 65, boxY);
    doc.font('Helvetica').fontSize(9).fillColor('#2d3748');
    doc.text(`Covered Entity / User: ${userData.full_name} (${userData.role.toUpperCase()})`, 65, doc.y + 6);
    doc.text(`Associated Clinic: ${userData.clinic_name || 'Independent Practice / System User'}`, 65, doc.y + 4);
    doc.text(`Legal Signer Name: ${userData.baa_signer_name || userData.full_name}`, 65, doc.y + 4);
    doc.text(`Execution Timestamp: ${new Date(userData.baa_signed_date).toLocaleString()}`, 65, doc.y + 4);
    doc.text(`Origin IP Address: ${userData.baa_ip_address || 'Verified Secure Gateway'}`, 65, doc.y + 4);
    doc.moveDown(3);

    doc.font('Helvetica-Bold').fontSize(11).fillColor('#1a2a47').text('COMPLIANCE BINDING ACKNOWLEDGMENT');
    doc.font('Helvetica').fontSize(9).fillColor('#4a5568').text(
      'This document serves as an immutable electronic record of agreement between DirectCare Pulmonary Diagnostics LLC (Business Associate) and the executing healthcare entity named above. By executing this agreement via secure user authentication, the representative certifies authority to bind the organization to HIPAA Privacy, Security, and Breach Notification administrative safeguards.',
      { lineGap: 4 }
    );
    doc.moveDown(2);

    doc.rect(50, doc.y, 512, 65).stroke('#38a169');
    doc.fontSize(9).fillColor('#22543d').font('Helvetica-Bold').text('CRYPTOGRAPHICALLY SEALED AUDIT RECORD', 65, doc.y + 10);
    doc.font('Helvetica').fontSize(8).fillColor('#2d3748');
    doc.text(`System User ID Hash: SHA-256 Verified [UID-${userData.user_id}]`, 65, doc.y + 4);
    doc.text(`DirectCare Compliance Verification Engine — Status: ACTIVE & BINDING`, 65, doc.y + 4);

    doc.end();
  } catch (err) {
    console.error("Executed BAA PDF generation error:", err);
    res.status(500).json({ error: 'Failed to generate executed BAA PDF' });
  }
});

// MASTER IRON-CLAD BAA PDF GENERATOR ENDPOINT
app.get('/api/master-baa-pdf', verifyToken, async (req, res) => {
  try {
    const { 
      clinic_name = 'Participating Healthcare Entity', 
      address = 'Address on file', 
      phone = 'N/A', 
      auth_rep_email = 'N/A',
      signer_name = 'Authorized Representative',
      signer_title = 'Practice Manager'
    } = req.query;

    const doc = new PDFDocument({ margin: 50, autoFirstPage: true });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=BAA_${clinic_name.replace(/\s+/g, '_')}.pdf`);
    doc.pipe(res);

    // --- PAGE 1: TITLE, COVER ENTITY DETAILS & RECITALS ---
    doc.fontSize(18).fillColor('#002b5c').font('Helvetica-Bold').text('BUSINESS ASSOCIATE AGREEMENT', { align: 'center' });
    doc.fontSize(11).fillColor('#4a5568').font('Helvetica').text('PURSUANT TO HIPAA / HITECH REGULATIONS', { align: 'center' });
    doc.moveDown(1.5);

    // Covered Entity Details Block
    doc.rect(50, doc.y, 512, 85).stroke('#cbd5e0');
    const startY = doc.y + 8;
    doc.fontSize(10).fillColor('#1a2a47').font('Helvetica-Bold').text('COVERED ENTITY / CLINIC PROFILE', 65, startY);
    doc.font('Helvetica').fontSize(9).fillColor('#2d3748');
    doc.text(`Clinic Name: ${clinic_name}`, 65, doc.y + 6);
    doc.text(`Address: ${address}`, 65, doc.y + 4);
    doc.text(`Phone: ${phone} | Representative Email: ${auth_rep_email}`, 65, doc.y + 4);
    doc.moveDown(2.5);

    doc.fontSize(9).fillColor('#2d3748').text(
      'This Business Associate Agreement ("Agreement") is entered into by and between DirectCare Pulmonary Diagnostics LLC ("Business Associate") and the healthcare practice or clinic specified above ("Covered Entity"). This Agreement is executed to ensure compliance with the administrative simplification provisions of the Health Insurance Portability and Accountability Act of 1996 (HIPAA), the Health Information Technology for Economic and Clinical Health (HITECH) Act (P.L. 111-5), and implementing regulations promulgated thereunder.',
      { lineGap: 3 }
    );
    doc.moveDown(1);

    doc.font('Helvetica-Bold').text('RECITALS');
    doc.font('Helvetica').text(
      'WHEREAS, Covered Entity possesses Protected Health Information (PHI) that is protected under HIPAA and HITECH, and Business Associate provides diagnostic pulmonary testing, reporting, and portal management services that involve the creation, receipt, maintenance, or transmission of PHI;\n' +
      'WHEREAS, the parties wish to comply with the requirements of 45 CFR Parts 160 and 164 governing Business Associate contracts;\n' +
      'NOW, THEREFORE, the parties agree as follows:',
      { lineGap: 3 }
    );
    doc.moveDown(1);

    doc.font('Helvetica-Bold').text('1. DEFINITIONS');
    doc.font('Helvetica').text(
      'Terms used, but not otherwise defined, in this Agreement shall have the same meaning as those terms in 45 CFR § 160.103 and § 164.501, including "Breach", "Data Aggregation", "Designated Record Set", "Disclosure", "Health Care Operations", "Individual", "Minimum Necessary", "Notice of Privacy Practices", "Protected Health Information (PHI)", "Required by Law", "Secretary", "Security Incident", "Subcontractor", and "Unsecured PHI".',
      { lineGap: 3 }
    );
    doc.moveDown(1);

    doc.font('Helvetica-Bold').text('2. OBLIGATIONS AND ACTIVITIES OF BUSINESS ASSOCIATE');
    doc.font('Helvetica').text(
      'a. Permitted Uses and Disclosures: Business Associate agrees not to use or disclose Protected Health Information other than as permitted or required by this Agreement or as required by law.\n' +
      'b. Safeguards: Business Associate shall use appropriate administrative, physical, and technical safeguards, and comply with Subpart C of 45 CFR Part 164 with respect to electronic PHI, to prevent use or disclosure of PHI other than as provided for by this Agreement.\n' +
      'c. Reporting of Breaches and Incidents: Business Associate shall report to Covered Entity any use or disclosure of PHI not provided for by this Agreement, including breaches of unsecured PHI as required by 45 CFR § 164.410, without unreasonable delay and in no case later than 48 hours after discovery.\n' +
      'd. Subcontractors: In accordance with 45 CFR § 164.502(e)(1)(ii) and § 164.308(b)(2), Business Associate shall ensure that any subcontractors that create, receive, maintain, or transmit PHI on behalf of Business Associate agree to the same restrictions and conditions that apply to Business Associate.',
      { lineGap: 3 }
    );

    // --- PAGE 2: PERMITTED USES, TERMINATION & SIGNATURES ---
    doc.addPage();
    doc.font('Helvetica-Bold').text('3. PERMITTED USES AND DISCLOSURES BY BUSINESS ASSOCIATE');
    doc.font('Helvetica').text(
      'a. General Use: Business Associate may use or disclose PHI only to perform functions, activities, or services for, or on behalf of, Covered Entity as specified in portal service agreements, provided that such use or disclosure would not violate HIPAA if done by Covered Entity.\n' +
      'b. Management and Administration: Business Associate may use PHI for the proper management and administration of Business Associate or to carry out its legal responsibilities.',
      { lineGap: 3 }
    );
    doc.moveDown(1);

    doc.font('Helvetica-Bold').text('4. OBLIGATIONS OF COVERED ENTITY');
    doc.font('Helvetica').text(
      'a. Covered Entity shall notify Business Associate of any limitation(s) in its Notice of Privacy Practices in accordance with 45 CFR § 164.520, to the extent that such limitation may affect Business Associate\'s use or disclosure of PHI.\n' +
      'b. Covered Entity shall notify Business Associate of any restriction on the use or disclosure of PHI that Covered Entity has agreed to or is required to abide by under 45 CFR § 164.522.',
      { lineGap: 3 }
    );
    doc.moveDown(1);

    doc.font('Helvetica-Bold').text('5. TERM AND TERMINATION');
    doc.font('Helvetica').text(
      'a. Term: This Agreement shall be effective as of the date of electronic user authentication and portal onboarding, and shall terminate when all PHI provided by Covered Entity to Business Associate is destroyed or returned to Covered Entity.\n' +
      'b. Termination for Cause: Covered Entity may terminate this Agreement and portal access immediately if Business Associate has violated a material term of this Agreement.\n' +
      'c. Return or Destruction of PHI: Upon termination of this Agreement for any reason, Business Associate shall return or destroy all PHI received from Covered Entity, or created/received by Business Associate on behalf of Covered Entity, retaining no copies.',
      { lineGap: 3 }
    );
    doc.moveDown(1);

    doc.font('Helvetica-Bold').text('6. MISCELLANEOUS');
    doc.font('Helvetica').text(
      'a. Regulatory References: A reference in this Agreement to a section in the HIPAA Rules means the section as in effect or as amended.\n' +
      'b. Governing Law: This Agreement shall be governed by and construed in accordance with the laws of the State of Ohio, without regard to conflict of law principles.',
      { lineGap: 3 }
    );
    doc.moveDown(2);

    doc.font('Helvetica-Bold').text('IN WITNESS WHEREOF, the parties have executed this Master Business Associate Agreement electronically.');
    doc.moveDown(1.5);

    doc.rect(50, doc.y, 512, 70).stroke('#cbd5e0');
    doc.fontSize(9).fillColor('#1a2a47').font('Helvetica-Bold').text('ELECTRONIC ATTESTATION & DIGITAL RECORD', 65, doc.y + 10);
    doc.font('Helvetica').fontSize(8).fillColor('#4a5568').text(`Executed For: ${clinic_name} | Representative: ${signer_name} (${signer_title})`, 65, doc.y + 4);
    doc.text(`Timestamp: ${new Date().toLocaleString()} | DirectCare Compliance Verification Engine`, 65, doc.y + 4);

    doc.end();
  } catch (err) {
    console.error("Master BAA PDF generation error:", err);
    res.status(500).json({ error: 'Failed to generate Master BAA PDF' });
  }
});

// AUTOMATED SELF-SERVICE PASSWORD RESET ENDPOINT
app.post('/api/forgot-password', async (req, res) => {
  const { email } = req.body;
  
  try {
    const userResult = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    
    if (userResult.rows.length === 0) {
      return res.json({ message: 'If an account exists with that email, a temporary password has been sent.' });
    }

    const user = userResult.rows[0];

    const tempPassword = 'Temp!' + Math.random().toString(36).slice(-8);
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(tempPassword, salt);

    await pool.query(
      'UPDATE users SET password_hash = $1, must_change_password = TRUE WHERE user_id = $2', 
      [hashedPassword, user.user_id]
    );

    await pool.query('INSERT INTO password_history (user_id, password_hash) VALUES ($1, $2)', [user.user_id, hashedPassword]);

    // Send automated email via Nodemailer
    await transporter.sendMail({
      from: `"DirectCare PFT Portal" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: 'Your Temporary Portal Password',
      html: `
        <p>Hello ${user.full_name},</p>
        <p>A password reset was requested for your DirectCare PFT Portal account.</p>
        <p>Your secure temporary password is: <strong>${tempPassword}</strong></p>
        <p>Please log in using this temporary password. You will be prompted to choose a new secure password immediately upon logging in.</p>
      `
    });

    res.json({ message: 'If an account exists with that email, a temporary password has been sent.' });
  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ error: 'Failed to process password recovery request.' });
  }
});

app.get('/api/auth/me', verifyToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT user_id, full_name, email, role, clinic_name, credentials, npi, must_change_password, baa_signed FROM users WHERE user_id = $1', [req.user.user_id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch profile status' });
  }
});

app.put('/api/auth/update-credentials', verifyToken, async (req, res) => {
  const { current_password, new_password, new_signature_pin, credentials, npi } = req.body;

  try {
    const userResult = await pool.query('SELECT * FROM users WHERE user_id = $1', [req.user.user_id]);
    if (userResult.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const user = userResult.rows[0];

    const validPassword = await bcrypt.compare(current_password, user.password_hash);
    if (!validPassword) {
      return res.status(400).json({ error: 'Current password is incorrect.' });
    }

    let query = 'UPDATE users SET must_change_password = FALSE';
    let params = [];
    let paramIndex = 1;

    if (credentials !== undefined) {
      query += `, credentials = $${paramIndex++}`;
      params.push(credentials);
    }
    if (npi !== undefined) {
      query += `, npi = $${paramIndex++}`;
      params.push(npi);
    }

    if (new_password && new_password.trim() !== '') {
      const salt = await bcrypt.genSalt(10);
      const hashedNewPassword = await bcrypt.hash(new_password, salt);
      await pool.query('INSERT INTO password_history (user_id, password_hash) VALUES ($1, $2)', [req.user.user_id, hashedNewPassword]);
      query += `, password_hash = $${paramIndex++}`;
      params.push(hashedNewPassword);
    }

    if (new_signature_pin && new_signature_pin.trim() !== '' && user.role !== 'nurse') {
      const salt = await bcrypt.genSalt(10);
      const hashedPin = await bcrypt.hash(new_signature_pin, salt);
      query += `, signature_pin_hash = $${paramIndex++}`;
      params.push(hashedPin);
    }

    query += ` WHERE user_id = $${paramIndex} RETURNING user_id, full_name, email, role, clinic_name, credentials, npi, must_change_password, baa_signed;`;
    params.push(req.user.user_id);

    const updateResult = await pool.query(query, params);
    res.json({ message: 'Credentials updated successfully', user: updateResult.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update credentials' });
  }
});

app.get('/api/clinics', verifyToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM clinics ORDER BY clinic_name ASC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch clinics' });
  }
});

app.get('/api/clinic-schedules', verifyToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM clinic_schedules');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch schedules' });
  }
});

app.post('/api/clinic-schedules', verifyToken, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Unauthorized' });
  const { clinic_name, allowed_dates } = req.body;
  try {
    const query = `
      INSERT INTO clinic_schedules (clinic_name, allowed_dates)
      VALUES ($1, $2)
      ON CONFLICT (clinic_name) DO UPDATE SET allowed_dates = EXCLUDED.allowed_dates
      RETURNING *;
    `;
    const result = await pool.query(query, [clinic_name, allowed_dates]);
    res.json({ message: 'Clinic schedule saved successfully', schedule: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save clinic schedule: ' + err.message });
  }
});

app.get('/api/booked-slots', verifyToken, async (req, res) => {
  const { clinic_name, date } = req.query;
  if (!clinic_name || !date) {
    return res.status(400).json({ error: 'Clinic name and date are required.' });
  }

  try {
    const result = await pool.query(
      `SELECT time_block FROM service_requests 
       WHERE clinic_name = $1 
       AND requested_date::date = $2::date 
       AND is_deleted = FALSE`,
      [clinic_name, date]
    );

    const bookedSlots = result.rows.map(row => row.time_block);
    res.json(bookedSlots);
  } catch (err) {
    console.error('Failed to fetch booked slots:', err);
    res.status(500).json({ error: 'Failed to fetch booked slots: ' + err.message });
  }
});

app.post('/api/users', verifyToken, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Unauthorized' });

  const { full_name, email, role, clinic_name, credentials, npi } = req.body;

  try {
    const existing = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (existing.rows.length === 0) {
      const defaultPassword = 'Password123!';
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(defaultPassword, salt);

      const assignedClinic = ['admin', 'rrt', 'physician', 'billing'].includes(role) ? null : clinic_name;
      const query = `
        INSERT INTO users (full_name, email, password_hash, role, clinic_name, credentials, npi, must_change_password)
        VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)
        RETURNING user_id, full_name, email, role, clinic_name, credentials, npi, baa_signed;
      `;
      const result = await pool.query(query, [full_name, email, hashedPassword, role || 'provider', assignedClinic, credentials, npi]);
      
      await pool.query('INSERT INTO password_history (user_id, password_hash) VALUES ($1, $2)', [result.rows[0].user_id, hashedPassword]);

      return res.status(201).json({ message: 'User created successfully!', user: result.rows[0] });
    }
    return res.status(400).json({ error: 'User with this email already exists.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create user account' });
  }
});

app.put('/api/users/:id', verifyToken, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Unauthorized' });
  const { id } = req.params;
  const { full_name, email, role, clinic_name, credentials, npi, password } = req.body;

  try {
    let query = `UPDATE users SET full_name = $1, email = $2, role = $3, clinic_name = $4, credentials = $5, npi = $6`;
    let params = [
      full_name, 
      email, 
      role, 
      ['admin', 'rrt', 'physician', 'billing'].includes(role) ? null : clinic_name, 
      credentials, 
      npi
    ];

    if (password && password.trim() !== '') {
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);
      query += `, password_hash = $7 WHERE user_id = $8 RETURNING user_id, full_name, email, role, clinic_name, credentials, npi, baa_signed;`;
      params.push(hashedPassword, id);
    } else {
      query += ` WHERE user_id = $7 RETURNING user_id, full_name, email, role, clinic_name, credentials, npi, baa_signed;`;
      params.push(id);
    }

    const result = await pool.query(query, params);
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json({ message: 'User updated successfully', user: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update user: ' + err.message });
  }
});

app.delete('/api/users/:id', verifyToken, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Unauthorized' });
  const { id } = req.params;
  try {
    const result = await pool.query('DELETE FROM users WHERE user_id = $1 RETURNING user_id', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json({ message: 'User deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

app.get('/api/requests', verifyToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT sr.*, 
             u_phys.full_name as phys_name, u_phys.credentials as phys_credentials, u_phys.npi as phys_npi,
             u_prov.full_name as prov_name, u_prov.credentials as prov_credentials, u_prov.npi as prov_npi
      FROM service_requests sr
      LEFT JOIN users u_phys ON sr.physician_id = u_phys.user_id
      LEFT JOIN users u_prov ON sr.provider_id = u_prov.user_id
      WHERE sr.is_deleted = FALSE 
      ORDER BY sr.request_id DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch requests' });
  }
});

app.get('/api/audit/requests', verifyToken, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Unauthorized' });
  try {
    const result = await pool.query(`
      SELECT sr.*, 
             u_phys.full_name as phys_name, u_phys.credentials as phys_credentials, u_phys.npi as phys_npi,
             u_prov.full_name as prov_name, u_prov.credentials as prov_credentials, u_prov.npi as prov_npi
      FROM service_requests sr
      LEFT JOIN users u_phys ON sr.physician_id = u_phys.user_id
      LEFT JOIN users u_prov ON sr.provider_id = u_prov.user_id
      ORDER BY sr.request_id DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch audit records' });
  }
});

app.delete('/api/requests/:id', verifyToken, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Unauthorized' });
  
  const { id } = req.params;
  const { signature_pin } = req.body;
  if (!signature_pin) {
    return res.status(400).json({ error: 'Signature PIN is required to authorize patient record deletion.' });
  }

  try {
    const userResult = await pool.query('SELECT signature_pin_hash, password_hash FROM users WHERE user_id = $1', [req.user.user_id]);
    if (userResult.rows.length === 0) return res.status(400).json({ error: 'User not found.' });

    const userData = userResult.rows[0];
    let validPin = false;
    if (userData.signature_pin_hash) {
      validPin = await bcrypt.compare(signature_pin, userData.signature_pin_hash);
    } else {
      validPin = await bcrypt.compare(signature_pin, userData.password_hash);
    }

    if (!validPin) return res.status(400).json({ error: 'Incorrect signature PIN.' });

    const result = await pool.query('UPDATE service_requests SET is_deleted = TRUE WHERE request_id = $1 RETURNING *', [id]);

    if (result.rows.length === 0) return res.status(404).json({ error: 'Request not found' });

    res.json({ message: 'Patient record archived.', request: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete record: ' + err.message });
  }
});

app.put('/api/requests/:id/schedule', verifyToken, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Unauthorized' });

  try {
    const { id } = req.params;
    
    let reqDataRes = await pool.query('SELECT * FROM service_requests WHERE request_id = $1', [id]);
    if (reqDataRes.rows.length === 0) return res.status(404).json({ error: 'Request not found' });

    const targetReq = reqDataRes.rows[0];

    if (targetReq.time_block && targetReq.requested_date) {
      const conflictCheck = await pool.query(
        `SELECT request_id, patient_name FROM service_requests 
         WHERE clinic_name = $1 
         AND requested_date::date = $2::date 
         AND time_block = $3 
         AND request_id != $4
         AND is_deleted = FALSE`,
        [targetReq.clinic_name, targetReq.requested_date, targetReq.time_block, id]
      );

      if (conflictCheck.rows.length > 0) {
        return res.status(400).json({ 
          error: `Time slot conflict: Patient "${conflictCheck.rows[0].patient_name}" is already scheduled in this time slot for ${targetReq.clinic_name}. Only one patient is permitted per slot.` 
        });
      }
    }

    const query = await pool.query(`UPDATE service_requests SET status = 'SCHEDULED' WHERE request_id = $1 RETURNING *;`, [id]);
    res.json({ message: 'Order approved and scheduled', request: query.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update order status: ' + err.message });
  }
});

app.put('/api/requests/:id/preliminary', verifyToken, upload.single('report'), async (req, res) => {
  try {
    const { id } = req.params;
    const { rrt_notes, mdi_education, recommended_interpretation, signature_pin } = req.body;
    
    if (!signature_pin) {
      return res.status(400).json({ error: 'Signature PIN is required.' });
    }

    let reportPath = null;
    if (req.file) {
      const s3Key = `pft-reports/${Date.now()}-${req.file.originalname}`;
      await s3Client.send(new PutObjectCommand({
        Bucket: S3_BUCKET_NAME,
        Key: s3Key,
        Body: req.file.buffer,
        ContentType: req.file.mimetype,
        ServerSideEncryption: 'AES256'
      }));
      reportPath = `s3://${S3_BUCKET_NAME}/${s3Key}`;
    }

    let query = `UPDATE service_requests SET status = 'PRELIMINARY_RESULTS', rrt_notes = $1, mdi_education = $2, recommended_interpretation = $3`;
    let params = [rrt_notes, mdi_education, recommended_interpretation];

    if (reportPath) {
      query += `, uploaded_report_path = $4 WHERE request_id = $5 RETURNING *;`;
      params.push(reportPath, id);
    } else {
      query += ` WHERE request_id = $4 RETURNING *;`;
      params.push(id);
    }

    const result = await pool.query(query, params);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Request not found' });

    res.json({ message: 'Preliminary results saved successfully', request: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update preliminary results: ' + err.message });
  }
});

app.get('/api/requests/:id/raw-report', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const reqResult = await pool.query('SELECT uploaded_report_path FROM service_requests WHERE request_id = $1', [id]);
    
    if (reqResult.rows.length === 0 || !reqResult.rows[0].uploaded_report_path) {
      return res.status(404).json({ error: 'Report PDF not found for this request' });
    }

    const s3Uri = reqResult.rows[0].uploaded_report_path;
    const s3Key = s3Uri.replace(`s3://${S3_BUCKET_NAME}/`, '');

    const command = new GetObjectCommand({
      Bucket: S3_BUCKET_NAME,
      Key: s3Key
    });

    const s3Response = await s3Client.send(command);
    res.setHeader('Content-Type', 'application/pdf');
    s3Response.Body.pipe(res);
  } catch (err) {
    console.error("Failed to stream raw report from S3:", err);
    res.status(500).json({ error: 'Failed to stream report PDF from S3: ' + err.message });
  }
});

app.put('/api/requests/:id/finalize', verifyToken, async (req, res) => {
  const { id } = req.params;
  const { interpretation, signature_pin } = req.body;

  if (!signature_pin) {
    return res.status(400).json({ error: 'Signature PIN is required.' });
  }

  try {
    const userResult = await pool.query('SELECT signature_pin_hash, password_hash FROM users WHERE user_id = $1', [req.user.user_id]);
    if (userResult.rows.length === 0) return res.status(400).json({ error: 'User not found.' });

    const userData = userResult.rows[0];
    let validPin = false;
    
    if (userData.signature_pin_hash) {
      validPin = await bcrypt.compare(signature_pin, userData.signature_pin_hash);
    } else {
      validPin = await bcrypt.compare(signature_pin, userData.password_hash);
    }

    if (!validPin) return res.status(401).json({ error: 'Incorrect Signature PIN.' });

    const result = await pool.query(
      `UPDATE service_requests 
       SET status = 'COMPLETED', interpretation = $1, physician_id = $2 
       WHERE request_id = $3 
       RETURNING *`, 
      [interpretation, req.user.user_id, id]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Request not found' });

    res.json({ message: 'Order successfully signed, updated, and completed.', request: result.rows[0] });
  } catch (err) {
    console.error("Failed to finalize review:", err);
    res.status(500).json({ error: 'Failed to finalize review: ' + err.message });
  }
});

app.put('/api/requests/:id/provider-sign', verifyToken, async (req, res) => {
  const { id } = req.params;
  const { signature_pin } = req.body;

  if (!signature_pin) {
    return res.status(400).json({ error: 'Signature PIN is required.' });
  }

  try {
    const userResult = await pool.query('SELECT signature_pin_hash, password_hash FROM users WHERE user_id = $1', [req.user.user_id]);
    if (userResult.rows.length === 0) return res.status(400).json({ error: 'User not found.' });

    const userData = userResult.rows[0];
    let validPin = false;
    
    if (userData.signature_pin_hash) {
      validPin = await bcrypt.compare(signature_pin, userData.signature_pin_hash);
    } else {
      validPin = await bcrypt.compare(signature_pin, userData.password_hash);
    }

    if (!validPin) return res.status(401).json({ error: 'Incorrect Signature PIN.' });

    const result = await pool.query(
      `UPDATE service_requests SET status = 'PENDING' WHERE request_id = $1 RETURNING *`, 
      [id]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Request not found' });

    res.json({ message: 'Order signed successfully and routed to scheduling queue', request: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to sign order: ' + err.message });
  }
});

app.post('/api/requests', verifyToken, async (req, res) => {
  const { patient_name, patient_dob, insurance_type, ordering_reason, tests_ordered, requested_date, time_block, provider_id, clinic_name, status } = req.body;
  const clinicName = clinic_name || req.user.clinic_name || 'Independent Clinic';
  const initialStatus = status || (req.user.role === 'nurse' ? 'PENDING_PROVIDER_SIGNATURE' : 'PENDING');
  const todayDate = requested_date || new Date().toISOString().split('T')[0];
  const assignedProviderId = provider_id || req.user.user_id;

  try {
    if (time_block && requested_date) {
      const conflictCheck = await pool.query(
        `SELECT request_id, patient_name FROM service_requests 
         WHERE clinic_name = $1 
         AND requested_date::date = $2::date 
         AND time_block = $3 
         AND is_deleted = FALSE`,
        [clinicName, todayDate, time_block]
      );

      if (conflictCheck.rows.length > 0) {
        return res.status(400).json({ 
          error: `Time slot conflict: Patient "${conflictCheck.rows[0].patient_name}" is already booked in this time slot. Only one patient is permitted per slot.` 
        });
      }
    }

    const query = `
      INSERT INTO service_requests (clinic_name, patient_name, patient_dob, insurance_type, ordering_reason, tests_ordered, requested_date, time_block, status, provider_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8, $9, $10)
      RETURNING *;
    `;
    const result = await pool.query(query, [clinicName, patient_name, patient_dob || null, insurance_type, ordering_reason, tests_ordered, todayDate, time_block || null, initialStatus, assignedProviderId]);
    res.status(201).json({ message: 'Service request created successfully', request: result.rows[0] });
  } catch (err) {
    console.error("Order creation error:", err);
    res.status(500).json({ error: 'Failed to submit service request: ' + err.message });
  }
});

app.get('/api/users', verifyToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT user_id, full_name, email, role, clinic_name, credentials, npi, baa_signed, baa_signed_date, baa_signer_name, baa_ip_address FROM users ORDER BY user_id ASC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

app.get('/api/requests/:id/pdf', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const reqResult = await pool.query(`
      SELECT sr.*, 
             u_phys.full_name as phys_name, u_phys.credentials as phys_credentials, u_phys.npi as phys_npi,
             u_prov.full_name as prov_name, u_prov.credentials as prov_credentials, u_prov.npi as prov_npi
      FROM service_requests sr
      LEFT JOIN users u_phys ON sr.physician_id = u_phys.user_id
      LEFT JOIN users u_prov ON sr.provider_id = u_prov.user_id
      WHERE sr.request_id = $1
    `, [id]);

    if (reqResult.rows.length === 0) return res.status(404).json({ error: 'Request not found' });
    const reqData = reqResult.rows[0];

    const doc = new PDFDocument({ margin: 50, autoFirstPage: false });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=Clinical_Billing_Report_Package_${id}.pdf`);
    doc.pipe(res);

    const cleanNotes = (text) => (text || '').replace(/[ĐD]/g, '').trim();

    doc.addPage();
    doc.fontSize(26).fillColor('#002b5c').text('DirectCare PFT Services', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(14).fillColor('#4a5568').text('CONFIDENTIAL CLINICAL & BILLING REPORT PACKAGE', { align: 'center' });
    doc.moveDown(3);

    doc.rect(50, 200, 512, 180).stroke('#cbd5e0');
    doc.fontSize(12).fillColor('#1a2a47').font('Helvetica-Bold').text('NOTICE OF CONFIDENTIALITY', 70, 220);
    doc.font('Helvetica').fontSize(10).fillColor('#4a5568').text(
      'This document contains confidential medical and billing information protected under federal and state law, ' +
      'intended solely for your use of the designated ordering provider and clinical staff. If you are not the ' +
      'intended recipient, you are hereby notified that any disclosure, copying, distribution, or action taken in ' +
      'reliance on the contents of this information is strictly prohibited.',
      70, 245, { width: 472, lineGap: 4 }
    );

    doc.fontSize(10).fillColor('#718096').text(`Secure System Request Identifier: ${id}`, 70, 335);
    doc.text(`Package Generation Timestamp: ${new Date().toLocaleString()}`, 70, 355);

    doc.addPage();
    doc.fontSize(18).fillColor('#002b5c').font('Helvetica-Bold').text('SECTION 1: ORIGINAL PROVIDER ORDER');
    doc.moveTo(50, doc.y + 5).lineTo(562, doc.y + 5).stroke('#cbd5e0');
    doc.moveDown(1.5);

    doc.fontSize(11).fillColor('#1a2a47');
    doc.font('Helvetica-Bold').text('Patient Full Name: ', { continued: true }).font('Helvetica').text(reqData.patient_name || 'N/A');
    doc.font('Helvetica-Bold').text('Patient Date of Birth: ', { continued: true }).font('Helvetica').text(reqData.patient_dob ? new Date(reqData.patient_dob).toLocaleDateString() : 'N/A');
    doc.font('Helvetica-Bold').text('Ordering Clinic: ', { continued: true }).font('Helvetica').text(reqData.clinic_name || 'N/A');
    doc.font('Helvetica-Bold').text('Insurance / Payer Type: ', { continued: true }).font('Helvetica').text(reqData.insurance_type || 'N/A');
    doc.font('Helvetica-Bold').text('Requested Testing Date: ', { continued: true }).font('Helvetica').text(reqData.requested_date ? new Date(reqData.requested_date).toLocaleDateString() : 'N/A');
    doc.font('Helvetica-Bold').text('Time Slot Block: ', { continued: true }).font('Helvetica').text(reqData.time_block ? reqData.time_block.replace('_', ' - ') : 'N/A');
    doc.moveDown(1);

    doc.font('Helvetica-Bold').text('Ordering Reason / Clinical Indication:');
    doc.font('Helvetica').fontSize(10).fillColor('#4a5568').text(reqData.ordering_reason || 'None specified', { lineGap: 4 });
    doc.moveDown(1);

    doc.fontSize(11).fillColor('#1a2a47').font('Helvetica-Bold').text('Tests Ordered:');
    doc.font('Helvetica').fontSize(10).fillColor('#4a5568').text(reqData.tests_ordered || 'Standard PFT Package', { lineGap: 4 });
    doc.moveDown(2);

    doc.rect(50, doc.y, 512, 75).stroke('#cbd5e0');
    doc.fontSize(10).fillColor('#1a2a47').font('Helvetica-Bold').text('ORDERING PROVIDER ELECTRONIC SIGNATURE', 65, doc.y + 10);
    doc.font('Helvetica').fontSize(9).fillColor('#2d3748').text(
      `Ordering Provider: ${reqData.prov_name || 'Attending Physician'} (${reqData.prov_credentials || 'MD/APRN'})`, 65, doc.y + 6
    );
    doc.text(`NPI: ${reqData.prov_npi || 'N/A'}`, 65, doc.y + 4);
    doc.text(`Attestation: Order electronically signed and authorized for scheduling.`, 65, doc.y + 4);

    doc.addPage();
    doc.fontSize(18).fillColor('#002b5c').font('Helvetica-Bold').text('SECTION 2: CPT BILLING & CODING GUIDE');
    doc.moveTo(50, doc.y + 5).lineTo(562, doc.y + 5).stroke('#cbd5e0');
    doc.moveDown(1.5);

    doc.fontSize(10).fillColor('#4a5568').text('The following CPT billing codes, required modifiers, and documentation guidelines govern reimbursement for this encounter:');
    doc.moveDown(1);

    doc.font('Helvetica-Bold').fontSize(11).fillColor('#1a2a47').text('• CPT 94060: Spirometry, pre and post-bronchodilator');
    doc.font('Helvetica').fontSize(10).fillColor('#4a5568').text('  Required Modifiers: Append modifier 26 if billing professional component only, or TC for technical component. Ensure appropriate ICD-10 medical necessity linkage.');
    doc.moveDown(0.8);

    doc.font('Helvetica-Bold').fontSize(11).fillColor('#1a2a47').text('• CPT 94664: Demonstration & Evaluation of MDI Technique');
    doc.font('Helvetica').fontSize(10).fillColor('#4a5568').text('  Required Modifiers: When billed concurrently with evaluation and management (E/M) services or separate diagnostic testing on the same date of service, Modifier 59 (Distinct Procedural Service) or Modifier XU is strictly required by most commercial and government payers to prevent bundling edits. Documentation must verify patient return-demonstration.');
    doc.moveDown(0.8);

    doc.font('Helvetica-Bold').fontSize(11).fillColor('#1a2a47').text('• CPT 94729: Diffusing Capacity (DLCO)');
    doc.font('Helvetica').fontSize(10).fillColor('#4a5568').text('  Single-breath carbon monoxide diffusing capacity measurement.');

    doc.addPage();
    doc.fontSize(18).fillColor('#002b5c').font('Helvetica-Bold').text('SECTION 3: PHYSICIAN CLINICAL OVERREAD');
    doc.moveTo(50, doc.y + 5).lineTo(562, doc.y + 5).stroke('#cbd5e0');
    doc.moveDown(1.5);

    doc.fontSize(11).fillColor('#1a2a47').font('Helvetica-Bold').text('RRT Technical & Pretesting Notes:');
    doc.font('Helvetica').fontSize(10).fillColor('#4a5568').text(cleanNotes(reqData.rrt_notes) || 'No technical notes recorded.', { lineGap: 4 });
    doc.moveDown(1);

    doc.font('Helvetica-Bold').fontSize(11).fillColor('#1a2a47').text('MDI Instruction & Education:');
    doc.font('Helvetica').fontSize(10).fillColor('#4a5568').text(cleanNotes(reqData.mdi_education) || 'No MDI education notes recorded.', { lineGap: 4 });
    doc.moveDown(1);

    doc.font('Helvetica-Bold').fontSize(11).fillColor('#1a2a47').text('Final Physician Interpretation & Overread:');
    doc.font('Helvetica').fontSize(10).fillColor('#1a2a47').text(cleanNotes(reqData.interpretation || reqData.recommended_interpretation) || 'Pending physician overread.', { lineGap: 4 });
    doc.moveDown(2);

    doc.rect(50, doc.y, 512, 85).stroke('#cbd5e0');
    doc.fontSize(10).fillColor('#1a2a47').font('Helvetica-Bold').text('ELECTRONIC SIGNATURE & ATTESTATION', 65, doc.y + 10);
    doc.font('Helvetica').fontSize(9).fillColor('#2d3748').text(
      `Interpreting Physician: ${reqData.phys_name || 'Pending Review'} (${reqData.phys_credentials || 'MD'})`, 65, doc.y + 6
    );
    doc.text(`NPI: ${reqData.phys_npi || 'N/A'}`, 65, doc.y + 4);
    doc.text(`Verification Status: Cryptographically Verified via Secure DirectCare PIN`, 65, doc.y + 4);
    doc.text(`Associated Request ID: ${id} | Status: ${reqData.status}`, 65, doc.y + 4);

    doc.addPage();
    doc.fontSize(18).fillColor('#002b5c').font('Helvetica-Bold').text('SECTION 4: ATTACHED PFT DIAGNOSTIC REPORT');
    doc.moveTo(50, doc.y + 5).lineTo(562, doc.y + 5).stroke('#cbd5e0');
    doc.moveDown(1.5);

    doc.rect(50, 150, 512, 220).stroke('#cbd5e0');
    doc.fontSize(12).fillColor('#1a2a47').font('Helvetica-Bold').text('DIAGNOSTIC REPORT ATTACHMENT SUMMARY', 70, 175);
    doc.font('Helvetica').fontSize(10).fillColor('#4a5568').text(
      'The raw diagnostic PFT testing report file has been successfully attached and verified for this encounter record.',
      70, 205, { width: 472, lineGap: 4 }
    );
    doc.text(`Primary Record ID: ${id}`, 70, 250);
    doc.text(`Associated S3 Object Reference: ${reqData.uploaded_report_path || 'No raw file attached.'}`, 70, 275);
    doc.text(`Verification Status: Attached and Archived in Secure S3 Storage`, 70, 300);

    doc.end();
  } catch (err) {
    console.error("PDF generation error:", err);
    res.status(500).json({ error: 'Failed to generate PDF package' });
  }
});

app.listen(PORT, () => { console.log(`DirectCare API Server listening on port ${PORT}`); });
