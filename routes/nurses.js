const express = require('express');
const router = express.Router();
const db = require('../database/db');

// Middleware to check if user is a nurse
function requireNurse(req, res, next) {
    if (req.session.user && req.session.user.role === 'nurse') {
        next();
    } else {
        res.redirect('/auth/login');
    }
}

// Nurse dashboard
router.get('/', requireNurse, (req, res) => {
    const nurseId = req.session.user.id;
    const today = new Date().toISOString().split('T')[0];
    
    console.log('Fetching appointments for date:', today); // Debug log
    
    // Get today's appointments - FIXED QUERY
    db.all(
        `SELECT a.*, 
                u.full_name as student_name, 
                u.student_number,
                s.name as service_name,
                s.id as service_id
         FROM appointments a 
         LEFT JOIN users u ON a.student_id = u.id 
         LEFT JOIN services s ON a.service_id = s.id 
         WHERE a.appointment_date = ? 
         AND a.status = 'scheduled' 
         ORDER BY a.appointment_time`,
        [today],
        (err, appointments) => {
            if (err) {
                console.error('Error fetching appointments:', err);
                // More detailed error logging
                console.error('SQL Error details:', err.message);
                appointments = [];
            }
            
            console.log(`Found ${appointments ? appointments.length : 0} appointments for today`); // Debug log
            
            // If no appointments found, check why
            if (!appointments || appointments.length === 0) {
                db.all(
                    `SELECT appointment_date, status, COUNT(*) as count 
                     FROM appointments 
                     GROUP BY appointment_date, status 
                     ORDER BY appointment_date DESC LIMIT 5`,
                    (err, stats) => {
                        console.log('Recent appointment stats:', stats); // Debug info
                    }
                );
            }
            
            res.render('nurses/dashboard', {
                title: 'Nurse Dashboard',
                user: req.session.user,
                appointments: appointments || [],
                today: today
            });
        }
    );
});

// Patient queue (all appointments for the day)
router.get('/patient-queue', requireNurse, (req, res) => {
    const today = new Date().toISOString().split('T')[0];
    
    db.all(
        `SELECT a.*, u.full_name as student_name, s.name as service_name 
         FROM appointments a 
         LEFT JOIN users u ON a.student_id = u.id 
         LEFT JOIN services s ON a.service_id = s.id 
         WHERE a.appointment_date = ? AND a.status = 'scheduled' 
         ORDER BY a.appointment_time`,
        [today],
        (err, appointments) => {
            if (err) {
                console.error('Error fetching appointments:', err);
                appointments = [];
            }
            
            res.render('nurses/patient-queue', {
                title: 'Patient Queue',
                user: req.session.user,
                appointments: appointments,
                today: today
            });
        }
    );
});

// Start consultation
router.get('/consultation/:appointmentId', requireNurse, (req, res) => {
    const appointmentId = req.params.appointmentId;
    
    db.get(
        `SELECT a.*, u.full_name as student_name, u.allergies, u.medical_history, s.name as service_name
         FROM appointments a 
         LEFT JOIN users u ON a.student_id = u.id 
         LEFT JOIN services s ON a.service_id = s.id
         WHERE a.id = ?`,
        [appointmentId],
        (err, appointment) => {
            if (err || !appointment) {
                req.flash('error', 'Appointment not found');
                return res.redirect('/nurse/patient-queue');
            }
            
            // Get student's recent medical records
            db.all(
                `SELECT mr.*, u.full_name as nurse_name 
                 FROM medical_records mr 
                 LEFT JOIN users u ON mr.nurse_id = u.id 
                 WHERE mr.student_id = ? 
                 ORDER BY mr.record_date DESC LIMIT 5`,
                [appointment.student_id],
                (err, records) => {
                    if (err) {
                        console.error('Error fetching records:', err);
                        records = [];
                    }
                    
                    // Get active prescriptions
                    db.all(
                        `SELECT p.*, u.full_name as nurse_name 
                         FROM prescriptions p 
                         LEFT JOIN users u ON p.nurse_id = u.id 
                         WHERE p.student_id = ? AND p.is_active = 1 
                         ORDER BY p.prescribed_date DESC`,
                        [appointment.student_id],
                        (err, prescriptions) => {
                            if (err) {
                                console.error('Error fetching prescriptions:', err);
                                prescriptions = [];
                            }
                            
                            res.render('nurses/consultation', {
                                title: 'Patient Consultation',
                                user: req.session.user,
                                appointment: appointment,
                                records: records,
                                prescriptions: prescriptions
                            });
                        }
                    );
                }
            );
        }
    );
});

