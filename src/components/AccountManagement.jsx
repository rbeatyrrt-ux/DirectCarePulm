import React, { useState } from 'react';

export default function AccountManagement({ token, user, onUpdateSuccess }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newSignaturePin, setNewSignaturePin] = useState('');
  const [credentials, setCredentials] = useState(user?.credentials || '');
  const [npi, setNpi] = useState(user?.npi || '');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    try {
      const res = await fetch('http://localhost:5000/api/auth/update-credentials', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword,
          new_signature_pin: newSignaturePin,
          credentials,
          npi
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Update failed');

      setSuccess('Account settings updated successfully!');
      setCurrentPassword('');
      setNewPassword('');
      setNewSignaturePin('');
      if (onUpdateSuccess) onUpdateSuccess(data.user);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div style={{ backgroundColor: 'white', padding: '30px', borderRadius: '8px', boxShadow: '0 2px 10px rgba(0,0,0,0.05)', maxWidth: '500px', margin: '0 auto' }}>
      <h2 style={{ marginTop: 0, color: '#1a2a47', fontSize: '20px' }}>Account Security Settings</h2>
      <p style={{ fontSize: '13px', color: '#64748b', marginBottom: '20px' }}>Update your password, credentials, and digital signature PIN.</p>
      
      {error && <div style={{ backgroundColor: '#f8d7da', color: '#721c24', padding: '12px', borderRadius: '4px', marginBottom: '15px', fontSize: '13px' }}>{error}</div>}
      {success && <div style={{ backgroundColor: '#d1e7dd', color: '#0f5132', padding: '12px', borderRadius: '4px', marginBottom: '15px', fontSize: '13px' }}>{success}</div>}

      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: '15px' }}>
          <label style={{ display: 'block', fontSize: '13px', fontWeight: 'bold', marginBottom: '5px', color: '#333' }}>Current Password (Required)</label>
          <input type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} style={{ width: '100%', padding: '10px', borderRadius: '4px', border: '1px solid #ccc', boxSizing: 'border-box' }} required />
        </div>

        <div style={{ marginBottom: '15px' }}>
          <label style={{ display: 'block', fontSize: '13px', fontWeight: 'bold', marginBottom: '5px', color: '#333' }}>New Password (Optional)</label>
          <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} style={{ width: '100%', padding: '10px', borderRadius: '4px', border: '1px solid #ccc', boxSizing: 'border-box' }} />
        </div>

        {/* Nurses do not need Signature PINs for PFTs, so we hide it for them */}
        {user?.role !== 'nurse' && (
          <div style={{ marginBottom: '15px' }}>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 'bold', marginBottom: '5px', color: '#333' }}>New Signature PIN</label>
            <input type="password" value={newSignaturePin} onChange={e => setNewSignaturePin(e.target.value)} style={{ width: '100%', padding: '10px', borderRadius: '4px', border: '1px solid #ccc', boxSizing: 'border-box' }} maxLength={6} placeholder="e.g. 1234" />
          </div>
        )}

        <div style={{ marginBottom: '15px' }}>
          <label style={{ display: 'block', fontSize: '13px', fontWeight: 'bold', marginBottom: '5px', color: '#333' }}>Professional Credentials</label>
          <input type="text" value={credentials} onChange={e => setCredentials(e.target.value)} style={{ width: '100%', padding: '10px', borderRadius: '4px', border: '1px solid #ccc', boxSizing: 'border-box' }} placeholder="e.g. MD, RRT" />
        </div>

        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', fontSize: '13px', fontWeight: 'bold', marginBottom: '5px', color: '#333' }}>NPI Number</label>
          <input type="text" value={npi} onChange={e => setNpi(e.target.value)} style={{ width: '100%', padding: '10px', borderRadius: '4px', border: '1px solid #ccc', boxSizing: 'border-box' }} />
        </div>

        <button type="submit" style={{ width: '100%', backgroundColor: '#1a2a47', color: 'white', padding: '12px', borderRadius: '4px', border: 'none', fontWeight: 'bold', cursor: 'pointer', fontSize: '14px' }}>Save Security Settings</button>
      </form>
    </div>
  );
}