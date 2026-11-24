// ===== WJC IT Asset Management - server =====
// 1. Hosts the web pages (replaces Live Server)
// 2. Sends the warranty alert email to MITS (SR-4)

const express = require('express');
const nodemailer = require('nodemailer');
const path = require('path');

const app = express();
const PORT = 3000;

app.use(express.json()); // lets the server read data the pages send it

// Serve everything in the Main folder as web pages
app.use(express.static(path.join(__dirname, '..', 'Main')));

// ===== Email setup =====
// Ethereal is a free test inbox made by the Nodemailer team.
// Emails are caught there and can be viewed with a link; nothing reaches a real inbox.
let transporter = null;

async function setUpEmail() {
  const testAccount = await nodemailer.createTestAccount();
  transporter = nodemailer.createTransport({
    host: 'smtp.ethereal.email',
    port: 587,
    secure: false, // starts plain, then upgrades to an encrypted (TLS) connection
    auth: { user: testAccount.user, pass: testAccount.pass }
  });
  console.log('Test email account ready.');
}

// ===== SR-4: email the MITS department about devices on a warning day =====
app.post('/api/warranty-email', async (req, res) => {
  const devices = req.body.devices;

  if (!Array.isArray(devices) || devices.length === 0) {
    return res.status(400).json({ error: 'No devices to report.' });
  }
  if (!transporter) {
    return res.status(503).json({ error: 'Email is not available right now.' });
  }

  const lines = devices.map(d => `- ${d.deviceType} (${d.tagId}): warranty ends ${d.warrantyDate}`);

  try {
    const info = await transporter.sendMail({
      from: '"WJC Asset System" <no-reply@wjc-assets.test>',
      to: 'mits@wjc-assets.test',
      subject: `Warranty alert: ${devices.length} device(s) reaching a warning day`,
      text: 'The following devices have reached a warranty warning day:\n\n' + lines.join('\n')
    });

    const previewUrl = nodemailer.getTestMessageUrl(info);
    console.log('Warranty email sent. View it here:', previewUrl);
    res.json({ sent: true, previewUrl });
  } catch (error) {
    console.error('Email failed:', error.message);
    res.status(500).json({ error: 'The email could not be sent.' });
  }
});

// Start the server, even if the email setup fails
setUpEmail()
  .catch(error => console.error('Email setup failed:', error.message))
  .finally(() => {
    app.listen(PORT, error => {
      if (error) {
        console.error('Server could not start:', error.message);
        return;
      }
      console.log(`Server running at http://localhost:${PORT}`);
    });
  });
  
  // Start the server, even if the email setup fails
setUpEmail()
  .catch(error => console.error('Email setup failed:', error.message))
  .finally(() => {
    app.listen(PORT, error => {
      if (error) {
        console.error('Server could not start:', error.message);
        return;
      }
      console.log(`Server running at http://localhost:${PORT}`);
    });
  });