const express = require('express');
const router = express.Router();
const db = require('../database/db');
const { startReminderService } = require('../services/reminderService');

startReminderService();
// Middleware to check if user is a student
function requireStudent(req, res, next) {
    if (req.session.user && req.session.user.role === 'student') {
        next();
    } else {
        res.redirect('/auth/login');
    }
}

// Student dashboard
router.get('/', requireStudent, (req, res) => {
    const studentId = req.session.user.id;
    
    // Get upcoming appointments
    db.all(
        `SELECT a.*, s.name as service_name, u.full_name as nurse_name 
         FROM appointments a 
         LEFT JOIN services s ON a.service_id = s.id 
         LEFT JOIN users u ON a.nurse_id = u.id 
         WHERE a.student_id = ? AND a.appointment_date >= date('now') 
         AND a.status = 'scheduled' 
         ORDER BY a.appointment_date, a.appointment_time 
         LIMIT 5`,
        [studentId],
        (err, appointments) => {
            if (err) {
                console.error('Error fetching appointments:', err);
                appointments = [];
            }
            
            res.render('students/dashboard', {
                title: 'Student Dashboard',
                user: req.session.user,
                appointments: appointments
            });
        }
    );
});

// Book appointment page
router.get('/book-appointment', requireStudent, (req, res) => {
    // Get available services
    db.all('SELECT * FROM services WHERE is_active = 1', (err, services) => {
        if (err) {
            console.error('Error fetching services:', err);
            services = [];
        }
        
        // Get clinic settings for available slots
        db.get('SELECT * FROM clinic_settings WHERE id = 1', (err, settings) => {
            if (err) {
                console.error('Error fetching settings:', err);
                settings = { opening_time: '09:00', closing_time: '17:00', appointment_duration: 30 };
            }
            
            res.render('students/book-appointment', {
                title: 'Book Appointment',
                user: req.session.user,
                services: services,
                settings: settings,
                messages: {
                    error: req.flash('error'),
                    success: req.flash('success')
                }
            });
        });
    });
});

// Get available time slots - FIXED VERSION
router.get('/available-slots', requireStudent, (req, res) => {
    const { date, service_id } = req.query;
    
    if (!date || !service_id) {
        return res.json({ error: 'Date and service are required' });
    }
    
    // Get clinic settings first
    db.get('SELECT * FROM clinic_settings WHERE id = 1', (err, settings) => {
        if (err) {
            console.error('Error fetching clinic settings:', err);
            return res.json({ error: 'Error fetching clinic settings' });
        }
        
        // Get booked slots for this date and service
        db.all(
            `SELECT appointment_time 
             FROM appointments 
             WHERE appointment_date = ? 
             AND service_id = ? 
             AND status = 'scheduled'`,
            [date, service_id],
            (err, bookedSlots) => {
                if (err) {
                    console.error('Error fetching booked slots:', err);
                    return res.json({ error: 'Error fetching booked slots' });
                }
                
                const availableSlots = generateTimeSlots(bookedSlots, settings);
                res.json(availableSlots);
            }
        );
    });
});

