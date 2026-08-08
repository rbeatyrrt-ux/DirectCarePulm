import React, { useState, useEffect } from 'react';
import AccountManagement from '../components/AccountManagement';

const AVAILABLE_TESTS = [
  { name: 'Full PFT', cpt: '94060, 94726, 94729' },  
  { name: 'Basic Spirometry', cpt: '94010' },
  { name: 'Pre/Post Spirometry', cpt: '94060' },
  { name: 'Lung Volumes', cpt: '94726' },
  { name: 'Diffusion', cpt: '94729' },
  { name: 'Maximal voluntary ventilation (MVV) / maximum breathing capacity', cpt: '94200' }
];

const COMMON_INDICATIONS = [
  { code: 'J44.9', label: 'COPD, Unspecified' },
  { code: 'J45.909', label: 'Asthma, Unspecified' },
  { code: 'R06.02', label: 'Shortness of Breath' },
  { code: 'R05.9', label: 'Cough, Unspecified' },
  { code: 'R06.2', label: 'Wheezing' },
  { code: 'Z01.811', label: 'Pre-procedural Respiratory Exam' },
  { code: 'J47.9', label: 'Bronchiectasis, Uncomplicated' },
  { code: 'R09.89', label: 'Other Symptoms of Respiratory System' }
];

const FORTY_FIVE_MIN_SLOTS = [
  { id: '08:00_0845', label: '8:00 AM - 8:45 AM' },
  { id: '0845_0930', label: '8:45 AM - 9:30 AM' },
  { id: '0930_1015', label: '9:30 AM - 10:15 AM' },
  { id: '1015_1100', label: '10:15 AM - 11:00 AM' },
  { id: '1100_1145', label: '11:00 AM - 11:45 AM' },
  { id: '1245_1330', label: '1:00 PM - 1:45 PM' },
  { id: '1330_1415', label: '1:45 PM - 2:30 PM' },
  { id: '1415_1500', label: '2:30 PM - 3:15 PM' },
  { id: '1500_1545', label: '3:15 PM - 4:00 PM' }
];

