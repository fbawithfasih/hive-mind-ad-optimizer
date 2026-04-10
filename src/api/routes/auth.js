import express from 'express';
import axios from 'axios';

const router = express.Router();

const CLIENT_ID = process.env.AMAZON_ADS_CLIENT_ID;
const CLIENT_SECRET = process.env.AMAZON_ADS_CLIENT_SECRET;
const REDIRECT_URI = 'http://localhost:3000/api/auth/amazon/callback';

// Step 1: Redirect user to Amazon authorization
router.get('/amazon/authorize', (req, res) => {
  const authUrl = `https://www.amazon.com/ap/oa?client_id=${CLIENT_ID}&scope=advertising::campaign_management&response_type=code&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;
  
  console.log('Redirecting to Amazon authorization...');
  res.redirect(authUrl);
});

// Step 2: Handle callback and exchange code for tokens
router.get('/amazon/callback', async (req, res) => {
  const { code } = req.query;
  
  if (!code) {
    return res.status(400).send('No authorization code received');
  }

  try {
    console.log('Exchanging authorization code for tokens...');
    
    const response = await axios.post('https://api.amazon.com/auth/o2/token', new URLSearchParams({
      grant_type: 'authorization_code',
      code: code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI
    }), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    const { refresh_token, access_token } = response.data;
    
    console.log('\n✅ SUCCESS! Amazon OAuth Tokens Received:\n');
    console.log('='.repeat(80));
    console.log('REFRESH TOKEN (save this to .env):');
    console.log(refresh_token);
    console.log('='.repeat(80));
    console.log('\nAccess Token (temporary):', access_token);
    console.log('\n');

    res.send(`
      <html>
        <head><title>Authorization Successful</title></head>
        <body style="font-family: monospace; padding: 40px; background: #1a1a1a; color: #f5f5f5;">
          <h1 style="color: #4ade80;">✅ Authorization Successful!</h1>
          <p>Copy this refresh token and add it to your .env file:</p>
          <div style="background: #2a2a2a; padding: 20px; border-radius: 8px; margin: 20px 0; word-break: break-all;">
            <strong>AMAZON_ADS_REFRESH_TOKEN=</strong><span style="color: #fbbf24;">${refresh_token}</span>
          </div>
          <p>The token has also been logged to your terminal.</p>
          <p><a href="http://localhost:5174" style="color: #60a5fa;">← Back to Dashboard</a></p>
        </body>
      </html>
    `);
    
  } catch (error) {
    console.error('Token exchange error:', error.response?.data || error.message);
    res.status(500).send(`Error: ${error.message}`);
  }
});

export default router;
