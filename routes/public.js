const express = require('express');
const router = express.Router();
const db = require('../database/db');

// Landing page
router.get('/', (req, res) => {
    res.render('public/landing', { 
        title: 'University Health Clinic',
        user: req.session.user 
    });
});

// Clinic information
router.get('/about', (req, res) => {
    res.render('public/about', { 
        title: 'About Our Clinic',
        user: req.session.user 
    });
});

// Services page
router.get('/services', (req, res) => {
    db.all('SELECT * FROM services WHERE is_active = 1', (err, services) => {
        if (err) {
            console.error('Error fetching services:', err);
            services = [];
        }
        
        res.render('public/services', { 
            title: 'Our Services',
            user: req.session.user,
            services: services
        });
    });
});

// Operating hours
router.get('/hours', (req, res) => {
    db.get('SELECT * FROM clinic_settings WHERE id = 1', (err, settings) => {
        if (err) {
            console.error('Error fetching clinic hours:', err);
            settings = { opening_time: '09:00', closing_time: '17:00' };
        }
        
        res.render('public/hours', { 
            title: 'Clinic Hours',
            user: req.session.user,
            settings: settings
        });
    });
});

module.exports = router;