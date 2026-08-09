// AUTOMATED SELF-SERVICE PASSWORD RESET ENDPOINT
app.post('/api/forgot-password', async (req, res) => {
  const { email } = req.body;
  
  try {
    // 1. Check if user exists in database
    const userResult = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    
    // To prevent user enumeration security risks, return success even if email is not found
    if (userResult.rows.length === 0) {
      return res.json({ message: 'If an account exists with that email, a temporary password has been sent.' });
    }

    const user = userResult.rows[0];

    // 2. Generate a secure random temporary password
    const tempPassword = 'Temp!' + Math.random().toString(36).slice(-8);
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(tempPassword, salt);

    // 3. Update database with the new hashed temporary password & force change flag
    await pool.query(
      'UPDATE users SET password_hash = $1, must_change_password = TRUE WHERE user_id = $2', 
      [hashedPassword, user.user_id]
    );

    // 4. Log to password history compliance table
    await pool.query('INSERT INTO password_history (user_id, password_hash) VALUES ($1, $2)', [user.user_id, hashedPassword]);

    // 5. Send automated email via Resend API
    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.RESEND_API_KEY}`
        },
        body: JSON.stringify({
          from: 'DirectCare Portal <support@yourdomain.com>',
          to: email,
          subject: 'Your Temporary Portal Password',
          html: `<p>Hello ${user.full_name},</p><p>A password reset was requested for your DirectCare PFT Portal account.</p><p>Your secure temporary password is: <strong>${tempPassword}</strong></p><p>Please log in using this temporary password. You will be prompted to choose a new secure password immediately upon logging in.</p>`
        })
      });
    } catch (emailErr) {
      console.error('Failed to dispatch password reset email via Resend:', emailErr);
    }

    res.json({ message: 'If an account exists with that email, a temporary password has been sent.' });
  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ error: 'Failed to process password recovery request.' });
  }
});
