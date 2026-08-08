import React, { useState, useEffect } from 'react';
import AccountManagement from '../components/AccountManagement';

const FINAL_INTERPRETATION_PRESETS = [
  'Normal spirometry and lung volumes with no evidence of ventilatory defect.',
  'Mild obstructive ventilatory defect with no significant bronchodilator response.',
  'Moderate obstructive ventilatory defect with a positive bronchodilator response.',
  'Severe obstructive ventilatory defect showing air trapping.',
  'Restrictive ventilatory defect suspected; clinical and body plethysmography correlation recommended.',
  'Mixed ventilatory defect with both obstructive and restrictive components.',
  'Diffusion capacity (DLCO) is moderately impaired, suggesting parenchymal or vascular pathology.',
  'Study is technically limited by patient effort/artifacts but interpretable as described above.'
];

export default function PhysicianDashboard({ token, user, onLogout }) {
  const [activeTab, setActiveTab] = useState('queue');
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(false);
  const [mustChangePassword, setMustChangePassword] = useState(false);

  // Search tab state
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');

  // Review / Edit Modal State
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [finalInterpretation, setFinalInterpretation] = useState('');
  const [signaturePin, setSignaturePin] = useState('');
  const [pdfBlobUrl, setPdfBlobUrl] = useState(null);

  useEffect(() => {
    if (token) {
      checkProfileStatus();
      fetchRequests();
    }
  }, [token]);

  // Fetch raw uploaded report PDF as authenticated blob so iframe displays it securely in modal
  useEffect(() => {
    if (selectedRequest && token) {
      fetch(`http://localhost:5000/api/requests/${selectedRequest.request_id}/raw-report`, {
        headers: { Authorization: `Bearer ${token}` }
      })
        .then(res => {
          if (!res.ok) throw new Error('Report PDF not found');
          return res.blob();
        })
        .then(blob => {
          const url = URL.createObjectURL(blob);
          setPdfBlobUrl(url);
        })
        .catch(err => {
          console.error('Failed to load raw report PDF blob', err);
          setPdfBlobUrl(null);
        });

      return () => {
        if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl);
      };
    } else {
      setPdfBlobUrl(null);
    }
  }, [selectedRequest, token]);

  const checkProfileStatus = async () => {
    try {
      const res = await fetch('http://localhost:5000/api/auth/me', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (res.ok && data && data.must_change_password) {
        setMustChangePassword(true);
      }
    } catch (err) {
      console.error('Failed to verify profile status', err);
    }
  };

  const fetchRequests = async () => {
    setLoading(true);
    try {
      const res = await fetch('http://localhost:5000/api/requests', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (res.ok && Array.isArray(data)) {
        setRequests(data);
      } else {
        setRequests([]);
      }
    } catch (err) {
      console.error('Failed to fetch requests', err);
      setRequests([]);
    } finally {
      setLoading(false);
    }
  };

  const handleFinalizeReview = async (e) => {
    e.preventDefault();
    if (!selectedRequest) return;
    if (!signaturePin) {
      alert('Please enter your Signature PIN to sign and finalize this report.');
      return;
    }

    try {
      const res = await fetch(`http://localhost:5000/api/requests/${selectedRequest.request_id}/finalize`, {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}` 
        },
        body: JSON.stringify({ 
          interpretation: finalInterpretation,
          signature_pin: signaturePin 
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to finalize review');

      alert('Order successfully signed, updated, and sent!');
      setSelectedRequest(null);
      setFinalInterpretation('');
      setSignaturePin('');
      fetchRequests();
    } catch (err) {
      alert(err.message);
    }
  };

  const viewPdfInNewTab = (id) => {
    window.open(`http://localhost:5000/api/requests/${id}/raw-report`, '_blank');
  };

  const addPreset = (text) => {
    setFinalInterpretation(prev => prev ? prev + '\n' + text : text);
  };

  const pendingQueue = (Array.isArray(requests) ? requests : [])
    .filter(req => req && req.status === 'PRELIMINARY_RESULTS')
    .sort((a, b) => new Date(a.requested_date || 0) - new Date(b.requested_date || 0));

  const searchResults = (Array.isArray(requests) ? requests : []).filter(req => {
    if (!req) return false;
    const name = (req.patient_name || '').toLowerCase();
    const clinic = (req.clinic_name || '').toLowerCase();
    const term = (searchTerm || '').toLowerCase();
    const matchesSearch = name.includes(term) || clinic.includes(term);
    const matchesStatus = statusFilter === 'ALL' || req.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const tabStyle = (tabName) => ({
    padding: '10px 20px', cursor: 'pointer', backgroundColor: activeTab === tabName ? '#f4f6f9' : 'transparent',
    color: activeTab === tabName ? '#1a2a47' : 'white', border: 'none', borderTopLeftRadius: '6px', borderTopRightRadius: '6px',
    fontWeight: 'bold', fontSize: '14px', marginRight: '5px'
  });

  const getStatusStyle = (status) => {
    switch (status) {
      case 'SCHEDULED': return { bg: '#cce5ff', color: '#004085' };
      case 'PRELIMINARY_RESULTS': return { bg: '#fff3cd', color: '#856404' };
      case 'COMPLETED': return { bg: '#d4edda', color: '#155724' };
      case 'PENDING':
      default: return { bg: '#e2e3e5', color: '#383d41' };
    }
  };

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f4f6f9', fontFamily: 'Segoe UI, Tahoma, Geneva, Verdana, sans-serif' }}>
      
      {mustChangePassword && (
        <AccountManagement 
          token={token} 
          user={user} 
          isForcedModal={true} 
          onSuccess={() => setMustChangePassword(false)} 
        />
      )}

      {/* HEADER */}
      <header style={{ backgroundColor: '#1a2a47', paddingTop: '20px' }}>
        <div style={{ padding: '0 40px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: '22px', color: 'white' }}>DirectCare Interpreting Physician Portal</h1>
            <span style={{ fontSize: '13px', color: '#a0aec0' }}>Physician: <strong>{user?.full_name}</strong></span>
          </div>
          <button onClick={onLogout} style={{ backgroundColor: 'transparent', color: 'white', border: '1px solid white', padding: '8px 20px', borderRadius: '4px', cursor: 'pointer', fontSize: '14px' }}>
            Log Out
          </button>
        </div>

        <div style={{ padding: '0 40px', display: 'flex', borderBottom: '2px solid #f4f6f9' }}>
          <button style={tabStyle('queue')} onClick={() => setActiveTab('queue')}>
            48-Hour Overread Queue ({pendingQueue.length})
          </button>
          <button style={tabStyle('search')} onClick={() => setActiveTab('search')}>Patient Search & Archive</button>
          <button style={tabStyle('account')} onClick={() => setActiveTab('account')}>Account Security</button>
        </div>
      </header>

      {/* MAIN CONTENT AREA */}
      <main style={{ padding: '40px', maxWidth: '1600px', margin: '0 auto' }}>
        
        {/* TAB 1: 48-HOUR SLA PRIORITY QUEUE */}
        {activeTab === 'queue' && (
          <div style={{ backgroundColor: 'white', borderRadius: '8px', padding: '30px', boxShadow: '0 2px 10px rgba(0,0,0,0.05)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <div>
                <h2 style={{ margin: 0, color: '#1a2a47', fontSize: '20px' }}>Active Overread Queue (48-Hour Turnaround SLA)</h2>
                <p style={{ fontSize: '13px', color: '#666', margin: '4px 0 0 0' }}>Sorted by priority (oldest preliminary test results first). Completed reads automatically leave this queue.</p>
              </div>
              <span style={{ backgroundColor: '#fff3cd', color: '#856404', padding: '6px 14px', borderRadius: '20px', fontSize: '12px', fontWeight: 'bold' }}>
                {pendingQueue.length} Pending Overread{pendingQueue.length === 1 ? '' : 's'}
              </span>
            </div>

            {loading ? <p>Loading queue...</p> : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#f8f9fa', borderBottom: '2px solid #e0e0e0', fontSize: '12px', color: '#555' }}>
                      <th style={{ padding: '12px' }}>Patient</th>
                      <th style={{ padding: '12px' }}>Clinic</th>
                      <th style={{ padding: '12px' }}>Testing Date</th>
                      <th style={{ padding: '12px' }}>Tests Ordered</th>
                      <th style={{ padding: '12px', textAlign: 'center' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendingQueue.length === 0 ? (
                      <tr>
                        <td colSpan="5" style={{ padding: '50px', textAlign: 'center', color: '#38a169', fontWeight: 'bold', fontSize: '15px' }}>
                          🎉 All caught up! No pending overreads in your queue.
                        </td>
                      </tr>
                    ) : (
                      pendingQueue.map(req => (
                        <tr key={req.request_id} style={{ borderBottom: '1px solid #eee', fontSize: '13px' }}>
                          <td style={{ padding: '12px' }}><strong>{req.patient_name || 'N/A'}</strong><br/><span style={{ fontSize: '11px', color: '#777' }}>{req.ordering_reason || ''}</span></td>
                          <td style={{ padding: '12px', color: '#555' }}>{req.clinic_name || 'N/A'}</td>
                          <td style={{ padding: '12px', color: '#555', whiteSpace: 'nowrap' }}>{req.requested_date ? new Date(req.requested_date).toLocaleDateString() : 'N/A'}</td>
                          <td style={{ padding: '12px', color: '#555' }}>{req.tests_ordered || 'N/A'}</td>
                          <td style={{ padding: '12px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                            <button onClick={() => { setSelectedRequest(req); setFinalInterpretation(req.recommended_interpretation || ''); setSignaturePin(''); }} style={{ backgroundColor: '#ffc107', color: '#212529', border: 'none', padding: '6px 14px', borderRadius: '4px', fontWeight: 'bold', fontSize: '12px', cursor: 'pointer' }}>
                              Review & Overread
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: PATIENT SEARCH & ARCHIVE */}
        {activeTab === 'search' && (
          <div style={{ backgroundColor: 'white', borderRadius: '8px', padding: '30px', boxShadow: '0 2px 10px rgba(0,0,0,0.05)' }}>
            <h2 style={{ marginTop: 0, color: '#1a2a47', fontSize: '20px', marginBottom: '20px' }}>Patient Search & Medical Record Archive</h2>
            
            <div style={{ display: 'flex', gap: '15px', marginBottom: '20px' }}>
              <input 
                type="text" 
                placeholder="Search patient name or clinic..." 
                value={searchTerm} 
                onChange={e => setSearchTerm(e.target.value)}
                style={{ flex: 1, padding: '10px', borderRadius: '4px', border: '1px solid #ccc' }}
              />
              <select 
                value={statusFilter} 
                onChange={e => setStatusFilter(e.target.value)}
                style={{ padding: '10px', borderRadius: '4px', border: '1px solid #ccc', backgroundColor: 'white' }}
              >
                <option value="ALL">All Statuses</option>
                <option value="PRELIMINARY_RESULTS">Pending Overread</option>
                <option value="COMPLETED">Completed</option>
                <option value="SCHEDULED">Scheduled</option>
              </select>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f8f9fa', borderBottom: '2px solid #e0e0e0', fontSize: '12px', color: '#555' }}>
                    <th style={{ padding: '12px' }}>Patient</th>
                    <th style={{ padding: '12px' }}>Clinic</th>
                    <th style={{ padding: '12px' }}>Testing Date</th>
                    <th style={{ padding: '12px' }}>Status</th>
                    <th style={{ padding: '12px', textAlign: 'center' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {searchResults.length === 0 ? (
                    <tr><td colSpan="5" style={{ padding: '30px', textAlign: 'center', color: '#888' }}>No patient records match your search criteria.</td></tr>
                  ) : (
                    searchResults.map(req => {
                      const badge = getStatusStyle(req.status);
                      return (
                        <tr key={req.request_id} style={{ borderBottom: '1px solid #eee', fontSize: '13px' }}>
                          <td style={{ padding: '12px' }}><strong>{req.patient_name || 'N/A'}</strong><br/><span style={{ fontSize: '11px', color: '#777' }}>{req.ordering_reason || ''}</span></td>
                          <td style={{ padding: '12px', color: '#555' }}>{req.clinic_name || 'N/A'}</td>
                          <td style={{ padding: '12px', color: '#555', whiteSpace: 'nowrap' }}>{req.requested_date ? new Date(req.requested_date).toLocaleDateString() : 'N/A'}</td>
                          <td style={{ padding: '12px' }}>
                            <span style={{ padding: '4px 10px', borderRadius: '20px', fontSize: '10px', fontWeight: 'bold', backgroundColor: badge.bg, color: badge.color, whiteSpace: 'nowrap' }}>
                              {(req.status || 'PENDING').replace('_', ' ')}
                            </span>
                          </td>
                          <td style={{ padding: '12px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                            <button onClick={() => { setSelectedRequest(req); setFinalInterpretation(req.interpretation || req.recommended_interpretation || ''); setSignaturePin(''); }} style={{ backgroundColor: '#17a2b8', color: 'white', border: 'none', padding: '6px 12px', borderRadius: '4px', fontWeight: 'bold', fontSize: '12px', cursor: 'pointer' }}>
                              {req.status === 'COMPLETED' ? 'View / Edit Results & PDF' : 'Review & Overread'}
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 3: ACCOUNT SECURITY */}
        {activeTab === 'account' && (
          <AccountManagement token={token} user={user} isForcedModal={false} />
        )}

      </main>

      {/* REVIEW / EDIT & FINALIZE MODAL */}
      {selectedRequest && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 9999 }}>
          <div style={{ backgroundColor: 'white', padding: '30px', borderRadius: '8px', width: '95%', maxWidth: '1400px', height: '90vh', boxShadow: '0 4px 20px rgba(0,0,0,0.2)', display: 'flex', flexDirection: 'column', boxSizing: 'border-box' }}>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px', borderBottom: '1px solid #e2e8f0', paddingBottom: '10px' }}>
              <h2 style={{ margin: 0, color: '#1a2a47', fontSize: '20px' }}>
                Physician Overread & Results: {selectedRequest.patient_name} <span style={{ fontSize: '14px', fontWeight: 'normal', color: '#718096' }}>({selectedRequest.clinic_name})</span>
              </h2>
              <button onClick={() => setSelectedRequest(null)} style={{ background: 'none', border: 'none', fontSize: '22px', fontWeight: 'bold', cursor: 'pointer', color: '#a0aec0' }}>&times;</button>
            </div>

            {/* SPLIT SCREEN: RAW PFT REPORT PDF ON LEFT, FORM ON RIGHT */}
            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '20px', flex: 1, overflow: 'hidden' }}>
              
              {/* LEFT: AUTHENTICATED RAW REPORT PDF VIEWER */}
              <div style={{ display: 'flex', flexDirection: 'column', border: '1px solid #cbd5e0', borderRadius: '6px', overflow: 'hidden', backgroundColor: '#f7fafc' }}>
                <div style={{ backgroundColor: '#edf2f7', padding: '8px 12px', fontSize: '13px', fontWeight: 'bold', color: '#2d3748', borderBottom: '1px solid #cbd5e0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>Uploaded PFT Report PDF</span>
                  <button onClick={() => viewPdfInNewTab(selectedRequest.request_id)} style={{ backgroundColor: '#3182ce', color: 'white', border: 'none', padding: '4px 10px', borderRadius: '4px', fontSize: '11px', cursor: 'pointer', fontWeight: 'bold' }}>
                    Open Fullscreen ↗
                  </button>
                </div>
                {pdfBlobUrl ? (
                  <iframe 
                    src={pdfBlobUrl} 
                    title="PFT Report PDF"
                    style={{ width: '100%', height: '100%', border: 'none' }}
                  />
                ) : (
                  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', color: '#718096', fontSize: '14px' }}>
                    Loading uploaded PFT report...
                  </div>
                )}
              </div>

              {/* RIGHT: INTERPRETATION & EDIT FORM */}
              <div style={{ display: 'flex', flexDirection: 'column', overflowY: 'auto', paddingRight: '5px' }}>
                <div style={{ backgroundColor: '#f8f9fa', padding: '12px', borderRadius: '6px', marginBottom: '15px', fontSize: '13px', border: '1px solid #e2e8f0' }}>
                  <p style={{ margin: '0 0 4px 0' }}><strong>Tests Ordered:</strong> {selectedRequest.tests_ordered || 'N/A'}</p>
                  <p style={{ margin: '0 0 4px 0' }}><strong>RRT Preliminary Findings:</strong> {selectedRequest.recommended_interpretation || 'None provided'}</p>
                  <p style={{ margin: 0 }}><strong>RRT Technical Notes:</strong> {selectedRequest.rrt_notes || 'None provided'}</p>
                </div>

                <div style={{ marginBottom: '15px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '5px' }}>
                    <label style={{ fontSize: '13px', fontWeight: 'bold', color: '#333' }}>Quick-Select Interpretation Presets</label>
                    <select 
                      onChange={e => { if (e.target.value) { addPreset(e.target.value); e.target.value = ''; } }}
                      defaultValue=""
                      style={{ padding: '4px 8px', fontSize: '12px', borderRadius: '4px', border: '1px solid #cbd5e0', backgroundColor: '#f7fafc', cursor: 'pointer' }}
                    >
                      <option value="" disabled>+ Insert Standard Interpretation...</option>
                      {FINAL_INTERPRETATION_PRESETS.map((preset, idx) => (
                        <option key={idx} value={preset}>{preset}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <form onSubmit={handleFinalizeReview} style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                  <div style={{ marginBottom: '15px', flex: 1, display: 'flex', flexDirection: 'column' }}>
                    <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px', fontWeight: 'bold', color: '#333' }}>Final Physician Overread & Interpretation</label>
                    <textarea 
                      rows="6" 
                      value={finalInterpretation} 
                      onChange={e => setFinalInterpretation(e.target.value)} 
                      placeholder="Enter final diagnostic interpretation overread..." 
                      style={{ width: '100%', flex: 1, minHeight: '120px', padding: '10px', borderRadius: '4px', border: '1px solid #ccc', boxSizing: 'border-box' }}
                      required
                    />
                  </div>

                  <div style={{ marginBottom: '20px' }}>
                    <label style={{ display: 'block', marginBottom: '5px', fontSize: '13px', fontWeight: 'bold', color: '#333' }}>Physician Signature PIN (Required)</label>
                    <input 
                      type="password" 
                      placeholder="Enter your secure signature PIN..." 
                      value={signaturePin} 
                      onChange={e => setSignaturePin(e.target.value)} 
                      style={{ width: '100%', padding: '10px', borderRadius: '4px', border: '1px solid #ccc', boxSizing: 'border-box' }}
                      required 
                    />
                  </div>

                  <div style={{ display: 'flex', gap: '10px' }}>
                    <button type="submit" style={{ flex: 1, padding: '12px', backgroundColor: '#28a745', color: 'white', border: 'none', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer' }}>
                      Sign, Update & Resend Results
                    </button>
                    <button type="button" onClick={() => setSelectedRequest(null)} style={{ padding: '12px 20px', backgroundColor: '#6c757d', color: 'white', border: 'none', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer' }}>
                      Cancel
                    </button>
                  </div>
                </form>
              </div>

            </div>

          </div>
        </div>
      )}

    </div>
  );
}