// Update medical records
router.post('/update-records/:appointmentId', requireNurse, (req, res) => {
    const appointmentId = req.params.appointmentId;
    const nurseId = req.session.user.id;
    const { consultation_notes, diagnosis, symptoms, treatment } = req.body;
    
    // Get appointment details first
    db.get(
        'SELECT * FROM appointments WHERE id = ?',
        [appointmentId],
        (err, appointment) => {
            if (err || !appointment) {
                req.flash('error', 'Appointment not found');
                return res.redirect('/nurse/patient-queue');
            }
            
            // Insert medical record
            db.run(
                `INSERT INTO medical_records 
                 (student_id, nurse_id, appointment_id, consultation_notes, diagnosis, symptoms, treatment) 
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [appointment.student_id, nurseId, appointmentId, consultation_notes, diagnosis, symptoms, treatment],
                function(err) {
                    if (err) {
                        console.error('Error updating records:', err);
                        req.flash('error', 'Failed to update medical records');
                    } else {
                        // Mark appointment as completed and assign nurse
                        db.run(
                            'UPDATE appointments SET status = "completed", nurse_id = ? WHERE id = ?',
                            [nurseId, appointmentId],
                            function(updateErr) {
                                if (updateErr) {
                                    console.error('Error updating appointment:', updateErr);
                                }
                            }
                        );
                        req.flash('success', 'Medical records updated successfully');
                    }
                    res.redirect('/nurse/patient-queue');
                }
            );
        }
    );
});

// Prescribe medication
router.post('/prescribe/:studentId', requireNurse, (req, res) => {
    const studentId = req.params.studentId;
    const nurseId = req.session.user.id;
    const { medication_name, dosage, instructions } = req.body;
    
    db.run(
        `INSERT INTO prescriptions (student_id, nurse_id, medication_name, dosage, instructions) 
         VALUES (?, ?, ?, ?, ?)`,
        [studentId, nurseId, medication_name, dosage, instructions],
        function(err) {
            if (err) {
                console.error('Error adding prescription:', err);
                req.flash('error', 'Failed to add prescription');
            } else {
                req.flash('success', 'Prescription added successfully');
            }
            res.redirect('back');
        }
    );
});

// View student medical history
router.get('/student-history/:studentId', requireNurse, (req, res) => {
    const studentId = req.params.studentId;
    
    db.get(
        'SELECT * FROM users WHERE id = ?',
        [studentId],
        (err, student) => {
            if (err || !student) {
                req.flash('error', 'Student not found');
                return res.redirect('/nurse/patient-queue');
            }
            
            // Get complete medical history
            db.all(
                `SELECT mr.*, u.full_name as nurse_name 
                 FROM medical_records mr 
                 LEFT JOIN users u ON mr.nurse_id = u.id 
                 WHERE mr.student_id = ? 
                 ORDER BY mr.record_date DESC`,
                [studentId],
                (err, records) => {
                    if (err) {
                        console.error('Error fetching records:', err);
                        records = [];
                    }
                    
                    // Get all prescriptions
                    db.all(
                        `SELECT p.*, u.full_name as nurse_name 
                         FROM prescriptions p 
                         LEFT JOIN users u ON p.nurse_id = u.id 
                         WHERE p.student_id = ? 
                         ORDER BY p.prescribed_date DESC`,
                        [studentId],
                        (err, prescriptions) => {
                            if (err) {
                                console.error('Error fetching prescriptions:', err);
                                prescriptions = [];
                            }
                            
                            res.render('nurses/student-history', {
                                title: 'Student Medical History',
                                user: req.session.user,
                                student: student,
                                records: records,
                                prescriptions: prescriptions
                            });
                        }
                    );
                }
            );
        }
    );
});

// Add this route to nurses.js to create test medical records
router.get('/create-test-medical-record/:studentId', requireNurse, (req, res) => {
    const studentId = req.params.studentId;
    const nurseId = req.session.user.id;
    
    // First, get or create an appointment for this student
    db.get(
        `SELECT id FROM appointments WHERE student_id = ? AND status = 'completed' LIMIT 1`,
        [studentId],
        (err, appointment) => {
            let appointmentId = appointment ? appointment.id : null;
            
            // If no completed appointment exists, create one
            if (!appointmentId) {
                const today = new Date().toISOString().split('T')[0];
                db.run(
                    `INSERT INTO appointments (student_id, service_id, appointment_date, appointment_time, status, nurse_id) 
                     VALUES (?, 1, ?, '10:00:00', 'completed', ?)`,
                    [studentId, today, nurseId],
                    function(err) {
                        if (err) {
                            console.error('Error creating test appointment:', err);
                            return res.json({ error: 'Failed to create test appointment' });
                        }
                        appointmentId = this.lastID;
                        createMedicalRecord(appointmentId);
                    }
                );
            } else {
                createMedicalRecord(appointmentId);
            }
            
            function createMedicalRecord(apptId) {
                // Create a test medical record
                db.run(
                    `INSERT INTO medical_records 
                     (student_id, nurse_id, appointment_id, consultation_notes, diagnosis, symptoms, treatment) 
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [
                        studentId, 
                        nurseId, 
                        apptId,
                        'Routine checkup. Student presented with mild symptoms.',
                        'Common cold',
                        'Cough, runny nose, mild fever',
                        'Rest, hydration, over-the-counter cold medication'
                    ],
                    function(err) {
                        if (err) {
                            console.error('Error creating medical record:', err);
                            return res.json({ error: err.message });
                        }
                        
                        // Also create a test prescription
                        db.run(
                            `INSERT INTO prescriptions 
                             (student_id, nurse_id, medication_name, dosage, instructions) 
                             VALUES (?, ?, ?, ?, ?)`,
                            [
                                studentId,
                                nurseId,
                                'Acetaminophen',
                                '500mg',
                                'Take every 6 hours as needed for fever or pain'
                            ],
                            function(err) {
                                if (err) {
                                    console.error('Error creating prescription:', err);
                                }
                                
                                res.json({ 
                                    success: true, 
                                    medical_record_id: this.lastID,
                                    message: 'Test medical record and prescription created successfully' 
                                });
                            }
                        );
                    }
                );
            }
        }
    );
});

module.exports = router;