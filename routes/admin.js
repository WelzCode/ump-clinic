const express = require('express');
const router = express.Router();
const db = require('../database/db');

// Middleware to check if user is an admin
function requireAdmin(req, res, next) {
    if (req.session.user && req.session.user.role === 'admin') {
        next();
    } else {
        res.redirect('/auth/login');
    }
}

// Admin dashboard
router.get('/', requireAdmin, (req, res) => {
    const today = new Date().toISOString().split('T')[0];
    
    // Get today's statistics
    db.get(
        `SELECT COUNT(*) as total_appointments,
                SUM(CASE WHEN status = 'scheduled' THEN 1 ELSE 0 END) as pending,
                SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed
         FROM appointments WHERE appointment_date = ?`,
        [today],
        (err, stats) => {
            if (err) {
                console.error('Error fetching stats:', err);
                stats = { total_appointments: 0, pending: 0, completed: 0 };
            }
            
            // Get recent appointments
            db.all(
                `SELECT a.*, u1.full_name as student_name, u2.full_name as nurse_name, s.name as service_name 
                 FROM appointments a 
                 LEFT JOIN users u1 ON a.student_id = u1.id 
                 LEFT JOIN users u2 ON a.nurse_id = u2.id 
                 LEFT JOIN services s ON a.service_id = s.id 
                 WHERE a.appointment_date >= date('now') 
                 ORDER BY a.appointment_date, a.appointment_time 
                 LIMIT 3`,
                (err, appointments) => {
                    if (err) {
                        console.error('Error fetching appointments:', err);
                        appointments = [];
                    }
                    
                    res.render('admin/dashboard', {
                        title: 'Admin Dashboard',
                        user: req.session.user,
                        stats: stats,
                        appointments: appointments
                    });
                }
            );
        }
    );
});

// Manage appointments page - FIXED VERSION
router.get('/appointments', requireAdmin, (req, res) => {
    const { date, status } = req.query;
    
    let query = `
        SELECT a.*, 
               u1.full_name as student_name, 
               u1.student_number as student_number,
               u2.full_name as nurse_name, 
               s.name as service_name
        FROM appointments a 
        LEFT JOIN users u1 ON a.student_id = u1.id 
        LEFT JOIN users u2 ON a.nurse_id = u2.id 
        LEFT JOIN services s ON a.service_id = s.id 
        WHERE 1=1
    `;
    
    let params = [];
    
    // Filter by date - handle empty date
    if (date && date !== '') {
        query += ' AND a.appointment_date = ?';
        params.push(date);
    } else {
        // Default to showing today's and future appointments if no date specified
        query += ' AND a.appointment_date >= date("now")';
    }
    
    // Filter by status
    if (status && status !== 'all') {
        query += ' AND a.status = ?';
        params.push(status);
    }
    
    query += ' ORDER BY a.appointment_date DESC, a.appointment_time DESC';
    
    console.log('Query:', query); // Debug log
    console.log('Params:', params); // Debug log
    
    db.all(query, params, (err, appointments) => {
        if (err) {
            console.error('Error fetching appointments:', err);
            appointments = [];
        }
        
        console.log('Found appointments:', appointments.length); // Debug log
        
        // Get students for the modal
        db.all('SELECT id, student_number, full_name FROM users WHERE role = "student" AND is_active = 1 ORDER BY full_name', (err, students) => {
            if (err) {
                console.error('Error fetching students:', err);
                students = [];
            }
            
            // Get services for the modal
            db.all('SELECT id, name FROM services WHERE is_active = 1 ORDER BY name', (err, services) => {
                if (err) {
                    console.error('Error fetching services:', err);
                    services = [];
                }
                
                // Get nurses for the modal
                db.all('SELECT id, full_name FROM users WHERE role = "nurse" AND is_active = 1 ORDER BY full_name', (err, nurses) => {
                    if (err) {
                        console.error('Error fetching nurses:', err);
                        nurses = [];
                    }
                    
                    res.render('admin/appointments', {
                        title: 'Manage Appointments',
                        user: req.session.user,
                        appointments: appointments,
                        students: students,
                        services: services,
                        nurses: nurses,
                        filterDate: date || '',
                        currentStatus: status || 'all'
                    });
                });
            });
        });
    });
});

