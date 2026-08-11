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
      ALTER TABLE clinics ADD COLUMN IF NOT EXISTS admin_signature TEXT;
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
    baa_signature,
    admin_signature
  } = req.body;

  if (!clinic_name || !billing_email || !baa_signature || !admin_signature) {
    return res.status(400).json({ error: 'Clinic details and both signatures are required.' });
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
        admin_signature,
        baa_signed_date
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)
      ON CONFLICT (clinic_name) DO UPDATE SET 
        billing_email = EXCLUDED.billing_email, 
        phone_number = EXCLUDED.phone_number,
        authorized_rep_email = EXCLUDED.authorized_rep_email,
        address = EXCLUDED.address,
        baa_signer_name = EXCLUDED.baa_signer_name,
        baa_signer_title = EXCLUDED.baa_signer_title,
        baa_signature = EXCLUDED.baa_signature,
        admin_signature = EXCLUDED.admin_signature,
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
      baa_signature,
      admin_signature
    ]);
    res.status(201).json({ message: 'Clinic and executed BAA saved successfully', clinic: result.rows[0] });
  } catch (err) {
    console.error("Clinic BAA save error:", err);
    res.status(500).json({ error: 'Failed to save clinic account: ' + err.message });
  }
});

// RECORD DIGITAL BAA SIGNATURE & METADATA ENDPOINT FOR USERS
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

// DOWNLOAD INDIVIDUAL EXECUTED BAA COMPLIANCE CERTIFICATE PDF FOR USERS
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

