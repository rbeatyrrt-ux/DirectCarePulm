// This script simulates a user typing their email and password into your portal login screen
fetch('http://localhost:5000/api/login', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    email: 'admin@directcare.com',
    password: 'SuperSecurePassword2026!'
  })
})
.then(response => response.json())
.then(data => console.log('Login Response:', data))
.catch(error => console.error('Error:', error));