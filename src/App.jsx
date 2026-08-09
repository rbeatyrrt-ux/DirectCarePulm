import React, { useState } from 'react';
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

// ADD THIS HOOK HERE:
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
    // ... rest of your code

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
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', backgroundColor: '#f4f6f9', fontFamily: 'Segoe UI, Tahoma, Geneva, Verdana, sans-serif' }}>
        <div style={{ backgroundColor: 'white', padding: '40px', borderRadius: '8px', boxShadow: '0 4px 15px rgba(0,0,0,0.1)', width: '400px' }}>
          <h2 style={{ marginTop: 0, color: '#1a2a47', textAlign: 'center', fontSize: '24px' }}>DirectCare PFT Portal</h2>
          {error && <div style={{ backgroundColor: '#f8d7da', color: '#721c24', padding: '10px', borderRadius: '4px', marginBottom: '15px', fontSize: '13px' }}>{error}</div>}
          <form onSubmit={handleLogin}>
            <div style={{ marginBottom: '15px' }}>
              <label style={{ display: 'block', marginBottom: '5px', fontSize: '13px', fontWeight: 'bold', color: '#333' }}>Email Address</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} style={{ width: '100%', padding: '10px', borderRadius: '4px', border: '1px solid #ccc', boxSizing: 'border-box' }} required />
            </div>
            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '5px', fontSize: '13px', fontWeight: 'bold', color: '#333' }}>Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} style={{ width: '100%', padding: '10px', borderRadius: '4px', border: '1px solid #ccc', boxSizing: 'border-box' }} required />
            </div>
            <button type="submit" style={{ width: '100%', padding: '12px', backgroundColor: '#1a2a47', color: 'white', border: 'none', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer' }}>Log In</button>
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
  
  // Default fallback for providers
  return <ProviderDashboard token={token} user={user} onLogout={handleLogout} />;
}