export default function ClinicStaffDashboard({ token, user, onLogout }) {
  const [activeTab, setActiveTab] = useState('orders'); 
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [requests, setRequests] = useState([]);
  const [providers, setProviders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [allowedDates, setAllowedDates] = useState([]);
  const [bookedSlots, setBookedSlots] = useState([]);

  // Form State for New Order
  const [patientName, setPatientName] = useState('');
  const [patientDob, setPatientDob] = useState(''); 
  const [insuranceType, setInsuranceType] = useState('Commercial');
  
  const [selectedIndications, setSelectedIndications] = useState([]);
  const [otherIndication, setOtherIndication] = useState('');
  
  const [requestedDate, setRequestedDate] = useState('');
  const [timeBlock, setTimeBlock] = useState('08:00_0845');
  const [selectedProviderId, setSelectedProviderId] = useState('');
  
  const [selectedTests, setSelectedTests] = useState([]);
  const [selectedMdi, setSelectedMdi] = useState({});

  const [submitting, setSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');

  // Modal for viewing preliminary notes
  const [selectedPrelimRequest, setSelectedPrelimRequest] = useState(null);

  useEffect(() => {
    if (token) {
      checkProfileStatus();
      fetchRequests();
      fetchProviders();
      fetchClinicSchedule();
    }
  }, [token]);

  // Fetch booked slots whenever the requested date changes
  useEffect(() => {
    if (requestedDate && user?.clinic_name && token) {
      fetch(`https://directcare-backend.onrender.com/api/booked-slots?clinic_name=${encodeURIComponent(user.clinic_name)}&date=${requestedDate}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) setBookedSlots(data);
      })
      .catch(err => console.error('Failed to fetch booked slots', err));
    }
  }, [requestedDate, user, token]);

  const checkProfileStatus = async () => {
    try {
      const res = await fetch('https://directcare-backend.onrender.com/api/auth/me', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (res.ok && data.must_change_password) {
        setMustChangePassword(true);
      }
    } catch (err) {
      console.error('Failed to verify profile status', err);
    }
  };

  const fetchRequests = async () => {
    setLoading(true);
    try {
      const res = await fetch('https://directcare-backend.onrender.com/api/requests', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (res.ok) {
        const clinicRequests = user?.clinic_name 
          ? data.filter(r => r.clinic_name === user.clinic_name)
          : data;
        setRequests(clinicRequests);
      }
    } catch (err) {
      console.error('Failed to fetch requests', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchProviders = async () => {
    try {
      const res = await fetch('https://directcare-backend.onrender.com/api/requests', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (res.ok && Array.isArray(data)) {
        const clinicProviders = data.filter(u => u.role === 'provider' && (!user.clinic_name || u.clinic_name === user.clinic_name));
        setProviders(clinicProviders);
        if (clinicProviders.length > 0) setSelectedProviderId(clinicProviders[0].user_id);
      }
    } catch (err) {
      console.error('Failed to fetch providers', err);
    }
  };

  const fetchClinicSchedule = async () => {
    try {
      const res = await fetch('https://directcare-backend.onrender.com/api/clinic-schedules', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (res.ok && user?.clinic_name) {
        const found = data.find(s => s.clinic_name === user.clinic_name);
        if (found && found.allowed_dates) {
          const datesArray = found.allowed_dates.split(',').map(d => d.trim()).filter(Boolean);
          setAllowedDates(datesArray);
          if (datesArray.length > 0) {
            setRequestedDate(datesArray[0]);
          }
        }
      }
    } catch (err) {
      console.error('Failed to fetch clinic schedule rules', err);
    }
  };

  const toggleTest = (testName) => {
    if (selectedTests.includes(testName)) {
      setSelectedTests(selectedTests.filter(t => t !== testName));
      const updatedMdi = { ...selectedMdi };
      delete updatedMdi[testName];
      setSelectedMdi(updatedMdi);
    } else {
      setSelectedTests([...selectedTests, testName]);
      setSelectedMdi(prev => ({ ...prev, [testName]: true }));
    }
  };

  const toggleMdi = (testName) => {
    setSelectedMdi({ ...selectedMdi, [testName]: !selectedMdi[testName] });
  };

  const toggleIndication = (code) => {
    if (selectedIndications.includes(code)) {
      setSelectedIndications(selectedIndications.filter(c => c !== code));
    } else {
      setSelectedIndications([...selectedIndications, code]);
    }
  };

  const handleSendToProvider = async (e) => {
    e.preventDefault();
    if (selectedTests.length === 0) {
      alert('Please select at least one test.');
      return;
    }
    if (selectedIndications.length === 0 && !otherIndication.trim()) {
      alert('Please select or enter at least one ordering reason / indication.');
      return;
    }
    if (!requestedDate) {
      alert('Please select an authorized PFT date.');
      return;
    }
    if (!selectedProviderId) {
      alert('Please select a provider to route this order to.');
      return;
    }

    setSubmitting(true);
    setSuccessMsg('');

    const compiledTests = [
      ...selectedTests.map(testName => {
        const testObj = AVAILABLE_TESTS.find(t => t.name === testName);
        let desc = `${testName} (CPT: ${testObj.cpt})`;
        if (selectedMdi[testName]) {
          desc += ` + MDI Instruction (CPT: 94664)`;
        }
        return desc;
      }),
      'Albuterol Per Protocol'
    ].join('; ');

    const finalIndication = [
      ...selectedIndications.map(code => {
        const indObj = COMMON_INDICATIONS.find(i => i.code === code);
        return `${indObj.label} (${code})`;
      }),
      otherIndication.trim()
    ].filter(Boolean).join('; ');

    try {
      const res = await fetch('https://directcare-backend.onrender.com/api/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          patient_name: patientName,
          patient_dob: patientDob, 
          insurance_type: insuranceType,
          ordering_reason: finalIndication,
          tests_ordered: compiledTests,
          requested_date: requestedDate,
          time_block: timeBlock,
          clinic_name: user?.clinic_name || 'Independent Clinic',
          provider_id: selectedProviderId,
          status: 'PENDING_PROVIDER_SIGNATURE'
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to submit order');

      setSuccessMsg('Order successfully routed to your clinic provider for signature!');
      setPatientName('');
      setPatientDob(''); 
      setInsuranceType('Commercial');
      setSelectedIndications([]);
      setOtherIndication('');
      if (allowedDates.length > 0) setRequestedDate(allowedDates[0]);
      setSelectedTests([]);
      setSelectedMdi({});
      fetchRequests();
    } catch (err) {
      alert(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const downloadPdf = async (id) => {
    try {
      const res = await fetch(`https://directcare-backend.onrender.com/api/requests/${id}/pdf`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Failed to generate PDF');
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Clinical_Report_${id}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) { alert(err.message); }
  };

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
      case 'PENDING_PROVIDER_SIGNATURE': return { bg: '#e2d9f3', color: '#5b21b6' };
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

      <header style={{ backgroundColor: '#1a2a47', paddingTop: '20px' }}>
        <div style={{ padding: '0 40px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: '22px', color: 'white' }}>DirectCare Clinic Staff Portal</h1>
            <span style={{ fontSize: '13px', color: '#a0aec0' }}>Clinic: <strong>{user?.clinic_name || 'Independent Clinic'}</strong> | Staff: {user?.full_name}</span>
          </div>
          <button onClick={onLogout} style={{ backgroundColor: 'transparent', color: 'white', border: '1px solid white', padding: '8px 20px', borderRadius: '4px', cursor: 'pointer', fontSize: '14px' }}>
            Log Out
          </button>
        </div>

        <div style={{ padding: '0 40px', display: 'flex', borderBottom: '2px solid #f4f6f9' }}>
          <button style={tabStyle('orders')} onClick={() => setActiveTab('orders')}>Portal & Ordering</button>
          <button style={tabStyle('account')} onClick={() => setActiveTab('account')}>Account Management</button>
        </div>
      </header>

      <main style={{ padding: '40px', maxWidth: '1500px', margin: '0 auto' }}>
        
        {activeTab === 'account' ? (
          <AccountManagement token={token} user={user} isForcedModal={false} />
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1.3fr', gap: '30px', alignItems: 'start' }}>
            
            {/* SUBMIT NEW ORDER SECTION */}
            <div style={{ backgroundColor: 'white', borderRadius: '8px', padding: '30px', boxShadow: '0 2px 10px rgba(0,0,0,0.05)' }}>
              <h2 style={{ marginTop: 0, color: '#1a2a47', fontSize: '18px', marginBottom: '20px' }}>Submit New Order & Send to Provider</h2>
              
              {successMsg && (
                <div style={{ padding: '12px', marginBottom: '20px', borderRadius: '4px', backgroundColor: '#d4edda', color: '#155724', fontSize: '14px' }}>
                  {successMsg}
                </div>
              )}

              <form onSubmit={handleSendToProvider} autoComplete="off">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', marginBottom: '15px' }}>
                  <div>
                    <label style={{ display: 'block', marginBottom: '5px', fontSize: '13px', fontWeight: 'bold', color: '#333' }}>Patient Full Name</label>
                    <input type="text" name="dc_patient_name" value={patientName} onChange={e => setPatientName(e.target.value)} autoComplete="off" style={{ width: '100%', padding: '10px', borderRadius: '4px', border: '1px solid #ccc', boxSizing: 'border-box' }} required />
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: '5px', fontSize: '13px', fontWeight: 'bold', color: '#333' }}>Date of Birth</label>
                    <input type="date" value={patientDob} onChange={e => setPatientDob(e.target.value)} style={{ width: '100%', padding: '10px', borderRadius: '4px', border: '1px solid #ccc', boxSizing: 'border-box' }} required />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', marginBottom: '20px' }}>
                  <div>
                    <label style={{ display: 'block', marginBottom: '5px', fontSize: '13px', fontWeight: 'bold', color: '#333' }}>Insurance Type / Payer</label>
                    <select value={insuranceType} onChange={e => setInsuranceType(e.target.value)} style={{ width: '100%', padding: '10px', borderRadius: '4px', border: '1px solid #ccc', boxSizing: 'border-box', backgroundColor: 'white' }}>
                      <option value="Commercial">Commercial</option>
                      <option value="Medicaid">Medicaid</option>
                      <option value="Medicare">Medicare</option>
                      <option value="Tricare/Military">Tricare/Military</option>
                      <option value="Self-pay">Self-pay</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: '5px', fontSize: '13px', fontWeight: 'bold', color: '#333' }}>Select Clinic Provider for Signature</label>
                    <select value={selectedProviderId} onChange={e => setSelectedProviderId(e.target.value)} style={{ width: '100%', padding: '10px', borderRadius: '4px', border: '1px solid #ccc', boxSizing: 'border-box', backgroundColor: 'white' }} required>
                      {providers.length === 0 ? (
                        <option value="">No providers in this clinic</option>
                      ) : (
                        providers.map(p => (
                          <option key={p.user_id} value={p.user_id}>{p.full_name} ({p.credentials || 'Provider'})</option>
                        ))
                      )}
                    </select>
                  </div>
                </div>

                {/* ICD-10 QUICK SELECT BOX */}
                <div style={{ marginBottom: '20px', backgroundColor: '#f8f9fa', padding: '15px', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 'bold', marginBottom: '10px', color: '#333' }}>Ordering Reason / Indication (Select all that apply)</label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '15px' }}>
                    {COMMON_INDICATIONS.map(ind => (
                      <label key={ind.code} style={{ display: 'flex', alignItems: 'flex-start', fontSize: '12px', cursor: 'pointer', color: '#2d3748' }}>
                        <input 
                          type="checkbox" 
                          checked={selectedIndications.includes(ind.code)} 
                          onChange={() => toggleIndication(ind.code)} 
                          style={{ marginRight: '8px', marginTop: '2px' }} 
                        />
                        <span>{ind.label} <span style={{ color: '#2b6cb0', fontWeight: 'bold' }}>({ind.code})</span></span>
                      </label>
                    ))}
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: '5px', fontSize: '12px', fontWeight: 'bold', color: '#555' }}>Other / Custom Indication</label>
                    <input 
                      type="text" 
                      placeholder="Enter other indications or specific notes..." 
                      value={otherIndication} 
                      onChange={e => setOtherIndication(e.target.value)} 
                      style={{ width: '100%', padding: '10px', borderRadius: '4px', border: '1px solid #ccc', boxSizing: 'border-box' }} 
                    />
                  </div>
                </div>

                <div style={{ marginBottom: '20px' }}>
                  <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px', fontWeight: 'bold', color: '#333' }}>Select Tests & Add-on MDI Education (Multiple allowed)</label>
                  <div style={{ border: '1px solid #ccc', padding: '15px', borderRadius: '4px', backgroundColor: '#fafafa', maxHeight: '280px', overflowY: 'auto' }}>
                    {AVAILABLE_TESTS.map((test) => {
                      const isSelected = selectedTests.includes(test.name);
                      const hasMdi = selectedMdi[test.name] || false;
                      return (
                        <div key={test.name} style={{ marginBottom: '12px', paddingBottom: '10px', borderBottom: '1px solid #e2e8f0' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', fontSize: '13px', fontWeight: '500', color: '#2d3748' }}>
                              <input type="checkbox" checked={isSelected} onChange={() => toggleTest(test.name)} style={{ marginRight: '10px', width: '16px', height: '16px' }} />
                              {test.name} <span style={{ color: '#2b6cb0', fontWeight: 'bold', fontSize: '11px', marginLeft: '6px' }}>(CPT: {test.cpt})</span>
                            </label>
                          </div>
                          {isSelected && (
                            <div style={{ marginLeft: '26px', marginTop: '8px', backgroundColor: '#edf2f7', padding: '8px 12px', borderRadius: '4px', borderLeft: '3px solid #3182ce' }}>
                              <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', fontSize: '12px', color: '#2d3748', fontWeight: '500' }}>
                                <input type="checkbox" checked={hasMdi} onChange={() => toggleMdi(test.name)} style={{ marginRight: '8px', width: '14px', height: '14px' }} />
                                Add MDI Instruction / Demonstration &nbsp;<span style={{ color: '#2c5282', fontWeight: 'bold' }}>(CPT: 94664)</span>
                              </label>
                            </div>
                          )}
                        </div>
                      );
                    })}

                    <div style={{ paddingTop: '5px' }}>
                      <label style={{ display: 'flex', alignItems: 'center', cursor: 'not-allowed', fontSize: '13px', fontWeight: 'bold', color: '#2d3748' }}>
                        <input type="checkbox" checked={true} disabled style={{ marginRight: '10px', width: '16px', height: '16px', cursor: 'not-allowed' }} />
                        Albuterol Per Protocol <span style={{ color: '#c05621', fontSize: '11px', marginLeft: '6px' }}>(Required Clinical Protocol)</span>
                      </label>
                    </div>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', marginBottom: '20px' }}>
                  <div>
                    <label style={{ display: 'block', marginBottom: '5px', fontSize: '13px', fontWeight: 'bold', color: '#333' }}>Authorized PFT Testing Date</label>
                    <select value={requestedDate} onChange={e => setRequestedDate(e.target.value)} style={{ width: '100%', padding: '10px', borderRadius: '4px', border: '1px solid #ccc', boxSizing: 'border-box', backgroundColor: 'white', fontWeight: 'bold', color: '#1a2a47' }} required>
                      {allowedDates.length === 0 ? (
                        <option value="">No authorized dates configured</option>
                      ) : (
                        allowedDates.map(dateStr => (
                          <option key={dateStr} value={dateStr}>
                            {new Date(dateStr + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })} ({dateStr})
                          </option>
                        ))
                      )}
                    </select>
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: '5px', fontSize: '13px', fontWeight: 'bold', color: '#333' }}>45-Min Time Slot</label>
                    <select value={timeBlock} onChange={e => setTimeBlock(e.target.value)} style={{ width: '100%', padding: '10px', borderRadius: '4px', border: '1px solid #ccc', boxSizing: 'border-box', backgroundColor: 'white' }}>
                      {FORTY_FIVE_MIN_SLOTS.map(slot => {
                        const isBooked = bookedSlots.includes(slot.id);
                        return (
                          <option key={slot.id} value={slot.id} disabled={isBooked} style={{ color: isBooked ? '#a0aec0' : 'inherit', backgroundColor: isBooked ? '#edf2f7' : 'white' }}>
                            {slot.label} {isBooked ? '(Booked)' : ''}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                </div>

                <button type="submit" disabled={submitting || allowedDates.length === 0} style={{ width: '100%', padding: '12px', backgroundColor: (submitting || allowedDates.length === 0) ? '#cbd5e0' : '#1a2a47', color: 'white', border: 'none', borderRadius: '4px', fontWeight: 'bold', cursor: (submitting || allowedDates.length === 0) ? 'not-allowed' : 'pointer' }}>
                  {submitting ? 'Sending to Provider...' : 'Send to Provider'}
                </button>
              </form>
            </div>

            {/* PATIENT ORDERS & STATUS TRACKER */}
            <div style={{ backgroundColor: 'white', borderRadius: '8px', padding: '30px', boxShadow: '0 2px 10px rgba(0,0,0,0.05)' }}>
              <h2 style={{ marginTop: 0, marginBottom: '20px', color: '#1a2a47', fontSize: '18px' }}>Clinic Patient Orders & Status Tracker</h2>
              
              {loading ? <p>Loading clinic orders...</p> : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                    <thead>
                      <tr style={{ backgroundColor: '#f8f9fa', borderBottom: '2px solid #e0e0e0', fontSize: '12px', color: '#555' }}>
                        <th style={{ padding: '10px' }}>Patient</th>
                        <th style={{ padding: '10px' }}>Tests & CPT</th>
                        <th style={{ padding: '10px' }}>Date & Time Slot</th>
                        <th style={{ padding: '10px' }}>Status</th>
                        <th style={{ padding: '10px', textAlign: 'center' }}>Report / Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {requests.length === 0 ? (
                        <tr><td colSpan="5" style={{ padding: '20px', textAlign: 'center', color: '#888', fontSize: '13px' }}>No patient orders found for your clinic.</td></tr>
                      ) : (
                        requests.map(req => {
                          const badge = getStatusStyle(req.status);
                          return (
                            <tr key={req.request_id} style={{ borderBottom: '1px solid #eee', fontSize: '13px' }}>
                              <td style={{ padding: '10px', color: '#333' }}>
                                <strong>{req.patient_name || 'N/A'}</strong><br/>
                                <span style={{ fontSize: '11px', color: '#555' }}>DOB: {req.patient_dob ? new Date(req.patient_dob).toLocaleDateString() : 'N/A'}</span><br/>
                                <span style={{ fontSize: '11px', color: '#777' }}>{req.ordering_reason || ''}</span>
                              </td>
                              <td style={{ padding: '10px', color: '#555', fontSize: '12px' }}>{req.tests_ordered || 'PFT'}</td>
                              <td style={{ padding: '10px', color: '#555', whiteSpace: 'nowrap' }}>
                                {req.requested_date ? new Date(req.requested_date).toLocaleDateString() : 'N/A'}
                                <br />
                                <span style={{ fontSize: '11px', color: '#718096', fontWeight: '500' }}>
                                  {req.time_block ? req.time_block.replace('_', ' - ') : ''}
                                </span>
                              </td>
                              <td style={{ padding: '10px' }}>
                                <span style={{ padding: '4px 10px', borderRadius: '20px', fontSize: '10px', fontWeight: 'bold', backgroundColor: badge.bg, color: badge.color, whiteSpace: 'nowrap' }}>
                                  {req.status.replace('_', ' ')}
                                </span>
                              </td>
                              <td style={{ padding: '10px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                                {req.status === 'PRELIMINARY_RESULTS' && (
                                  <button onClick={() => setSelectedPrelimRequest(req)} style={{ padding: '5px 10px', backgroundColor: '#e0a800', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '11px', fontWeight: 'bold', marginRight: '5px' }}>
                                    View Prelim Notes
                                  </button>
                                )}
                                {req.status === 'COMPLETED' ? (
                                  <button onClick={() => downloadPdf(req.request_id)} style={{ padding: '5px 10px', backgroundColor: '#28a745', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '11px', fontWeight: 'bold' }}>
                                    Download PDF
                                  </button>
                                ) : (
                                  req.status !== 'PRELIMINARY_RESULTS' && <span style={{ fontSize: '11px', color: '#888', fontStyle: 'italic' }}>—</span>
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

          </div>
        )}
      </main>

      {/* PRELIMINARY NOTES MODAL */}
      {selectedPrelimRequest && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 9999 }}>
          <div style={{ backgroundColor: 'white', padding: '35px', borderRadius: '8px', width: '600px', boxShadow: '0 4px 20px rgba(0,0,0,0.2)', maxHeight: '90vh', overflowY: 'auto' }}>
            <h2 style={{ marginTop: 0, color: '#1a2a47', fontSize: '18px' }}>Preliminary Testing Observations</h2>
            
            <div style={{ backgroundColor: '#fff3cd', border: '1px solid #ffeeba', color: '#856404', padding: '12px', borderRadius: '6px', fontSize: '12px', marginBottom: '20px', fontWeight: 'bold' }}>
              Warning: Preliminary – Pending Final Physician Overread. Do not make definitive clinical management decisions until final report is completed.
            </div>

            <div style={{ backgroundColor: '#f8f9fa', padding: '15px', borderRadius: '6px', marginBottom: '20px', fontSize: '13px' }}>
              <p style={{ margin: '0 0 5px 0' }}><strong>Patient:</strong> {selectedPrelimRequest.patient_name}</p>
              <p style={{ margin: '0 0 10px 0' }}><strong>Tests Ordered:</strong> {selectedPrelimRequest.tests_ordered}</p>
              <hr style={{ border: '0', borderTop: '1px solid #ddd', margin: '10px 0' }}/>
              <p style={{ margin: '0 0 5px 0' }}><strong>RRT Preliminary Findings:</strong></p>
              <p style={{ margin: '0 0 10px 0', whiteSpace: 'pre-wrap', color: '#2d3748' }}>{selectedPrelimRequest.recommended_interpretation || 'None provided.'}</p>
              <p style={{ margin: '0 0 5px 0' }}><strong>RRT Technical Comments:</strong></p>
              <p style={{ margin: 0, whiteSpace: 'pre-wrap', color: '#2d3748' }}>{selectedPrelimRequest.rrt_notes || 'None provided.'}</p>
            </div>

            <button onClick={() => setSelectedPrelimRequest(null)} style={{ width: '100%', padding: '10px', backgroundColor: '#6c757d', color: 'white', border: 'none', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer' }}>
              Close
            </button>
          </div>
        </div>
      )}

    </div>
  );
}