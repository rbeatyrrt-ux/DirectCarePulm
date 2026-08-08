const myToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoiODJkN2U0YmEtZjJjYS00OWI1LWIwNmQtYTM2YTZkOTI1ZjE0Iiwicm9sZSI6IlJFVklFV0VSIiwiaWF0IjoxNzg1MzMxMzgwLCJleHAiOjE3ODUzNjAxODB9.buJ3b4bUdSVXa32cWElbjU_sj9B4_sHZHH32MU9ROfI';

async function runTest() {
  try {
    console.log('1. Onboarding a new Clinic...');
    
    const practiceResponse = await fetch('http://localhost:5000/api/practices', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${myToken}`
      },
      body: JSON.stringify({
        clinic_name: 'Ohio Pulmonary Associates - North Campus', // Final tweak to avoid duplicate
        npi_number: '9988776655', // Final tweak
        practice_manager_name: 'Jane Doe',
        billing_email: 'billing@ohiopulmonary.com',
        phone: '555-0198'
      })
    });
    
    const practiceData = await practiceResponse.json();
    console.log('Clinic Response:', practiceData);
    
    if (!practiceData.practice) return;
    
    console.log('\n2. Booking a Service Request for the new Clinic...');
    
    const requestResponse = await fetch('http://localhost:5000/api/requests', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${myToken}`
      },
      body: JSON.stringify({
        practice_id: practiceData.practice.practice_id,
        requested_date: '2026-08-15',
        time_block: 'HALF_DAY_5', 
        billing_tier: 'MODEL_A_FFS', // MATCHES THE DATABASE EXACTLY!
        rrt_notes: 'Standard monthly batch of COPD evaluations.'
      })
    });
    
    const requestData = await requestResponse.json();
    console.log('Booking Response:', requestData);

  } catch (error) {
    console.error('Error running test workflow:', error);
  }
}

runTest();