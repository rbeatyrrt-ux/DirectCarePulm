// This script sends a POST request to your new server to create your admin account
fetch('http://localhost:5000/api/register', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    email: 'admin@directcare.com',
    password: 'SuperSecurePassword2026!',
    full_name: 'Robert Beaty',
    role: 'REVIEWER'
  })
})
.then(response => response.json())
.then(data => console.log('Server Response:', data))
.catch(error => console.error('Error:', error));