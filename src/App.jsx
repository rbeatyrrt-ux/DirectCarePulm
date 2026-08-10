import React, { useState, useEffect } from 'react';
import AdminDashboard from './pages/AdminDashboard';
import ProviderDashboard from './pages/ProviderDashboard';
import PhysicianDashboard from './pages/PhysicianDashboard';
import RrtDashboard from './pages/RrtDashboard';
import ClinicStaffDashboard from './pages/ClinicStaffDashboard';

export default function App() {
  const [token, setToken] = useState(sessionStorage.getItem('token') || '');
  const [user, setUser] = useState(JSON.parse(sessionStorage.getItem('user')) || null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  
  // Forgot Password & Onboarding States
  const [showForgotModal, setShowForgotModal] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [onboardingError, setOnboardingError] = useState('');

  useEffect(() => {
    const handleUnload = () => {
      sessionStorage.clear();
    };
    window.addEventListener('unload', handleUnload);
    return () => {
      window.removeEventListener('unload', handleUnload);
    };
  }, []);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const res = await fetch('https://directcare-backend.onrender.com/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Login failed');

      setToken(data.token);
      setUser(data.user);
      sessionStorage.setItem('token', data.token);
      sessionStorage.setItem('user', JSON.stringify(data.user));
    } catch (err) {
      setError(err.message);
    }
  };

  const handleLogout = () => {
    setToken('');
    setUser(null);
    sessionStorage.removeItem('token');
    sessionStorage.removeItem('user');
  };

  if (!token || !user) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', backgroundColor: '#f4f6f9', fontFamily: 'Segoe UI, Tahoma, Geneva, Verdana, sans-serif', padding: '20px' }}>
        <div style={{ backgroundColor: 'white', padding: '40px', borderRadius: '8px', boxShadow: '0 4px 15px rgba(0,0,0,0.1)', width: '450px', boxSizing: 'border-box', position: 'relative' }}>
          <h2 style={{ marginTop: 0, color: '#1a2a47', textAlign: 'center', fontSize: '24px' }}>DirectCare PFT Portal</h2>
          <p style={{ fontSize: '12px', color: '#718096', textAlign: 'center', marginBottom: '20px' }}>Secure Pulmonary Function Testing & Diagnostic Management</p>
          
          {error && <div style={{ backgroundColor: '#f8d7da', color: '#721c24', padding: '10px', borderRadius: '4px', marginBottom: '15px', fontSize: '13px' }}>{error}</div>}
          
          <form onSubmit={handleLogin}>
            <div style={{ marginBottom: '15px' }}>
              <label style={{ display: 'block', marginBottom: '5px', fontSize: '13px', fontWeight: 'bold', color: '#333' }}>Email Address</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} style={{ width: '100%', padding: '10px', borderRadius: '4px', border: '1px solid #ccc', boxSizing: 'border-box' }} required />
            </div>
            <div style={{ marginBottom: '10px' }}>
              <label style={{ display: 'block', marginBottom: '5px', fontSize: '13px', fontWeight: 'bold', color: '#333' }}>Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} style={{ width: '100%', padding: '10px', borderRadius: '4px', border: '1px solid #ccc', boxSizing: 'border-box' }} required />
            </div>

            {/* Forgot Password Link */}
            <div style={{ textAlign: 'right', marginBottom: '20px' }}>
              <button type="button" onClick={() => setShowForgotModal(true)} style={{ background: 'none', border: 'none', color: '#3182ce', fontSize: '12px', cursor: 'pointer', padding: 0, fontWeight: '500' }}>
                Forgot Password?
              </button>
            </div>

            <button type="submit" style={{ width: '100%', padding: '12px', backgroundColor: '#1a2a47', color: 'white', border: 'none', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer' }}>Log In</button>
          </form>

          {/* HIPAA & BAA Compliance Notice */}
          <div style={{ marginTop: '25px', padding: '12px', backgroundColor: '#f8f9fa', borderLeft: '4px solid #1a2a47', borderRadius: '4px' }}>
            <p style={{ margin: 0, fontSize: '11px', color: '#4a5568', lineHeight: '1.4' }}>
              <strong>Authorized Access Only:</strong> This system contains Protected Health Information (PHI) governed by HIPAA and executed Business Associate Agreements (BAAs). Unauthorized access, use, or disclosure is strictly prohibited and subject to civil and criminal penalties.
            </p>
          </div>

          {/* CONTACT ADMIN FORGOT PASSWORD MODAL */}
          {showForgotModal && (
            <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }}>
              <div style={{ backgroundColor: 'white', padding: '30px', borderRadius: '8px', width: '380px', boxShadow: '0 4px 20px rgba(0,0,0,0.2)', textAlign: 'center' }}>
                <h3 style={{ marginTop: 0, color: '#1a2a47', fontSize: '18px' }}>Password Recovery</h3>
                <p style={{ fontSize: '13px', color: '#4a5568', lineHeight: '1.5', marginBottom: '20px' }}>
                  Please contact the system administrator at <br />
                  <a href="mailto:robert.beaty@directcarepulm.com" style={{ color: '#3182ce', fontWeight: 'bold' }}>robert.beaty@directcarepulm.com</a> <br />
                  to reset your password.
                </p>
                <button type="button" onClick={() => setShowForgotModal(false)} style={{ padding: '10px 20px', backgroundColor: '#1a2a47', color: 'white', border: 'none', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer' }}>
                  Close
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // MANDATORY ONBOARDING: Intercept if user must change password OR hasn't signed the BAA
  if (token && user && (user.must_change_password || !user.baa_signed)) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', backgroundColor: '#f4f6f9', fontFamily: 'Segoe UI, Tahoma, Geneva, Verdana, sans-serif', padding: '20px' }}>
        <div style={{ backgroundColor: 'white', padding: '40px', borderRadius: '8px', boxShadow: '0 4px 15px rgba(0,0,0,0.1)', width: '600px', boxSizing: 'border-box' }}>
          <h2 style={{ marginTop: 0, color: '#1a2a47', textAlign: 'center', fontSize: '22px' }}>Security & Compliance Onboarding</h2>
          <p style={{ fontSize: '13px', color: '#4a5568', lineHeight: '1.5', marginBottom: '20px', textAlign: 'center' }}>
            Please complete your mandatory password update and execute your digital Business Associate Agreement (BAA) to access the portal.
          </p>

          {onboardingError && <div style={{ backgroundColor: '#f8d7da', color: '#721c24', padding: '10px', borderRadius: '4px', marginBottom: '15px', fontSize: '13px' }}>{onboardingError}</div>}

          <form onSubmit={async (e) => {
            e.preventDefault();
            setOnboardingError('');

            if (user.must_change_password) {
              if (!newPassword || newPassword.trim() === '') {
                setOnboardingError('Please enter a new password.');
                return;
              }
              if (newPassword !== confirmPassword) {
                setOnboardingError('New passwords do not match.');
                return;
              }
            }

            try {
              // 1. Update Password if required
              if (user.must_change_password) {
                const passRes = await fetch('https://directcare-backend.onrender.com/api/auth/update-credentials', {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                  body: JSON.stringify({ current_password: password, new_password: newPassword })
                });
                const passData = await passRes.json();
                if (!passRes.ok) throw new Error(passData.error || 'Failed to update password');
                
                user.must_change_password = false;
              }

              // 2. Sign BAA if not signed
              if (!user.baa_signed) {
                const baaRes = await fetch('https://directcare-backend.onrender.com/api/auth/sign-baa', {
                  method: 'POST',
                  headers: { 'Authorization': `Bearer ${token}` }
                });
                const baaData = await baaRes.json();
                if (!baaRes.ok) throw new Error(baaData.error || 'Failed to record BAA signature');
                
                setUser(baaData.user);
                sessionStorage.setItem('user', JSON.stringify(baaData.user));
              } else {
                setUser({ ...user, must_change_password: false });
                sessionStorage.setItem('user', JSON.stringify({ ...user, must_change_password: false }));
              }

              window.location.reload();
            } catch (err) {
              setOnboardingError(err.message);
            }
          }}>
            {user.must_change_password && (
              <div style={{ marginBottom: '20px', padding: '15px', backgroundColor: '#f8f9fa', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                <h4 style={{ margin: '0 0 10px 0', fontSize: '14px', color: '#1a2a47' }}>Step 1: Set New Permanent Password</h4>
                <div style={{ marginBottom: '10px' }}>
                  <label style={{ display: 'block', marginBottom: '3px', fontSize: '12px', fontWeight: 'bold' }}>New Password</label>
                  <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ccc', boxSizing: 'border-box' }} required />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: '3px', fontSize: '12px', fontWeight: 'bold' }}>Confirm New Password</label>
                  <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ccc', boxSizing: 'border-box' }} required />
                </div>
              </div>
            )}

            {!user.baa_signed && (
              <div style={{ marginBottom: '20px' }}>
                <h4 style={{ margin: '0 0 10px 0', fontSize: '14px', color: '#1a2a47' }}>Step 2: Business Associate Agreement (BAA)</h4>
                
                {/* Robust Legal BAA Text Box */}
                <div style={{ maxHeight: '150px', overflowY: 'auto', padding: '12px', backgroundColor: '#f8f9fa', border: '1px solid #cbd5e0', borderRadius: '4px', marginBottom: '12px', fontSize: '10px', color: '#2d3748', lineHeight: '1.4' }}>
                  <strong>DIGITAL BUSINESS ASSOCIATE AGREEMENT (BAA)</strong><br />
                  Between DirectCare Pulmonary Diagnostics LLC and the Participating Clinical Entity.<br /><br />
                  <strong>1. Purpose & Scope:</strong> This Agreement is entered into to comply with the Health Insurance Portability and Accountability Act of 1996 (HIPAA), the Health Information Technology for Economic and Clinical Health (HITECH) Act, and implementing regulations. This governs the safeguarding, electronic transmission, and storage of Protected Health Information (PHI).<br /><br />
                  <strong>2. Obligations of Business Associate:</strong> DirectCare Pulmonary Diagnostics LLC agrees to use and disclose PHI only as permitted or required by law, implement administrative, physical, and technical safeguards to prevent unauthorized access, and report any security incidents or data breaches in accordance with federal standards.<br /><br />
                  <strong>3. Obligations of Covered Entity (User Practice):</strong> The participating user and clinic agree to ensure that all transmitted patient data, orders, and credentials comply with minimum necessary standards, and that local workstation endpoints maintain full-disk encryption and strict access controls.<br /><br />
                  <strong>4. Termination & Audit:</strong> Violation of these security terms constitutes material breach and permits immediate termination of portal access.
                </div>

                <div style={{ display: 'flex', alignItems: 'flex-start' }}>
                  <input type="checkbox" id="baaCheck" required style={{ marginRight: '10px', marginTop: '2px', width: '16px', height: '16px' }} />
                  <label htmlFor="baaCheck" style={{ fontSize: '11px', color: '#1a2a47', fontWeight: 'bold', cursor: 'pointer', lineHeight: '1.4' }}>
                    I am an authorized representative of my clinical practice, and I legally accept and bind my organization to the terms of this Business Associate Agreement (BAA).
                  </label>
                </div>
              </div>
            )}

            <button type="submit" style={{ width: '100%', padding: '12px', backgroundColor: '#1a2a47', color: 'white', border: 'none', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer' }}>
              Complete Onboarding & Access Portal
            </button>
          </form>
        </div>
      </div>
    );
  }

  // Route based on user role
  if (user.role === 'admin') {
    return <AdminDashboard token={token} user={user} onLogout={handleLogout} />;
  }
  if (user.role === 'rrt') {
    return <RrtDashboard token={token} user={user} onLogout={handleLogout} />;
  }
  if (user.role === 'physician') {
    return <PhysicianDashboard token={token} user={user} onLogout={handleLogout} />;
  }
  if (user.role === 'nurse') {
    return <ClinicStaffDashboard token={token} user={user} onLogout={handleLogout} />;
  }
  
  return <ProviderDashboard token={token} user={user} onLogout={handleLogout} />;
}