// Update the existing POST /admin/appointments route
router.post('/appointments', requireAdmin, (req, res) => {
    const { student_number, nurse_id, service_id, appointment_date, appointment_time } = req.body;
    const sqlTime = appointment_time.length === 5 ? appointment_time + ':00' : appointment_time;
    
    // First, find the student by student number
    db.get(
        'SELECT id FROM users WHERE student_number = ? AND role = "student" AND is_active = 1',
        [student_number],
        (err, student) => {
            if (err) {
                req.flash('error', 'Database error: ' + err.message);
                return res.redirect('/admin/appointments');
            }
            
            if (!student) {
                req.flash('error', 'Student not found with the provided student number');
                return res.redirect('/admin/appointments');
            }
            
            // Check for existing appointment at the same time and service
            db.get(
                `SELECT id FROM appointments 
                 WHERE service_id = ? 
                 AND appointment_date = ? 
                 AND appointment_time = ? 
                 AND status = 'scheduled'`,
                [service_id, appointment_date, sqlTime],
                (err, existing) => {
                    if (err) {
                        req.flash('error', 'Database error: ' + err.message);
                        return res.redirect('/admin/appointments');
                    }
                    
                    if (existing) {
                        req.flash('error', 'Time slot already booked for this service. Please choose another time.');
                        return res.redirect('/admin/appointments');
                    }
                    
                    // Check if student already has an appointment on this date (daily limit)
                    db.get(
                        `SELECT id FROM appointments 
                         WHERE student_id = ? 
                         AND appointment_date = ? 
                         AND status = 'scheduled'`,
                        [student.id, appointment_date],
                        (err, dailyAppointment) => {
                            if (err) {
                                req.flash('error', 'Database error: ' + err.message);
                                return res.redirect('/admin/appointments');
                            }
                            
                            if (dailyAppointment) {
                                req.flash('error', 'This student already has an appointment scheduled for this date.');
                                return res.redirect('/admin/appointments');
                            }
                            
                            // Create appointment if no conflicts
                            db.run(
                                `INSERT INTO appointments (student_id, nurse_id, service_id, appointment_date, appointment_time, status, reminder_sent) 
                                 VALUES (?, ?, ?, ?, ?, 'scheduled', 0)`,
                                [student.id, nurse_id || null, service_id, appointment_date, sqlTime],
                                function(err) {
                                    if (err) {
                                        req.flash('error', 'Failed to create appointment: ' + err.message);
                                    } else {
                                        req.flash('success', 'Appointment created successfully');
                                    }
                                    res.redirect('/admin/appointments');
                                }
                            );
                        }
                    );
                }
            );
        }
    );
});

// Update appointment status
router.post('/appointments/:id/status', requireAdmin, (req, res) => {
    const appointmentId = req.params.id;
    const { status } = req.body;
    
    db.run(
        'UPDATE appointments SET status = ? WHERE id = ?',
        [status, appointmentId],
        function(err) {
            if (err) {
                req.flash('error', 'Failed to update appointment');
            } else {
                req.flash('success', 'Appointment updated successfully');
            }
            res.redirect('/admin/appointments');
        }
    );
});

// Manage users
router.get('/users', requireAdmin, (req, res) => {
    const { role, search } = req.query;
    
    let query = `SELECT id, student_number, full_name, email, role, is_active, created_at 
                 FROM users WHERE 1=1`;
    let params = [];
    
    if (role && role !== 'all') {
        query += ' AND role = ?';
        params.push(role);
    }
    
    if (search) {
        query += ' AND (full_name LIKE ? OR email LIKE ? OR student_number LIKE ?)';
        const searchTerm = `%${search}%`;
        params.push(searchTerm, searchTerm, searchTerm);
    }
    
    query += ' ORDER BY created_at DESC';
    
    db.all(query, params, (err, users) => {
        if (err) {
            console.error('Error fetching users:', err);
            users = [];
        }
        
        res.render('admin/users', {
            title: 'Manage Users',
            user: req.session.user,
            users: users,
            filters: { role, search }
        });
    });
});