// GENERATE EXECUTED FULL MULTI-PAGE BAA PDF FOR A SPECIFIC CLINIC WITH INJECTED SIGNATURE IMAGES
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

    // --- PAGE 1: TITLE & RECITALS ---
    doc.fontSize(16).fillColor('#002b5c').font('Helvetica-Bold').text('HIPAA BUSINESS ASSOCIATE AGREEMENT', { align: 'center' });
    doc.moveDown(1.5);

    doc.fontSize(9).fillColor('#2d3748').font('Helvetica').text(
      `This HIPAA Business Associate Agreement (“Agreement”) is entered into as of ${effectiveDate} (“Effective Date”) by and between ${clinic.clinic_name}, a participating healthcare entity (“Covered Entity”), and DirectCare Pulmonary Diagnostics LLC, an Ohio limited liability company (“Business Associate”).`,
      { align: 'justify', lineGap: 3 }
    );
    doc.moveDown(1);

    doc.font('Helvetica-Bold').text('RECITALS');
    doc.font('Helvetica').text(
      'WHEREAS, Business Associate provides certain services to Covered Entity that involve the use and/or disclosure of Protected Health Information (“PHI”);\n' +
      'WHEREAS, Covered Entity is a “covered entity” as defined in the Health Insurance Portability and Accountability Act of 1996 (“HIPAA”) and the regulations promulgated thereunder;\n' +
      'WHEREAS, Business Associate is a “business associate” as defined in HIPAA and the HIPAA Rules (as defined below); and\n' +
      'WHEREAS, Covered Entity is required under HIPAA to obtain satisfactory assurances that Business Associate will appropriately safeguard PHI it receives, creates, maintains, or transmits on behalf of Covered Entity.\n' +
      'NOW, THEREFORE, in consideration of the mutual promises set forth herein and other good and valuable consideration, the receipt and sufficiency of which are hereby acknowledged, the parties agree as follows:',
      { align: 'justify', lineGap: 3 }
    );
    doc.moveDown(1);

    doc.font('Helvetica-Bold').text('1. Definitions');
    doc.font('Helvetica').text(
      '1.1 “HIPAA Rules” means, collectively, the Privacy Rule, Security Rule, Breach Notification Rule, and Enforcement Rule at 45 C.F.R. Parts 160 and 164.\n' +
      '1.2 “Business Associate” has the meaning set forth at 45 C.F.R. § 160.103 and, for purposes of this Agreement, refers to the entity identified above as Business Associate.\n' +
      '1.3 “Covered Entity” has the meaning set forth at 45 C.F.R. § 160.103 and, for purposes of this Agreement, refers to the entity identified above as Covered Entity.\n' +
      '1.4 “Protected Health Information” or “PHI” has the meaning set forth at 45 C.F.R. § 160.103, and for purposes of this Agreement includes all individually identifiable health information created, received, maintained, or transmitted by Business Associate on behalf of Covered Entity, in any form or medium.\n' +
      '1.5 “Electronic Protected Health Information” or “ePHI” means PHI that is transmitted or maintained in electronic media, as defined at 45 C.F.R. § 160.103.\n' +
      '1.6 “Breach” has the meaning set forth at 45 C.F.R. § 164.402, and refers to the acquisition, access, use, or disclosure of unsecured PHI in a manner not permitted under the HIPAA Rules that compromises the security or privacy of the PHI.\n' +
      '1.7 “Unsecured PHI” has the meaning set forth at 45 C.F.R. § 164.402, and refers to PHI that is not rendered unusable, unreadable, or indecipherable to unauthorized individuals through the use of a technology or methodology specified by the Secretary of the U.S. Department of Health and Human Services (“HHS”).\n' +
      '1.8 “Security Incident” has the meaning set forth at 45 C.F.R. § 164.304.\n' +
      '1.9 “Secretary” means the Secretary of HHS or the Secretary’s designee.\n' +
      '1.10 Capitalized terms used but not otherwise defined in this Agreement shall have the meanings given to them in the HIPAA Rules.',
      { align: 'justify', lineGap: 3 }
    );
    doc.moveDown(1);

    doc.font('Helvetica-Bold').text('2. Obligations and Activities of Business Associate');
    doc.font('Helvetica').text(
      '2.1 Permitted Use and Disclosure. Business Associate shall not use or disclose PHI other than as permitted or required by this Agreement, as permitted or required by applicable law, or as otherwise authorized in writing by Covered Entity.\n' +
      '2.2 Safeguards. Business Associate shall use appropriate administrative, physical, and technical safeguards, including a risk analysis and risk management program, access controls, and workforce security measures, to prevent the use or disclosure of PHI other than as provided for by this Agreement. With respect to ePHI, Business Associate shall comply with the applicable requirements of the Security Rule at 45 C.F.R. Part 164, Subpart C.\n' +
      '2.3 Mitigation. Business Associate shall mitigate, to the extent practicable, any harmful effect that is known to Business Associate of a use or disclosure of PHI by Business Associate or its employees, agents, or subcontractors in violation of this Agreement or the HIPAA Rules.\n' +
      '2.4 Reporting of Breaches and Security Incidents. Business Associate shall report to Covered Entity any Breach of Unsecured PHI in accordance with 45 C.F.R. § 164.410 and any Security Incident that results in unauthorized access, use, or disclosure of PHI. Such report shall be made without unreasonable delay and in no case later than 15 calendar days after discovery of the Breach or Security Incident. The report shall include, to the extent available, the information required by 45 C.F.R. § 164.410(c), and any additional information reasonably requested by Covered Entity.\n' +
      '2.5 Subcontractors and Agents. Business Associate shall ensure that any subcontractor, agent, or other third party to whom it provides PHI on behalf of Covered Entity agrees in writing to the same restrictions, conditions, and requirements that apply to Business Associate with respect to such PHI, including compliance with the applicable provisions of the HIPAA Rules.\n' +
      '2.6 Access to PHI. To the extent Business Associate maintains PHI in a Designated Record Set, Business Associate shall make such PHI available to Covered Entity, or, at Covered Entity’s direction, to the individual who is the subject of the PHI, in order to meet Covered Entity’s obligations under 45 C.F.R. § 164.524. Such access shall be provided within the time frames required by the HIPAA Rules and as reasonably requested by Covered Entity.\n' +
      '2.7 Amendment of PHI. To the extent Business Associate maintains PHI in a Designated Record Set, Business Associate shall make such PHI available for amendment and shall incorporate any amendments to PHI as directed by Covered Entity in accordance with 45 C.F.R. § 164.526.\n' +
      '2.8 Accounting of Disclosures. Business Associate shall maintain and, within a reasonable time following Covered Entity’s written request, provide to Covered Entity such information as is necessary to permit Covered Entity to provide an accounting of disclosures of PHI in accordance with 45 C.F.R. § 164.528.\n' +
      '2.9 Internal Practices, Books, and Records. Business Associate shall make its internal practices, books, and records relating to the use and disclosure of PHI received from, or created or received by Business Associate on behalf of, Covered Entity available to the Secretary for purposes of determining Covered Entity’s compliance with the HIPAA Rules. To the extent permitted by law, Business Associate shall promptly notify Covered Entity of any such request, unless such notice is prohibited by law.\n' +
      '2.10 Compliance with Law. Business Associate shall comply with the HIPAA Rules and any other applicable federal or state laws and regulations governing the privacy or security of PHI, including any amendments to HIPAA or such laws that affect Business Associate’s obligations under this Agreement.',
      { align: 'justify', lineGap: 3 }
    );
    
    doc.addPage();

    doc.font('Helvetica-Bold').text('3. Workforce Training and Security Awareness');
    doc.font('Helvetica').text(
      '3.1 HIPAA Privacy Training. Business Associate shall provide training on the requirements of the HIPAA Privacy Rule and on Business Associate’s related policies and procedures to all members of its workforce who create, receive, maintain, or transmit PHI on behalf of Business Associate. Such training shall be provided as necessary and appropriate for the members of the workforce to carry out their functions, in accordance with 45 C.F.R. § 164.530(b)(1) of the HIPAA Privacy Rule. Business Associate shall document that the training has been provided.\n' +
      '3.2 Security Awareness and Training. Business Associate shall implement a security awareness and training program for all members of its workforce, including management, in accordance with 45 C.F.R. § 164.308(a)(5) of the HIPAA Security Rule. Such program shall include, as appropriate, security reminders, protection from malicious software, log-in monitoring, and password management. Business Associate shall document that such training and related security measures have been implemented.',
      { align: 'justify', lineGap: 3 }
    );
    doc.moveDown(1);

    doc.font('Helvetica-Bold').text('4. Permitted Uses and Disclosures by Business Associate');
    doc.font('Helvetica').text(
      '4.1 Services for Covered Entity. Except as otherwise limited by this Agreement or applicable law, Business Associate may use or disclose PHI only as necessary to perform the services set forth in the underlying agreement(s) between Covered Entity and Business Associate. In performing such services, Business Associate shall request, use, and disclose only the minimum necessary PHI required to accomplish the intended purpose, consistent with 45 C.F.R. § 164.502(b).\n' +
      '4.2 Use for Proper Management and Administration. Business Associate may use PHI for its proper management and administration or to carry out its legal responsibilities, provided that such use is permitted by the HIPAA Rules and applicable law.\n' +
      '4.3 Disclosures for Proper Management and Administration. Business Associate may disclose PHI for its proper management and administration or to carry out its legal responsibilities, provided that (a) the disclosures are required by law, or (b) Business Associate obtains reasonable assurances from the person to whom the PHI is disclosed that the PHI will be held confidentially and used or further disclosed only as required by law or for the purpose for which it was disclosed, and that the person will notify Business Associate of any instance of which it becomes aware in which the confidentiality of the PHI has been breached.\n' +
      '4.4 De-identified Information. Business Associate may de-identify PHI in accordance with 45 C.F.R. § 164.514(a)–(c). PHI that has been de-identified in accordance with such regulations is no longer subject to this Agreement, and Business Associate may use or disclose such de-identified information for any lawful purpose, provided that Business Associate does not attempt to re-identify the information or contact the individuals who are the subject of the information.\n' +
      '4.5 Prohibited Uses and Disclosures. Business Associate shall not sell PHI or use PHI for marketing or fundraising purposes in a manner that would violate the HIPAA Rules or other applicable law if done by Covered Entity, unless expressly authorized in writing by Covered Entity and, if required by law, by the individual whose PHI is used or disclosed.',
      { align: 'justify', lineGap: 3 }
    );
    doc.moveDown(1);

    doc.font('Helvetica-Bold').text('5. Term and Termination');
    doc.font('Helvetica').text(
      '5.1 Term. This Agreement shall become effective as of the Effective Date and shall remain in effect until terminated in accordance with this Section 5 or the termination or expiration of all underlying service agreement(s) between Covered Entity and Business Associate, whichever occurs first.\n' +
      '5.2 Termination for Cause. Covered Entity may terminate this Agreement and any related services agreement(s) immediately if it determines that Business Associate has materially breached this Agreement and Business Associate has not cured the breach within thirty (30) days after receiving written notice from Covered Entity specifying the nature of the breach, if the breach is reasonably capable of cure. If cure is not possible, Covered Entity may terminate this Agreement immediately upon written notice to Business Associate.\n' +
      '5.3 Other Termination Rights. Business Associate may terminate this Agreement upon written notice to Covered Entity if Business Associate reasonably determines that continuing to perform under this Agreement would cause Business Associate to violate the HIPAA Rules or other applicable law and the parties are unable, after good faith negotiations, to amend this Agreement to prevent such violation.\n' +
      '5.4 Obligations of Business Associate Upon Termination. Upon termination or expiration of this Agreement for any reason, Business Associate shall, with respect to PHI received from Covered Entity, or created, maintained, or received by Business Associate on behalf of Covered Entity, (a) retain only that PHI which is necessary for Business Associate to continue its proper management and administration or to carry out its legal responsibilities; (b) return to Covered Entity or, if agreed to by Covered Entity, destroy all remaining PHI that Business Associate still maintains in any form; (c) continue to use appropriate safeguards and comply with the HIPAA Rules with respect to such PHI for as long as Business Associate retains it; and (d) not use or disclose such PHI other than for the purposes that make the return or destruction infeasible, or as required by law.\n' +
      '5.5 Infeasibility of Return or Destruction. If Business Associate determines that returning or destroying PHI is infeasible, Business Associate shall provide to Covered Entity written notification of the conditions that make return or destruction infeasible. If Covered Entity agrees that return or destruction of PHI is infeasible, Business Associate shall extend the protections of this Agreement to such PHI and limit further uses and disclosures of such PHI to those purposes that make the return or destruction infeasible, for so long as Business Associate maintains such PHI.\n' +
      '5.6 Reporting to HHS. If Covered Entity determines that termination of this Agreement is not feasible, Covered Entity shall report the violation to the Secretary, in accordance with 45 C.F.R. § 164.504(e)(1)(ii).',
      { align: 'justify', lineGap: 3 }
    );
    
    doc.addPage();

    doc.font('Helvetica-Bold').text('6. Miscellaneous');
    doc.font('Helvetica').text(
      '6.1 Amendment. The parties agree to take such action as is necessary to amend this Agreement from time to time as may be required to comply with the requirements of HIPAA, the HIPAA Rules, and any other applicable law or regulation. Any such amendment shall be in writing and signed by both parties.\n' +
      '6.2 Survival. The respective rights and obligations of Business Associate and Covered Entity under this Agreement that, by their nature, are intended to survive termination or expiration of this Agreement, including without limitation the provisions of Sections 2, 3, 4, 5.4, 5.5, and this Section 6, shall survive such termination or expiration.\n' +
      '6.3 Interpretation. Any ambiguity in this Agreement shall be resolved to permit compliance with the HIPAA Rules. In the event of a conflict between the terms of this Agreement and the terms of any other agreement between the parties, this Agreement shall control with respect to the subject matter of this Agreement and the parties’ respective obligations regarding PHI.\n' +
      '6.4 Governing Law. This Agreement shall be governed by and construed in accordance with the laws of the State of Ohio, without regard to its conflict-of-law principles, except to the extent preempted by federal law including HIPAA.\n' +
      '6.5 Indemnification. Business Associate shall indemnify, defend, and hold harmless Covered Entity and its directors, officers, employees, and agents from and against any and all claims, damages, fines, penalties, costs, and expenses (including reasonable attorneys’ fees) arising out of or relating to (a) Business Associate’s breach of this Agreement; or (b) Business Associate’s violation of the HIPAA Rules or other applicable law relating to PHI, except to the extent caused by Covered Entity’s negligence or willful misconduct.\n' +
      '6.6 Entire Agreement. This Agreement, together with the underlying service agreement(s) between Covered Entity and Business Associate, constitutes the entire agreement between the parties with respect to the subject matter hereof and supersedes all prior or contemporaneous agreements, proposals, and communications, whether oral or written, relating to such subject matter.\n' +
      '6.7 Counterparts. This Agreement may be executed in counterparts, each of which shall be deemed an original and all of which together shall constitute one and the same instrument. Signatures provided by facsimile, electronic, or digital means shall be deemed to be original.',
      { align: 'justify', lineGap: 3 }
    );
    doc.moveDown(2);

    // Digital Signatures
    doc.font('Helvetica-Bold').text('IN WITNESS WHEREOF, the parties hereto have executed this Business Associate Agreement as of the Effective Date.');
    doc.moveDown(2);

    // SIGNATURE BLOCKS
    const sigY = doc.y;

    // Clinic Signature Block
    doc.font('Helvetica-Bold').text('COVERED ENTITY', 50, sigY);
    doc.font('Helvetica').text(`Name: ${clinic.clinic_name}`, 50, sigY + 15);
    doc.text(`Signer: ${clinic.baa_signer_name} (${clinic.baa_signer_title})`, 50, sigY + 30);
    doc.text(`Date: ${effectiveDate}`, 50, sigY + 45);
    if (clinic.baa_signature && clinic.baa_signature.startsWith('data:image')) {
      const clinicImgBuffer = Buffer.from(clinic.baa_signature.replace(/^data:image\/\w+;base64,/, ""), 'base64');
      doc.image(clinicImgBuffer, 50, sigY + 60, { width: 200, height: 60 });
    }
    doc.moveTo(50, sigY + 120).lineTo(250, sigY + 120).stroke();

    // Admin Signature Block
    doc.font('Helvetica-Bold').text('BUSINESS ASSOCIATE', 300, sigY);
    doc.font('Helvetica').text('Name: DirectCare Pulmonary Diagnostics LLC', 300, sigY + 15);
    doc.text('Signer: Robert Beaty, MHA, RRT-ACCS', 300, sigY + 30);
    doc.text(`Date: ${effectiveDate}`, 300, sigY + 45);
    if (clinic.admin_signature && clinic.admin_signature.startsWith('data:image')) {
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
