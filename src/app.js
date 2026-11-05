require('dotenv').config();
const path = require('path');
const express = require('express');
const cookieSession = require('cookie-session');

const { requireAuth, homeFor } = require('./middleware/auth');
const flash = require('./middleware/flash');
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const posRoutes = require('./routes/pos');
const settingsRoutes = require('./routes/settings');
const helpers = require('./utils/helpers');
const icons = require('./utils/icons');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1); // behind Vercel's proxy, so req.secure reflects the original https request

// Raised from the 100kb default: product photos and CSV imports are posted inline.
app.use(express.urlencoded({ extended: true, limit: '4mb' }));
app.use(express.json({ limit: '4mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use(
  cookieSession({
    name: 'session',
    keys: [process.env.SESSION_SECRET || 'dev-secret-change-me'],
    maxAge: 8 * 60 * 60 * 1000, // 8-hour shift
    sameSite: 'lax',
    secure: Boolean(process.env.VERCEL), // only require https in deployed environments
  })
);

// "Keep me signed in" stretches the cookie to 30 days. cookie-session rewrites
// the cookie on every request, so the longer lifetime has to be reapplied each time.
app.use((req, res, next) => {
  if (req.session.remember) req.sessionOptions.maxAge = 30 * 24 * 60 * 60 * 1000;
  next();
});

app.use(flash);
app.use((req, res, next) => {
  res.locals.currentPath = req.path;
  next();
});
app.locals.peso = helpers.peso;
app.locals.h = helpers;
app.locals.icon = icons.icon;
app.locals.productIconName = icons.productIconName;

app.get('/', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  res.redirect(homeFor(req.session.user));
});

app.use('/', authRoutes);
app.use('/admin', requireAuth, adminRoutes);
app.use('/pos', requireAuth, posRoutes);
app.use('/settings', requireAuth, settingsRoutes);

app.use((req, res) => {
  res.status(404).render('error', { title: 'Not Found', message: 'Page not found.' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', { title: 'Server Error', message: 'Something went wrong. Please try again.' });
});

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Sari-sari POS running at http://localhost:${PORT}`);
  });
}

module.exports = app;