// Edit user page
router.get('/users/:id/edit', requireAdmin, (req, res) => {
    const userId = req.params.id;
    
    db.get(
        'SELECT * FROM users WHERE id = ?',
        [userId],
        (err, user) => {
            if (err || !user) {
                req.flash('error', 'User not found');
                return res.redirect('/admin/users');
            }
            
            res.render('admin/edit-user', {
                title: 'Edit User',
                user: req.session.user,
                editUser: user
            });
        }
    );
});

// Update user - CHANGED TO POST AND INCLUDES STUDENT_NUMBER
router.post('/users/:id', requireAdmin, (req, res) => {
    const userId = req.params.id;
    const { full_name, email, student_number, role, is_active } = req.body;
    
    db.run(
        'UPDATE users SET full_name = ?, email = ?, student_number = ?, role = ?, is_active = ? WHERE id = ?',
        [full_name, email, student_number, role, is_active ? 1 : 0, userId],
        function(err) {
            if (err) {
                console.error('Error updating user:', err);
                req.flash('error', 'Failed to update user');
            } else {
                req.flash('success', 'User updated successfully');
            }
            res.redirect('/admin/users');
        }
    );
});

// Toggle user status
router.post('/users/:id/toggle-status', requireAdmin, (req, res) => {
    const userId = req.params.id;
    
    db.run(
        'UPDATE users SET is_active = NOT is_active WHERE id = ?',
        [userId],
        function(err) {
            if (err) {
                res.status(500).json({ success: false, error: err.message });
            } else {
                res.json({ success: true });
            }
        }
    );
});

// Clinic settings
router.get('/settings', requireAdmin, (req, res) => {
    db.get('SELECT * FROM clinic_settings WHERE id = 1', (err, settings) => {
        if (err) {
            console.error('Error fetching settings:', err);
            settings = {};
        }
        
        db.all('SELECT * FROM services ORDER BY name', (err, services) => {
            if (err) {
                console.error('Error fetching services:', err);
                services = [];
            }
            
            db.all('SELECT * FROM users WHERE role = "nurse" AND is_active = 1', (err, nurses) => {
                if (err) {
                    console.error('Error fetching nurses:', err);
                    nurses = [];
                }
                
                res.render('admin/settings', {
                    title: 'Clinic Settings',
                    user: req.session.user,
                    settings: settings,
                    services: services,
                    nurses: nurses
                });
            });
        });
    });
});

// Update clinic settings
router.post('/settings', requireAdmin, (req, res) => {
    const { opening_time, closing_time, appointment_duration, max_appointments_per_day } = req.body;
    
    // Check if settings exist
    db.get('SELECT * FROM clinic_settings WHERE id = 1', (err, row) => {
        if (err) {
            req.flash('error', 'Database error');
            return res.redirect('/admin/settings');
        }
        
        if (row) {
            // Update existing settings
            db.run(
                `UPDATE clinic_settings SET opening_time = ?, closing_time = ?, 
                 appointment_duration = ?, max_appointments_per_day = ? WHERE id = 1`,
                [opening_time, closing_time, appointment_duration, max_appointments_per_day],
                function(err) {
                    if (err) {
                        req.flash('error', 'Failed to update settings');
                    } else {
                        req.flash('success', 'Settings updated successfully');
                    }
                    res.redirect('/admin/settings');
                }
            );
        } else {
            // Insert new settings
            db.run(
                `INSERT INTO clinic_settings (opening_time, closing_time, appointment_duration, max_appointments_per_day) 
                 VALUES (?, ?, ?, ?)`,
                [opening_time, closing_time, appointment_duration, max_appointments_per_day],
                function(err) {
                    if (err) {
                        req.flash('error', 'Failed to save settings');
                    } else {
                        req.flash('success', 'Settings saved successfully');
                    }
                    res.redirect('/admin/settings');
                }
            );
        }
    });
});

