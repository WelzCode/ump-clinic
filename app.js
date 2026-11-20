require('dotenv').config();

const express = require('express');
const session = require('express-session');
const path = require('path');
const bodyParser = require('body-parser');

const app = express();

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Session configuration - FIXED: Use a proper session store
app.use(session({
    secret: process.env.SESSION_SECRET || 'university-clinic-secret-key-change-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: false, // set to true if using HTTPS
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

// View engine setup
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Make user data available to all views
app.use((req, res, next) => {
    res.locals.user = req.session.user;
    res.locals.success = req.session.success;
    res.locals.error = req.session.error;
    
    // Clear flash messages
    delete req.session.success;
    delete req.session.error;
    
    next();
});

// Simple flash middleware
app.use((req, res, next) => {
    req.flash = (type, message) => {
        req.session[type] = message;
    };
    next();
});

// Route imports
app.use('/', require('./routes/public'));
app.use('/auth', require('./routes/auth'));
app.use('/student', require('./routes/students'));
app.use('/nurse', require('./routes/nurses'));
app.use('/admin', require('./routes/admin'));

// Error handling
app.use((err, req, res, next) => {
    console.error('Error stack:', err.stack);
    res.status(500).render('error', { 
        title: 'Error',
        message: 'Something went wrong!',
        user: req.session.user 
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).render('error', { 
        title: 'Page Not Found',
        message: 'The page you are looking for does not exist.',
        user: req.session.user 
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`University Clinic system running on port ${PORT}`);
    console.log(`Visit: http://localhost:${PORT}`);
});