-- ENABLE UUID EXTENSION
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. PRACTICES
CREATE TABLE IF NOT EXISTS practices (
    practice_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    clinic_name VARCHAR(255) NOT NULL,
    npi_number VARCHAR(10) UNIQUE NOT NULL,
    practice_manager_name VARCHAR(150) NOT NULL,
    billing_email VARCHAR(255) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. ENUMS
DO $$ BEGIN
    CREATE TYPE user_role AS ENUM ('REQUESTER', 'COORDINATOR', 'REVIEWER');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE block_type AS ENUM ('HALF_DAY_5', 'FULL_DAY_12');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE billing_model AS ENUM ('MODEL_A_FFS', 'MODEL_B_DPC_CASH', 'MODEL_C_OSHA_DAY');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE request_status AS ENUM ('PENDING_RRT_APPROVAL', 'APPROVED', 'TESTING_COMPLETED', 'OVERREAD_IN_PROGRESS', 'FINALIZED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE cpt_suite AS ENUM ('FULL_PFT_94060_94729_94726', 'SPIROMETRY_94010', 'DIFFUSION_VOLUMES');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE qc_grade AS ENUM ('A', 'B', 'C', 'F');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 3. PORTAL USERS
CREATE TABLE IF NOT EXISTS portal_users (
    user_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    practice_id UUID REFERENCES practices(practice_id) ON DELETE SET NULL,
    role user_role NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(150) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 4. SERVICE REQUESTS
CREATE TABLE IF NOT EXISTS service_requests (
    request_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    practice_id UUID REFERENCES practices(practice_id) NOT NULL,
    assigned_rrt_id UUID REFERENCES portal_users(user_id),
    requested_date DATE NOT NULL,
    time_block block_type NOT NULL,
    billing_tier billing_model NOT NULL,
    status request_status DEFAULT 'PENDING_RRT_APPROVAL',
    rrt_notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 5. PATIENT MANIFESTS
CREATE TABLE IF NOT EXISTS patient_manifests (
    manifest_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    request_id UUID REFERENCES service_requests(request_id) ON DELETE CASCADE,
    patient_initials VARCHAR(5) NOT NULL,
    dob DATE NOT NULL,
    test_requested cpt_suite NOT NULL,
    raw_flow_loop_s3_key VARCHAR(512),
    preliminary_pdf_s3_key VARCHAR(512),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 6. CLINICAL OVERREADS
CREATE TABLE IF NOT EXISTS clinical_overreads (
    overread_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    manifest_id UUID REFERENCES patient_manifests(manifest_id) UNIQUE NOT NULL,
    reviewer_id UUID REFERENCES portal_users(user_id) NOT NULL,
    quality_control_grade qc_grade NOT NULL,
    interpretation_notes TEXT NOT NULL,
    esignature_text TEXT NOT NULL,
    signed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    final_signed_report_s3_key VARCHAR(512)
);

-- 7. INVOICES
CREATE TABLE IF NOT EXISTS invoices (
    invoice_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    request_id UUID REFERENCES service_requests(request_id) NOT NULL,
    practice_id UUID REFERENCES practices(practice_id) NOT NULL,
    total_tests INT NOT NULL,
    status VARCHAR(50) DEFAULT 'NET_30_PENDING',
    due_date DATE DEFAULT (CURRENT_DATE + INTERVAL '30 days'),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 8. MANDATORY HIPAA AUDIT LOGS
CREATE TABLE IF NOT EXISTS hipaa_audit_logs (
    log_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID,
    action VARCHAR(100) NOT NULL,
    target_resource VARCHAR(255) NOT NULL,
    ip_address VARCHAR(45) NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);