// Add new service
router.post('/services', requireAdmin, (req, res) => {
    const { name, description } = req.body;
    
    db.run(
        'INSERT INTO services (name, description) VALUES (?, ?)',
        [name, description],
        function(err) {
            if (err) {
                req.flash('error', 'Failed to add service');
            } else {
                req.flash('success', 'Service added successfully');
            }
            res.redirect('/admin/settings#services');
        }
    );
});

// Toggle service status
router.post('/services/:id/toggle', requireAdmin, (req, res) => {
    const serviceId = req.params.id;
    
    db.run(
        'UPDATE services SET is_active = NOT is_active WHERE id = ?',
        [serviceId],
        function(err) {
            if (err) {
                req.flash('error', 'Failed to update service');
            } else {
                req.flash('success', 'Service updated successfully');
            }
            res.redirect('/admin/settings#services');
        }
    );
});

// Check if student exists by student number
router.get('/check-student', requireAdmin, (req, res) => {
    const { student_number } = req.query;
    
    if (!student_number) {
        return res.json({ exists: false });
    }
    
    db.get(
        'SELECT id, student_number, full_name, email FROM users WHERE student_number = ? AND role = "student" AND is_active = 1',
        [student_number],
        (err, student) => {
            if (err) {
                console.error('Error checking student:', err);
                return res.json({ exists: false });
            }
            
            res.json({ 
                exists: !!student,
                student: student 
            });
        }
    );
});

// Check if student already has appointment on specific date
router.get('/check-student-appointment', requireAdmin, (req, res) => {
    const { student_id, date } = req.query;
    
    if (!student_id || !date) {
        return res.json({ hasAppointment: false });
    }
    
    db.get(
        `SELECT a.id, u.full_name 
         FROM appointments a 
         JOIN users u ON a.student_id = u.id 
         WHERE a.student_id = ? 
         AND a.appointment_date = ? 
         AND a.status = 'scheduled' 
         LIMIT 1`,
        [student_id, date],
        (err, appointment) => {
            if (err) {
                console.error('Error checking student appointment:', err);
                return res.json({ hasAppointment: false });
            }
            
            // Get student info for response
            db.get(
                'SELECT full_name FROM users WHERE id = ?',
                [student_id],
                (err, student) => {
                    res.json({ 
                        hasAppointment: !!appointment,
                        student: student || { full_name: '' }
                    });
                }
            );
        }
    );
});

// Check if student exists by student number
router.get('/check-student', requireAdmin, (req, res) => {
    const { student_number } = req.query;
    
    if (!student_number) {
        return res.json({ exists: false });
    }
    
    db.get(
        'SELECT id, student_number, full_name, email FROM users WHERE student_number = ? AND role = "student" AND is_active = 1',
        [student_number],
        (err, student) => {
            if (err) {
                console.error('Error checking student:', err);
                return res.json({ exists: false });
            }
            
            res.json({ 
                exists: !!student,
                student: student 
            });
        }
    );
});

// Check if student already has appointment on specific date
router.get('/check-student-appointment', requireAdmin, (req, res) => {
    const { student_id, date } = req.query;
    
    if (!student_id || !date) {
        return res.json({ hasAppointment: false });
    }
    
    db.get(
        `SELECT a.id, u.full_name 
         FROM appointments a 
         JOIN users u ON a.student_id = u.id 
         WHERE a.student_id = ? 
         AND a.appointment_date = ? 
         AND a.status = 'scheduled' 
         LIMIT 1`,
        [student_id, date],
        (err, appointment) => {
            if (err) {
                console.error('Error checking student appointment:', err);
                return res.json({ hasAppointment: false });
            }
            
            // Get student info for response
            db.get(
                'SELECT full_name FROM users WHERE id = ?',
                [student_id],
                (err, student) => {
                    res.json({ 
                        hasAppointment: !!appointment,
                        student: student || { full_name: '' }
                    });
                }
            );
        }
    );
});

module.exports = router;