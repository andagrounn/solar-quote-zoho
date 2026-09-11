// Production entry point for GoDaddy cPanel (Phusion Passenger).
//
// Passenger loads this file with require(), so `require.main === module` is
// FALSE here — that is why we must call app.listen() unconditionally rather
// than relying on the guard in server/index.js. For `npm start` / local use,
// server/index.js is the entry (its require.main guard handles that path).
//
// In cPanel's "Setup Node.js App", set:
//   Application startup file = app.js
// and provide the environment variables (QUOTE_PASSCODE, SESSION_SECRET,
// ZOHO_*) via the cPanel UI (or a .env file in the app root — dotenv reads it).
require('dotenv').config();
const { buildAppFromEnv } = require('./server/index');

const app = buildAppFromEnv();
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`solar-quote-zoho listening on ${port}`));
