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
  
  // Forgot Password States
  const [showForgotModal, setShowForgotModal] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotMsg, setForgotMsg] = useState('');

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

          {/* FULLY AUTOMATED FORGOT PASSWORD MODAL */}
          {showForgotModal && (
            <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }}>
              <div style={{ backgroundColor: 'white', padding: '30px', borderRadius: '8px', width: '380px', boxShadow: '0 4px 20px rgba(0,0,0,0.2)' }}>
                <h3 style={{ marginTop: 0, color: '#1a2a47', fontSize: '18px', textAlign: 'center' }}>Automated Password Recovery</h3>
                <p style={{ fontSize: '13px', color: '#4a5568', lineHeight: '1.4', marginBottom: '15px', textAlign: 'center' }}>
                  Enter your registered email address below, and our system will instantly email you a secure temporary password.
                </p>

                <form onSubmit={async (e) => {
                  e.preventDefault();
                  setForgotMsg('Processing request...');
                  try {
                    const res = await fetch('https://directcare-backend.onrender.com/api/forgot-password', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ email: forgotEmail })
                    });
                    const data = await res.json();
                    setForgotMsg(data.message || 'Temporary password sent!');
                  } catch (err) {
                    setForgotMsg('Failed to process request. Please try again.');
                  }
                }}>
                  <input 
                    type="email" 
                    placeholder="Enter your email..." 
                    value={forgotEmail} 
                    onChange={e => setForgotEmail(e.target.value)} 
                    style={{ width: '100%', padding: '10px', borderRadius: '4px', border: '1px solid #ccc', boxSizing: 'border-box', marginBottom: '15px' }} 
                    required 
                  />
                  {forgotMsg && <p style={{ fontSize: '12px', color: '#2b6cb0', marginBottom: '15px', textAlign: 'center', fontWeight: 'bold' }}>{forgotMsg}</p>}
                  
                  <div style={{ display: 'flex', gap: '10px' }}>
                    <button type="submit" style={{ flex: 1, padding: '10px', backgroundColor: '#1a2a47', color: 'white', border: 'none', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer' }}>
                      Send Temp Password
                    </button>
                    <button type="button" onClick={() => { setShowForgotModal(false); setForgotMsg(''); setForgotEmail(''); }} style={{ padding: '10px 15px', backgroundColor: '#6c757d', color: 'white', border: 'none', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer' }}>
                      Close
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
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