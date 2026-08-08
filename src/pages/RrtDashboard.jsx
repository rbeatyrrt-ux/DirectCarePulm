import React, { useState, useEffect } from 'react';
import AccountManagement from '../components/AccountManagement';

const PRETESTING_PRESETS = [
  'Short-acting bronchodilators withheld for 6 to 8 hours prior to testing.',
  'Long-acting bronchodilators withheld for 12 hours prior to testing.',
  'Ultra-long bronchodilators withheld for 24 hours prior to testing.',
  'Inhaler used prior to arrival (within 2 hours); baseline results may be elevated.',
  'Patient refused post-BD medication; testing completed at baseline only.'
];

const EFFORT_PRESETS = [
  'Good effort and cooperation: Patient understood instructions, blew with maximum force, and met all ATS/ERS acceptability and repeatability criteria.',
  'Submaximal effort noted: Patient did not blast out with full force or stopped exhaling prematurely.',
  'Variable effort between trials: Inconsistent performance across breath maneuvers.',
  'Poor cooperation: Patient was unable or unwilling to follow continuous verbal coaching.',
  'Test terminated due to patient fatigue: Patient became too exhausted or lightheaded to finish.'
];

const ARTIFACT_PRESETS = [
  'Cough artifact detected during the first second of exhalation, invalidating FEV1.',
  'Early termination of exhalation: Patient stopped blowing out before reaching a true plateau (<6 seconds).',
  'Glottic closure / abrupt stop noted during forced exhalation.',
  'Poor seal around mouthpiece with visible or audible air leak during testing.',
  'Hesitant start / slow rise time with an unacceptably high back-extrapolation volume.'
];

const BRONCHODILATOR_PRESETS = [
  'Post-BD testing performed: Administered 4 puffs of Albuterol metered-dose inhaler; repeated spirometry after a 15-minute post-administration wait.',
  'Withheld bronchodilator prior to test: Patient confirmed compliance with instructions to avoid rescue inhalers before arrival.',
  'Patient refused post-bronchodilator medication due to high heart rate or patient preference.'
];

const OBSERVATION_PRESETS = [
  'Severe dyspnea on exertion requiring multiple rest breaks between maneuvers.',
  'Language barrier present; testing coordinated via a medical translator or visual gestures.',
  'Physical limitations noted (tremors, dental issues, or cognitive impairment) affecting mouthpiece seal.'
];

const MDI_EDUCATION_PRESETS = [
  'Demonstrated proper metered-dose inhaler (MDI) technique with spacer/valved holding chamber.',
  'Reviewed actuation coordination, slow deep inspiration, and 10-second breath-hold.',
  'Patient successfully demonstrated return-demonstration of MDI technique.',
  'Provided written MDI instructional handout and reviewed maintenance/cleaning.'
];

const ATS_GOLD_INTERPRETATION_PRESETS = [
  'Normal spirometry: FEV1/FVC ratio and FVC are within normal limits (>= LLN).',
  'GOLD 1: Mild obstructive ventilatory defect (FEV1 >= 80 percent predicted with reduced FEV1/FVC).',
  'GOLD 2: Moderate obstructive ventilatory defect (50 percent <= FEV1 < 80 percent predicted).',
  'GOLD 3: Severe obstructive ventilatory defect (30 percent <= FEV1 < 50 percent predicted).',
  'GOLD 4: Very severe obstructive ventilatory defect (FEV1 < 30 percent predicted).',
  'Mild restrictive ventilatory defect suspected (TLC 70 to 80 percent predicted; confirmatory plethysmography recommended).',
  'Moderate restrictive ventilatory defect suspected (TLC 50 to 69 percent predicted).',
  'Severe restrictive ventilatory defect suspected (TLC < 50 percent predicted).',
  'Mixed ventilatory defect showing evidence of both airway obstruction and restriction.',
  'Non-specific ventilatory abnormality with reduced FVC and FEV1 but preserved FEV1/FVC ratio.',
  'Significant positive bronchodilator response demonstrating an increase in FEV1 and/or FVC >= 12 percent and >= 200 mL post-BD (ATS/ERS criteria).',
  'No significant bronchodilator response following bronchodilator administration.',
  'Mildly impaired diffusion capacity (DLCO) suggesting alveolar-capillary membrane pathology.',
  'Moderately to severely impaired diffusion capacity (DLCO).'
];