// Enhanced time slot generation with clinic hours - FIXED VERSION
function generateTimeSlots(bookedSlots, settings) {
    const slots = [];
    const bookedTimes = bookedSlots.map(slot => {
        // Ensure time format is consistent
        let time = slot.appointment_time;
        if (time.length === 5) time = time + ':00'; // Convert HH:MM to HH:MM:SS
        return time;
    });
    
    // Use clinic settings or defaults
    const openingTime = settings?.opening_time || '09:00';
    const closingTime = settings?.closing_time || '17:00';
    const appointmentDuration = settings?.appointment_duration || 30;
    
    // Parse clinic hours
    const openHour = parseInt(openingTime.split(':')[0]);
    const openMinute = parseInt(openingTime.split(':')[1]) || 0;
    const closeHour = parseInt(closingTime.split(':')[0]);
    const closeMinute = parseInt(closingTime.split(':')[1]) || 0;
    
    // Convert to minutes for easier calculation
    const openTimeMinutes = openHour * 60 + openMinute;
    const closeTimeMinutes = closeHour * 60 + closeMinute;
    
    // Generate slots based on clinic hours and appointment duration
    for (let timeMinutes = openTimeMinutes; timeMinutes < closeTimeMinutes; timeMinutes += appointmentDuration) {
        const hour = Math.floor(timeMinutes / 60);
        const minute = timeMinutes % 60;
        
        const timeString = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}:00`;
        const displayTime = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
        
        // Check if slot is not booked
        const isBooked = bookedTimes.includes(timeString);
        
        slots.push({
            value: displayTime, // Use HH:MM format for value
            display: displayTime,
            available: !isBooked,
            reason: isBooked ? 'Already booked' : 'Available'
        });
    }
    
    return slots;
}

// Handle appointment booking with conflict detection and daily limit - UPDATED VERSION
router.post('/book-appointment', requireStudent, (req, res) => {
    const { service_id, appointment_date, appointment_time } = req.body;
    const studentId = req.session.user.id;
    
    if (!service_id || !appointment_date || !appointment_time) {
        req.flash('error', 'Please fill all required fields');
        return res.redirect('/student/book-appointment');
    }
    
    // Convert time to proper SQL time format
    const sqlTime = appointment_time.length === 5 ? appointment_time + ':00' : appointment_time;
    
    // FIRST: Check if student already has an appointment on this date (daily limit)
    db.get(
        `SELECT id FROM appointments 
         WHERE student_id = ? 
         AND appointment_date = ? 
         AND status = 'scheduled' 
         LIMIT 1`,
        [studentId, appointment_date],
        (err, dailyAppointment) => {
            if (err) {
                console.error('Error checking daily appointment limit:', err);
                req.flash('error', 'System error. Please try again.');
                return res.redirect('/student/book-appointment');
            }
            
            if (dailyAppointment) {
                req.flash('error', 'You already have an appointment scheduled for this date. Students are limited to one appointment per day.');
                return res.redirect('/student/book-appointment');
            }
            
            // SECOND: Check for existing appointment at the same time for the same service
            db.get(
                `SELECT id FROM appointments 
                 WHERE appointment_date = ? 
                 AND appointment_time = ? 
                 AND service_id = ? 
                 AND status = 'scheduled'`,
                [appointment_date, sqlTime, service_id],
                (err, existingAppointment) => {
                    if (err) {
                        console.error('Error checking appointment conflict:', err);
                        req.flash('error', 'System error. Please try again.');
                        return res.redirect('/student/book-appointment');
                    }
                    
                    if (existingAppointment) {
                        req.flash('error', 'This time slot is no longer available. Please choose another time.');
                        return res.redirect('/student/book-appointment');
                    }
                    
                    // THIRD: Check if student already has an appointment at this time (redundant but safe)
                    db.get(
                        `SELECT id FROM appointments 
                         WHERE student_id = ? 
                         AND appointment_date = ? 
                         AND appointment_time = ? 
                         AND status = 'scheduled'`,
                        [studentId, appointment_date, sqlTime],
                        (err, studentConflict) => {
                            if (err) {
                                console.error('Error checking student conflict:', err);
                                req.flash('error', 'System error. Please try again.');
                                return res.redirect('/student/book-appointment');
                            }
                            
                            if (studentConflict) {
                                req.flash('error', 'You already have an appointment scheduled at this time.');
                                return res.redirect('/student/book-appointment');
                            }
                            
                            // If no conflicts, create the appointment with reminder_sent = 0
                            db.run(
                                `INSERT INTO appointments (student_id, service_id, appointment_date, appointment_time, status, reminder_sent) 
                                 VALUES (?, ?, ?, ?, 'scheduled', 0)`,
                                [studentId, service_id, appointment_date, sqlTime],
                                function(err) {
                                    if (err) {
                                        console.error('Error booking appointment:', err);
                                        req.flash('error', 'Failed to book appointment. Please try again.');
                                        return res.redirect('/student/book-appointment');
                                    }
                                    req.flash('success', 'Appointment booked successfully! You will receive a reminder 30 minutes before your appointment.');
                                    res.redirect('/student/my-appointments');
                                }
                            );
                        }
                    );
                }
            );
        }
    );
});

// My appointments page
router.get('/my-appointments', requireStudent, (req, res) => {
    const studentId = req.session.user.id;
    
    db.all(
        `SELECT a.*, s.name as service_name, u.full_name as nurse_name 
         FROM appointments a 
         LEFT JOIN services s ON a.service_id = s.id 
         LEFT JOIN users u ON a.nurse_id = u.id 
         WHERE a.student_id = ? 
         ORDER BY a.appointment_date DESC, a.appointment_time DESC`,
        [studentId],
        (err, appointments) => {
            if (err) {
                console.error('Error fetching appointments:', err);
                appointments = [];
            }
            
            res.render('students/my-appointments', {
                title: 'My Appointments',
                user: req.session.user,
                appointments: appointments
            });
        }
    );
});

// Cancel appointment
router.post('/cancel-appointment/:id', requireStudent, (req, res) => {
    const appointmentId = req.params.id;
    const studentId = req.session.user.id;
    
    db.run(
        `UPDATE appointments SET status = 'cancelled' 
         WHERE id = ? AND student_id = ? AND status = 'scheduled'`,
        [appointmentId, studentId],
        function(err) {
            if (err) {
                console.error('Error cancelling appointment:', err);
                req.flash('error', 'Failed to cancel appointment');
            } else if (this.changes > 0) {
                req.flash('success', 'Appointment cancelled successfully');
            } else {
                req.flash('error', 'Appointment not found or cannot be cancelled');
            }
            res.redirect('/student/my-appointments');
        }
    );
});

// Medical records page
router.get('/medical-records', requireStudent, (req, res) => {
    const studentId = req.session.user.id;
    
    db.all(
        `SELECT mr.*, u.full_name as nurse_name, a.appointment_date 
         FROM medical_records mr 
         LEFT JOIN users u ON mr.nurse_id = u.id 
         LEFT JOIN appointments a ON mr.appointment_id = a.id 
         WHERE mr.student_id = ? 
         ORDER BY mr.record_date DESC`,
        [studentId],
        (err, records) => {
            if (err) {
                console.error('Error fetching medical records:', err);
                records = [];
            }
            
            // Get prescriptions
            db.all(
                `SELECT p.*, u.full_name as nurse_name 
                 FROM prescriptions p 
                 LEFT JOIN users u ON p.nurse_id = u.id 
                 WHERE p.student_id = ? AND p.is_active = 1 
                 ORDER BY p.prescribed_date DESC`,
                [studentId],
                (err, prescriptions) => {
                    if (err) {
                        console.error('Error fetching prescriptions:', err);
                        prescriptions = [];
                    }
                    
                    res.render('students/medical-records', {
                        title: 'Medical Records',
                        user: req.session.user,
                        records: records,
                        prescriptions: prescriptions
                    });
                }
            );
        }
    );
});

// Profile page
router.get('/profile', requireStudent, (req, res) => {
    const studentId = req.session.user.id;
    
    db.get(
        'SELECT * FROM users WHERE id = ?',
        [studentId],
        (err, student) => {
            if (err) {
                console.error('Error fetching student profile:', err);
                req.flash('error', 'Error loading profile');
                return res.redirect('/student');
            }
            
            res.render('students/profile', {
                title: 'My Profile',
                user: req.session.user,
                student: student
            });
        }
    );
});

// Update profile
router.post('/profile', requireStudent, (req, res) => {
    const studentId = req.session.user.id;
    const { full_name, email, phone, emergency_contact, allergies, medical_history } = req.body;
    
    db.run(
        `UPDATE users SET full_name = ?, email = ?, phone = ?, emergency_contact = ?, 
         allergies = ?, medical_history = ? WHERE id = ?`,
        [full_name, email, phone, emergency_contact, allergies, medical_history, studentId],
        function(err) {
            if (err) {
                console.error('Error updating profile:', err);
                req.flash('error', 'Failed to update profile');
            } else {
                req.flash('success', 'Profile updated successfully');
                // Update session user data
                req.session.user.full_name = full_name;
                req.session.user.email = email;
            }
            res.redirect('/student/profile');
        }
    );
});

// Test reminder service (remove in production)
router.get('/test-reminder', requireStudent, (req, res) => {
    const { checkAppointmentReminders } = require('../services/reminderService');
    
    // Create a test appointment for current user in 25 minutes
    const testTime = new Date(Date.now() + 25 * 60000);
    const testTimeString = testTime.toTimeString().split(' ')[0].substring(0, 5);
    
    db.run(
        `INSERT INTO appointments (student_id, service_id, appointment_date, appointment_time, status, reminder_sent) 
         VALUES (?, 1, date('now'), ?, 'scheduled', 0)`,
        [req.session.user.id, testTimeString + ':00'],
        function(err) {
            if (err) {
                console.error('Error creating test appointment:', err);
                return res.json({ success: false, message: 'Failed to create test appointment' });
            }
            
            // Trigger reminder check
            setTimeout(() => {
                checkAppointmentReminders();
            }, 1000);
            
            res.json({ 
                success: true, 
                message: 'Test appointment created and reminder check triggered',
                appointment_time: testTimeString,
                reminder_expected_in: '~5 minutes'
            });
        }
    );
});

// Check reminder status
router.get('/reminder-status', requireStudent, (req, res) => {
    const studentId = req.session.user.id;
    
    db.all(
        `SELECT id, appointment_date, appointment_time, status, reminder_sent 
         FROM appointments 
         WHERE student_id = ? 
         ORDER BY created_at DESC 
         LIMIT 5`,
        [studentId],
        (err, appointments) => {
            if (err) {
                return res.json({ error: 'Error fetching appointments' });
            }
            res.json({ appointments });
        }
    );
});

// Check if student already has an appointment on a specific date
router.get('/check-daily-appointment', requireStudent, (req, res) => {
    const studentId = req.session.user.id;
    const { date } = req.query;
    
    if (!date) {
        return res.json({ hasAppointment: false });
    }
    
    db.get(
        `SELECT id FROM appointments 
         WHERE student_id = ? 
         AND appointment_date = ? 
         AND status = 'scheduled' 
         LIMIT 1`,
        [studentId, date],
        (err, appointment) => {
            if (err) {
                console.error('Error checking daily appointment:', err);
                return res.json({ hasAppointment: false });
            }
            
            res.json({ hasAppointment: !!appointment });
        }
    );
});

module.exports = router;