export default function RrtDashboard({ token, user, onLogout }) {
  const [activeTab, setActiveTab] = useState('orders');
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(false);
  const [mustChangePassword, setMustChangePassword] = useState(false);

  // Filter states
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');

  // View Signed Order Details Modal State
  const [selectedOrderDetails, setSelectedOrderDetails] = useState(null);

  // Upload Results Wizard State
  const [selectedUploadRequest, setSelectedUploadRequest] = useState(null);
  const [wizardStep, setWizardStep] = useState(1);
  const [uploadFile, setUploadFile] = useState(null);
  const [rrtSignaturePin, setRrtSignaturePin] = useState('');

  // Wizard selections & "No Comments" toggles
  const [selectedPretesting, setSelectedPretesting] = useState([]);
  const [noPretesting, setNoPretesting] = useState(false);

  const [selectedEffort, setSelectedEffort] = useState([]);
  const [noEffort, setNoEffort] = useState(false);

  const [selectedArtifacts, setSelectedArtifacts] = useState([]);
  const [noArtifacts, setNoArtifacts] = useState(false);

  const [selectedBronch, setSelectedBronch] = useState([]);
  const [noBronch, setNoBronch] = useState(false);

  const [selectedObservations, setSelectedObservations] = useState([]);
  const [noObservations, setNoObservations] = useState(false);

  const [selectedMdiEducation, setSelectedMdiEducation] = useState([]);
  const [noMdi, setNoMdi] = useState(false);
  const [customMdiText, setCustomMdiText] = useState('');

  const [selectedAtsPresets, setSelectedAtsPresets] = useState([]);
  const [customInterpretationText, setCustomInterpretationText] = useState('');
  const [noInterpretation, setNoInterpretation] = useState(false);

  useEffect(() => {
    if (token) {
      checkProfileStatus();
      fetchRequests();
    }
  }, [token]);

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
      if (res.ok) setRequests(data);
    } catch (err) {
      console.error('Failed to fetch requests', err);
    } finally {
      setLoading(false);
    }
  };

  const handleUploadPreliminary = async (e) => {
    e.preventDefault();
    if (!selectedUploadRequest) return;
    if (!rrtSignaturePin) {
      alert('Signature PIN is required to sign and submit preliminary results.');
      return;
    }

    const pretestingText = noPretesting || selectedPretesting.length === 0 
      ? 'Pretesting & Medication Management: No comments' 
      : `Pretesting & Medication Management:\n- ${selectedPretesting.join('\n- ')}`;

    const effortText = noEffort || selectedEffort.length === 0 
      ? 'Patient Effort & Technical Quality: No comments' 
      : `Patient Effort & Technical Quality:\n- ${selectedEffort.join('\n- ')}`;

    const artifactText = noArtifacts || selectedArtifacts.length === 0 
      ? 'Technical Maneuver Artifacts: No comments' 
      : `Technical Maneuver Artifacts:\n- ${selectedArtifacts.join('\n- ')}`;

    const bronchText = noBronch || selectedBronch.length === 0 
      ? 'Bronchodilator Administration Comments: No comments' 
      : `Bronchodilator Administration Comments:\n- ${selectedBronch.join('\n- ')}`;

    const observationText = noObservations || selectedObservations.length === 0 
      ? 'Clinical Observations & Limitations: No comments' 
      : `Clinical Observations & Limitations:\n- ${selectedObservations.join('\n- ')}`;

    const compiledRrtNotes = [pretestingText, effortText, artifactText, bronchText, observationText].join('\n\n');

    const mdiItems = [...selectedMdiEducation, customMdiText.trim()].filter(Boolean);
    const compiledMdiEducation = noMdi || mdiItems.length === 0 
      ? 'MDI Instruction & Education: No comments' 
      : `MDI Instruction & Education:\n- ${mdiItems.join('\n- ')}`;

    const interpretationItems = [...selectedAtsPresets, customInterpretationText.trim()].filter(Boolean);
    const compiledInterpretation = noInterpretation || interpretationItems.length === 0 
      ? 'Preliminary ATS / GOLD Interpretation: No comments' 
      : `Preliminary ATS / GOLD Interpretation:\n- ${interpretationItems.join('\n- ')}`;

    const formData = new FormData();
    if (uploadFile) formData.append('report', uploadFile);
    formData.append('rrt_notes', compiledRrtNotes);
    formData.append('mdi_education', compiledMdiEducation);
    formData.append('recommended_interpretation', compiledInterpretation);
    formData.append('signature_pin', rrtSignaturePin);

    try {
      const res = await fetch(`http://localhost:5000/api/requests/${selectedUploadRequest.request_id}/preliminary`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` },
        body: formData
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update preliminary results');

      alert('Preliminary results signed and submitted successfully!');
      setSelectedUploadRequest(null);
      setWizardStep(1);
      setUploadFile(null);
      setRrtSignaturePin('');
      setSelectedPretesting([]); setNoPretesting(false);
      setSelectedEffort([]); setNoEffort(false);
      setSelectedArtifacts([]); setNoArtifacts(false);
      setSelectedBronch([]); setNoBronch(false);
      setSelectedObservations([]); setNoObservations(false);
      setSelectedMdiEducation([]); setNoMdi(false); setCustomMdiText('');
      setSelectedAtsPresets([]); setCustomInterpretationText(''); setNoInterpretation(false);
      fetchRequests();
    } catch (err) {
      alert(err.message);
    }
  };

  const downloadPdf = async (id) => {
    try {
      const res = await fetch(`http://localhost:5000/api/requests/${id}/pdf`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Failed to generate PDF');
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Final_Clinical_Report_${id}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) { alert(err.message); }
  };

  const toggleListSelection = (list, setList, item) => {
    if (list.includes(item)) {
      setList(list.filter(i => i !== item));
    } else {
      setList([...list, item]);
    }
  };

  const filteredRequests = requests.filter(req => {
    const matchesSearch = (req.patient_name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
                          (req.clinic_name || '').toLowerCase().includes(searchTerm.toLowerCase());
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
            <h1 style={{ margin: 0, fontSize: '22px', color: 'white' }}>DirectCare RRT Testing & Workflow Portal</h1>
            <span style={{ fontSize: '13px', color: '#a0aec0' }}>RRT Clinician: <strong>{user?.full_name}</strong> ({user?.credentials || 'RRT'})</span>
          </div>
          <button onClick={onLogout} style={{ backgroundColor: 'transparent', color: 'white', border: '1px solid white', padding: '8px 20px', borderRadius: '4px', cursor: 'pointer', fontSize: '14px' }}>
            Log Out
          </button>
        </div>

        <div style={{ padding: '0 40px', display: 'flex', borderBottom: '2px solid #f4f6f9' }}>
          <button style={tabStyle('orders')} onClick={() => setActiveTab('orders')}>Scheduled Patients & Testing Queue</button>
          <button style={tabStyle('calendar')} onClick={() => setActiveTab('calendar')}>Testing Calendar</button>
          <button style={tabStyle('account')} onClick={() => setActiveTab('account')}>Account Security</button>
        </div>
      </header>

      {/* MAIN CONTENT AREA */}
      <main style={{ padding: '40px', maxWidth: '1600px', margin: '0 auto' }}>
        
        {/* TAB 1: SCHEDULED PATIENTS & TESTING QUEUE */}
        {activeTab === 'orders' && (
          <div style={{ backgroundColor: 'white', borderRadius: '8px', padding: '30px', boxShadow: '0 2px 10px rgba(0,0,0,0.05)' }}>
            <h2 style={{ marginTop: 0, color: '#1a2a47', fontSize: '20px', marginBottom: '20px' }}>RRT Testing & Report Upload Queue</h2>
            
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
                <option value="SCHEDULED">Scheduled (Ready for Test & Upload)</option>
                <option value="PRELIMINARY_RESULTS">Preliminary Results (Submitted)</option>
                <option value="COMPLETED">Completed</option>
              </select>
            </div>

            {loading ? <p>Loading testing queue...</p> : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#f8f9fa', borderBottom: '2px solid #e0e0e0', fontSize: '12px', color: '#555' }}>
                      <th style={{ padding: '12px' }}>Patient</th>
                      <th style={{ padding: '12px' }}>Clinic</th>
                      <th style={{ padding: '12px' }}>Testing Date & Slot</th>
                      <th style={{ padding: '12px' }}>Tests Ordered</th>
                      <th style={{ padding: '12px' }}>Status</th>
                      <th style={{ padding: '12px', textAlign: 'center' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRequests.length === 0 ? (
                      <tr><td colSpan="6" style={{ padding: '30px', textAlign: 'center', color: '#888' }}>No scheduled patient testing requests found.</td></tr>
                    ) : (
                      filteredRequests.map(req => {
                        const badge = getStatusStyle(req.status);
                        return (
                          <tr key={req.request_id} style={{ borderBottom: '1px solid #eee', fontSize: '13px' }}>
                            <td style={{ padding: '12px' }}>
                              <strong>{req.patient_name || 'N/A'}</strong><br/>
                              <span style={{ fontSize: '11px', color: '#555' }}>DOB: {req.patient_dob ? new Date(req.patient_dob).toLocaleDateString() : 'N/A'}</span><br/>
                              <span style={{ fontSize: '11px', color: '#777' }}>{req.ordering_reason || ''}</span>
                            </td>
                            <td style={{ padding: '12px', color: '#555' }}>{req.clinic_name || 'N/A'}</td>
                            <td style={{ padding: '12px', color: '#555', whiteSpace: 'nowrap' }}>
                              {req.requested_date ? new Date(req.requested_date).toLocaleDateString() : 'N/A'} <br/>
                              <span style={{ fontSize: '11px', color: '#718096', fontWeight: '500' }}>
                                {req.time_block ? req.time_block.replace('_', ' - ') : ''}
                              </span>
                            </td>
                            <td style={{ padding: '12px', color: '#555', fontSize: '12px' }}>{req.tests_ordered || 'N/A'}</td>
                            <td style={{ padding: '12px' }}>
                              <span style={{ padding: '4px 10px', borderRadius: '20px', fontSize: '10px', fontWeight: 'bold', backgroundColor: badge.bg, color: badge.color, whiteSpace: 'nowrap' }}>
                                {(req.status || 'PENDING').replace('_', ' ')}
                              </span>
                            </td>
                            <td style={{ padding: '12px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                              <button onClick={() => setSelectedOrderDetails(req)} style={{ backgroundColor: '#3182ce', color: 'white', border: 'none', padding: '6px 12px', borderRadius: '4px', fontWeight: 'bold', fontSize: '12px', cursor: 'pointer', marginRight: '6px' }}>
                                View Order
                              </button>
                              {(req.status === 'SCHEDULED' || req.status === 'PRELIMINARY_RESULTS') && (
                                <button onClick={() => { setSelectedUploadRequest(req); setWizardStep(1); setRrtSignaturePin(''); setSelectedPretesting([]); setNoPretesting(false); setSelectedEffort([]); setNoEffort(false); setSelectedArtifacts([]); setNoArtifacts(false); setSelectedBronch([]); setNoBronch(false); setSelectedObservations([]); setNoObservations(false); setSelectedMdiEducation([]); setNoMdi(false); setCustomMdiText(''); setSelectedAtsPresets([]); setCustomInterpretationText(''); setNoInterpretation(false); }} style={{ backgroundColor: '#17a2b8', color: 'white', border: 'none', padding: '6px 12px', borderRadius: '4px', fontWeight: 'bold', fontSize: '12px', cursor: 'pointer', marginRight: '6px' }}>
                                  {req.status === 'PRELIMINARY_RESULTS' ? 'Edit Wizard & Notes' : 'Upload Results PDF'}
                                </button>
                              )}
                              {req.status === 'COMPLETED' && (
                                <button onClick={() => downloadPdf(req.request_id)} style={{ backgroundColor: '#28a745', color: 'white', border: 'none', padding: '6px 12px', borderRadius: '4px', fontWeight: 'bold', fontSize: '12px', cursor: 'pointer' }}>
                                  Download Final PDF
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: TESTING CALENDAR */}
        {activeTab === 'calendar' && (
          <div style={{ backgroundColor: 'white', borderRadius: '8px', padding: '30px', boxShadow: '0 2px 10px rgba(0,0,0,0.05)' }}>
            <h2 style={{ margin: '0 0 20px 0', color: '#1a2a47', fontSize: '20px' }}>August 2026 Testing Schedule Calendar</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '10px', textAlign: 'center' }}>
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                <div key={day} style={{ padding: '10px', fontWeight: 'bold', backgroundColor: '#1a2a47', color: 'white', borderRadius: '4px', fontSize: '12px' }}>
                  {day}
                </div>
              ))}
              {[...Array(6)].map((_, i) => (
                <div key={`empty-${i}`} style={{ minHeight: '90px', backgroundColor: '#f7fafc', borderRadius: '4px', opacity: 0.3 }} />
              ))}
              {[...Array(31)].map((_, i) => {
                const dayNum = i + 1;
                const formattedDate = `2026-08-${dayNum < 10 ? '0' + dayNum : dayNum}`;
                const dayAppointments = requests.filter(r => r.requested_date && r.requested_date.startsWith(formattedDate));

                return (
                  <div key={dayNum} style={{ minHeight: '100px', border: '1px solid #e2e8f0', borderRadius: '4px', padding: '6px', backgroundColor: dayAppointments.length > 0 ? '#ebf8ff' : 'white', textAlign: 'left' }}>
                    <span style={{ fontSize: '12px', fontWeight: 'bold', color: '#4a5568' }}>{dayNum}</span>
                    <div style={{ marginTop: '4px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      {dayAppointments.map(app => (
                        <div key={app.request_id} style={{ backgroundColor: '#3182ce', color: 'white', padding: '3px 6px', borderRadius: '3px', fontSize: '10px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={`${app.patient_name} (${app.clinic_name})`}>
                          <strong>{app.time_block ? app.time_block.split('_')[0] : ''}</strong> {app.patient_name}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* TAB 3: ACCOUNT SECURITY */}
        {activeTab === 'account' && (
          <AccountManagement token={token} user={user} isForcedModal={false} />
        )}

      </main>

      {/* SIGNED ORDER DETAILS MODAL */}
      {selectedOrderDetails && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 9999 }}>
          <div style={{ backgroundColor: 'white', padding: '35px', borderRadius: '8px', width: '650px', boxShadow: '0 4px 20px rgba(0,0,0,0.2)', maxHeight: '90vh', overflowY: 'auto' }}>
            <h2 style={{ marginTop: 0, color: '#1a2a47', fontSize: '18px' }}>Signed Order Details & Clinical Summary</h2>
            
            <div style={{ backgroundColor: '#f8f9fa', padding: '15px', borderRadius: '6px', marginBottom: '20px', fontSize: '13px' }}>
              <p style={{ margin: '0 0 6px 0' }}><strong>Patient Name:</strong> {selectedOrderDetails.patient_name}</p>
              <p style={{ margin: '0 0 6px 0' }}><strong>Date of Birth:</strong> {selectedOrderDetails.patient_dob ? new Date(selectedOrderDetails.patient_dob).toLocaleDateString() : 'N/A'}</p>
              <p style={{ margin: '0 0 6px 0' }}><strong>Insurance / Payer:</strong> {selectedOrderDetails.insurance_type || 'N/A'}</p>
              <p style={{ margin: '0 0 6px 0' }}><strong>Clinic Name:</strong> {selectedOrderDetails.clinic_name || 'N/A'}</p>
              <p style={{ margin: '0 0 6px 0' }}><strong>Testing Date & Slot:</strong> {selectedOrderDetails.requested_date ? new Date(selectedOrderDetails.requested_date).toLocaleDateString() : 'N/A'} ({selectedOrderDetails.time_block ? selectedOrderDetails.time_block.replace('_', ' - ') : 'N/A'})</p>
              <hr style={{ border: '0', borderTop: '1px solid #ddd', margin: '12px 0' }}/>
              <p style={{ margin: '0 0 6px 0' }}><strong>Tests & CPT Ordered:</strong></p>
              <p style={{ margin: '0 0 10px 0', color: '#2b6cb0', fontWeight: 'bold' }}>{selectedOrderDetails.tests_ordered}</p>
              <p style={{ margin: '0 0 6px 0' }}><strong>Ordering Reason / Clinical Indication / Comments:</strong></p>
              <p style={{ margin: '0 0 10px 0', whiteSpace: 'pre-wrap', color: '#2d3748' }}>{selectedOrderDetails.ordering_reason || 'None specified.'}</p>
              
              {/* Electronic Signature Metadata Display */}
              <div style={{ backgroundColor: '#fff', border: '1px solid #cbd5e0', borderRadius: '6px', padding: '12px', marginTop: '10px' }}>
                <p style={{ margin: '0 0 6px 0', fontWeight: 'bold', color: '#1a2a47', fontSize: '12px', textTransform: 'uppercase' }}>Electronic Signature & Attestation</p>
                <p style={{ margin: '0 0 4px 0' }}><strong>Ordering / Attesting Provider:</strong> {selectedOrderDetails.prov_name || 'Independent Order'} ({selectedOrderDetails.prov_credentials || 'Provider'})</p>
                <p style={{ margin: '0 0 4px 0' }}><strong>Provider NPI:</strong> {selectedOrderDetails.prov_npi || 'N/A'}</p>
                <p style={{ margin: '0 0 4px 0' }}><strong>Order Status:</strong> <span style={{ color: '#2b6cb0', fontWeight: 'bold' }}>{selectedOrderDetails.status.replace('_', ' ')}</span></p>
                {selectedOrderDetails.phys_name && (
                  <p style={{ margin: '4px 0 0 0' }}><strong>Interpreting Physician (Overread):</strong> {selectedOrderDetails.phys_name} ({selectedOrderDetails.phys_credentials || 'MD'}) — NPI: {selectedOrderDetails.phys_npi || 'N/A'}</p>
                )}
              </div>
            </div>

            <button onClick={() => setSelectedOrderDetails(null)} style={{ width: '100%', padding: '10px', backgroundColor: '#6c757d', color: 'white', border: 'none', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer' }}>
              Close
            </button>
          </div>
        </div>
      )}

      {/* UPLOAD RESULTS PDF WIZARD MODAL */}
      {selectedUploadRequest && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 9999 }}>
          <div style={{ backgroundColor: 'white', padding: '35px', borderRadius: '8px', width: '700px', boxShadow: '0 4px 20px rgba(0,0,0,0.2)', maxHeight: '90vh', overflowY: 'auto' }}>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
              <h2 style={{ margin: 0, color: '#1a2a47', fontSize: '18px' }}>RRT Testing Wizard ({wizardStep} of 7)</h2>
              <span style={{ fontSize: '12px', fontWeight: 'bold', color: '#718096', backgroundColor: '#edf2f7', padding: '4px 10px', borderRadius: '12px' }}>
                Step {wizardStep} / 7
              </span>
            </div>

            <div style={{ backgroundColor: '#f8f9fa', padding: '12px', borderRadius: '6px', marginBottom: '20px', fontSize: '12px' }}>
              <p style={{ margin: '0 0 3px 0' }}><strong>Patient:</strong> {selectedUploadRequest.patient_name || 'N/A'}</p>
              <p style={{ margin: 0 }}><strong>Tests Ordered:</strong> {selectedUploadRequest.tests_ordered || 'N/A'}</p>
            </div>

            <form onSubmit={wizardStep === 7 ? handleUploadPreliminary : (e) => { e.preventDefault(); setWizardStep(prev => prev + 1); }}>
              
              {/* STEP 1: PRETESTING */}
              {wizardStep === 1 && (
                <div>
                  <div style={{ marginBottom: '20px' }}>
                    <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 'bold', color: '#333' }}>1. Upload / Replace PFT Report (PDF)</label>
                    <input 
                      type="file" 
                      accept="application/pdf"
                      onChange={e => setUploadFile(e.target.files[0])} 
                      style={{ width: '100%', padding: '10px', borderRadius: '4px', border: '1px solid #ccc', boxSizing: 'border-box', backgroundColor: '#fafafa' }}
                    />
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                    <h3 style={{ fontSize: '14px', color: '#1a2a47', margin: 0 }}>Pretesting & Medication Management</h3>
                    <label style={{ fontSize: '12px', color: '#c53030', fontWeight: 'bold', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px' }}>
                      <input type="checkbox" checked={noPretesting} onChange={e => setNoPretesting(e.target.checked)} />
                      No comments for this section
                    </label>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '200px', overflowY: 'auto', border: '1px solid #cbd5e0', padding: '10px', borderRadius: '4px', backgroundColor: '#f8f9fa', opacity: noPretesting ? 0.4 : 1, pointerEvents: noPretesting ? 'none' : 'auto' }}>
                    {PRETESTING_PRESETS.map((item, idx) => (
                      <label key={idx} style={{ display: 'flex', alignItems: 'flex-start', fontSize: '12px', cursor: 'pointer' }}>
                        <input 
                          type="checkbox" 
                          checked={selectedPretesting.includes(item)}
                          onChange={() => toggleListSelection(selectedPretesting, setSelectedPretesting, item)}
                          style={{ marginRight: '8px', marginTop: '2px' }}
                        />
                        <span>{item}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* STEP 2: EFFORT */}
              {wizardStep === 2 && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                    <h3 style={{ fontSize: '14px', color: '#1a2a47', margin: 0 }}>Patient Effort and Technical Quality</h3>
                    <label style={{ fontSize: '12px', color: '#c53030', fontWeight: 'bold', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px' }}>
                      <input type="checkbox" checked={noEffort} onChange={e => setNoEffort(e.target.checked)} />
                      No comments for this section
                    </label>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '250px', overflowY: 'auto', border: '1px solid #cbd5e0', padding: '10px', borderRadius: '4px', backgroundColor: '#f8f9fa', opacity: noEffort ? 0.4 : 1, pointerEvents: noEffort ? 'none' : 'auto' }}>
                    {EFFORT_PRESETS.map((item, idx) => (
                      <label key={idx} style={{ display: 'flex', alignItems: 'flex-start', fontSize: '12px', cursor: 'pointer' }}>
                        <input 
                          type="checkbox" 
                          checked={selectedEffort.includes(item)}
                          onChange={() => toggleListSelection(selectedEffort, setSelectedEffort, item)}
                          style={{ marginRight: '8px', marginTop: '2px' }}
                        />
                        <span>{item}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* STEP 3: ARTIFACTS */}
              {wizardStep === 3 && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                    <h3 style={{ fontSize: '14px', color: '#1a2a47', margin: 0 }}>Technical Maneuver Artifacts</h3>
                    <label style={{ fontSize: '12px', color: '#c53030', fontWeight: 'bold', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px' }}>
                      <input type="checkbox" checked={noArtifacts} onChange={e => setNoArtifacts(e.target.checked)} />
                      No comments for this section
                    </label>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '250px', overflowY: 'auto', border: '1px solid #cbd5e0', padding: '10px', borderRadius: '4px', backgroundColor: '#f8f9fa', opacity: noArtifacts ? 0.4 : 1, pointerEvents: noArtifacts ? 'none' : 'auto' }}>
                    {ARTIFACT_PRESETS.map((item, idx) => (
                      <label key={idx} style={{ display: 'flex', alignItems: 'flex-start', fontSize: '12px', cursor: 'pointer' }}>
                        <input 
                          type="checkbox" 
                          checked={selectedArtifacts.includes(item)}
                          onChange={() => toggleListSelection(selectedArtifacts, setSelectedArtifacts, item)}
                          style={{ marginRight: '8px', marginTop: '2px' }}
                        />
                        <span>{item}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* STEP 4: BRONCHODILATOR */}
              {wizardStep === 4 && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                    <h3 style={{ fontSize: '14px', color: '#1a2a47', margin: 0 }}>Bronchodilator Administration Comments</h3>
                    <label style={{ fontSize: '12px', color: '#c53030', fontWeight: 'bold', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px' }}>
                      <input type="checkbox" checked={noBronch} onChange={e => setNoBronch(e.target.checked)} />
                      No comments for this section
                    </label>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '250px', overflowY: 'auto', border: '1px solid #cbd5e0', padding: '10px', borderRadius: '4px', backgroundColor: '#f8f9fa', opacity: noBronch ? 0.4 : 1, pointerEvents: noBronch ? 'none' : 'auto' }}>
                    {BRONCHODILATOR_PRESETS.map((item, idx) => (
                      <label key={idx} style={{ display: 'flex', alignItems: 'flex-start', fontSize: '12px', cursor: 'pointer' }}>
                        <input 
                          type="checkbox" 
                          checked={selectedBronch.includes(item)}
                          onChange={() => toggleListSelection(selectedBronch, setSelectedBronch, item)}
                          style={{ marginRight: '8px', marginTop: '2px' }}
                        />
                        <span>{item}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* STEP 5: OBSERVATIONS */}
              {wizardStep === 5 && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                    <h3 style={{ fontSize: '14px', color: '#1a2a47', margin: 0 }}>Clinical Observations and Physical Limitations</h3>
                    <label style={{ fontSize: '12px', color: '#c53030', fontWeight: 'bold', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px' }}>
                      <input type="checkbox" checked={noObservations} onChange={e => setNoObservations(e.target.checked)} />
                      No comments for this section
                    </label>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '250px', overflowY: 'auto', border: '1px solid #cbd5e0', padding: '10px', borderRadius: '4px', backgroundColor: '#f8f9fa', opacity: noObservations ? 0.4 : 1, pointerEvents: noObservations ? 'none' : 'auto' }}>
                    {OBSERVATION_PRESETS.map((item, idx) => (
                      <label key={idx} style={{ display: 'flex', alignItems: 'flex-start', fontSize: '12px', cursor: 'pointer' }}>
                        <input 
                          type="checkbox" 
                          checked={selectedObservations.includes(item)}
                          onChange={() => toggleListSelection(selectedObservations, setSelectedObservations, item)}
                          style={{ marginRight: '8px', marginTop: '2px' }}
                        />
                        <span>{item}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* STEP 6: MDI EDUCATION */}
              {wizardStep === 6 && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                    <h3 style={{ fontSize: '14px', color: '#1a2a47', margin: 0 }}>MDI Instruction & Education Provided (CPT 94664)</h3>
                    <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
                      <button 
                        type="button" 
                        onClick={() => setSelectedMdiEducation(selectedMdiEducation.length === MDI_EDUCATION_PRESETS.length ? [] : [...MDI_EDUCATION_PRESETS])}
                        style={{ background: 'none', border: 'none', color: '#3182ce', fontSize: '12px', fontWeight: 'bold', cursor: 'pointer', padding: 0 }}
                      >
                        {selectedMdiEducation.length === MDI_EDUCATION_PRESETS.length ? 'Deselect All' : 'Select All'}
                      </button>
                      <label style={{ fontSize: '12px', color: '#c53030', fontWeight: 'bold', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px', margin: 0 }}>
                        <input type="checkbox" checked={noMdi} onChange={e => setNoMdi(e.target.checked)} />
                        No comments
                      </label>
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '140px', overflowY: 'auto', border: '1px solid #cbd5e0', padding: '10px', borderRadius: '4px', backgroundColor: '#f8f9fa', marginBottom: '12px', opacity: noMdi ? 0.4 : 1, pointerEvents: noMdi ? 'none' : 'auto' }}>
                    {MDI_EDUCATION_PRESETS.map((item, idx) => (
                      <label key={idx} style={{ display: 'flex', alignItems: 'flex-start', fontSize: '12px', cursor: 'pointer' }}>
                        <input 
                          type="checkbox" 
                          checked={selectedMdiEducation.includes(item)}
                          onChange={() => toggleListSelection(selectedMdiEducation, setSelectedMdiEducation, item)}
                          style={{ marginRight: '8px', marginTop: '2px' }}
                        />
                        <span>{item}</span>
                      </label>
                    ))}
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: '5px', fontSize: '12px', fontWeight: 'bold', color: '#333' }}>Custom MDI Education Notes</label>
                    <textarea 
                      rows="3" 
                      placeholder="Enter custom MDI education details..." 
                      value={customMdiText} 
                      onChange={e => setCustomMdiText(e.target.value)} 
                      style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ccc', boxSizing: 'border-box', fontSize: '12px' }}
                    />
                  </div>
                </div>
              )}

              {/* STEP 7: ATS / GOLD INTERPRETATIONS */}
              {wizardStep === 7 && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                    <h3 style={{ fontSize: '14px', color: '#1a2a47', margin: 0 }}>Preliminary Diagnosis & ATS / GOLD Interpretations</h3>
                    <label style={{ fontSize: '12px', color: '#c53030', fontWeight: 'bold', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px' }}>
                      <input type="checkbox" checked={noInterpretation} onChange={e => setNoInterpretation(e.target.checked)} />
                      No interpretation comments
                    </label>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '140px', overflowY: 'auto', border: '1px solid #cbd5e0', padding: '10px', borderRadius: '4px', backgroundColor: '#f8f9fa', marginBottom: '12px', opacity: noInterpretation ? 0.4 : 1, pointerEvents: noInterpretation ? 'none' : 'auto' }}>
                    {ATS_GOLD_INTERPRETATION_PRESETS.map((item, idx) => (
                      <label key={idx} style={{ display: 'flex', alignItems: 'flex-start', fontSize: '12px', cursor: 'pointer' }}>
                        <input 
                          type="checkbox" 
                          checked={selectedAtsPresets.includes(item)}
                          onChange={() => toggleListSelection(selectedAtsPresets, setSelectedAtsPresets, item)}
                          style={{ marginRight: '8px', marginTop: '2px' }}
                        />
                        <span>{item}</span>
                      </label>
                    ))}
                  </div>

                  <div style={{ marginBottom: '15px' }}>
                    <label style={{ display: 'block', marginBottom: '5px', fontSize: '12px', fontWeight: 'bold', color: '#333' }}>Custom Interpretation & Clinical Commentary (Free-Text)</label>
                    <textarea 
                      rows="3" 
                      placeholder="Enter custom interpretation notes or specific clinical commentary..." 
                      value={customInterpretationText} 
                      onChange={e => setCustomInterpretationText(e.target.value)} 
                      style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ccc', boxSizing: 'border-box', fontSize: '12px' }}
                    />
                  </div>

                  <div style={{ backgroundColor: '#fffaf0', border: '1px solid #feebc8', borderRadius: '6px', padding: '12px' }}>
                    <label style={{ display: 'block', marginBottom: '5px', fontSize: '12px', fontWeight: 'bold', color: '#c05621' }}>Admin Signature PIN (Required to Sign Preliminary Results)</label>
                    <input 
                      type="password" 
                      placeholder="Enter your signature PIN..." 
                      value={rrtSignaturePin} 
                      onChange={e => setRrtSignaturePin(e.target.value)} 
                      style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #cbd5e0', boxSizing: 'border-box', backgroundColor: 'white' }}
                      required 
                    />
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', gap: '10px', marginTop: '25px' }}>
                {wizardStep > 1 && (
                  <button type="button" onClick={() => setWizardStep(prev => prev - 1)} style={{ padding: '10px 20px', backgroundColor: '#6c757d', color: 'white', border: 'none', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer' }}>
                    Back
                  </button>
                )}
                
                {wizardStep < 7 ? (
                  <button type="submit" style={{ flex: 1, padding: '10px', backgroundColor: '#007bff', color: 'white', border: 'none', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer' }}>
                    Next Category
                  </button>
                ) : (
                  <button type="submit" style={{ flex: 1, padding: '10px', backgroundColor: '#28a745', color: 'white', border: 'none', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer' }}>
                    Sign & Save Preliminary Results
                  </button>
                )}

                <button type="button" onClick={() => setSelectedUploadRequest(null)} style={{ padding: '10px 15px', backgroundColor: '#e2e8f0', color: '#4a5568', border: 'none', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer' }}>
                  Cancel
                </button>
              </div>

            </form>
          </div>
        </div>
      )}

    </div>
  );
}