const db = require('../database/db');
const { sendAppointmentReminder, verifyEmailConnection } = require('./emailService');
const nodeCron = require('node-cron');

// Function to check for appointments that need reminders
const checkAppointmentReminders = async () => {
    try {
        console.log('🔍 Checking for appointment reminders...');
        
        // Get current time and 30 minutes from now
        const now = new Date();
        const thirtyMinutesFromNow = new Date(now.getTime() + 30 * 60000);
        
        // Format for SQLite (YYYY-MM-DD HH:MM:SS)
        const nowTime = now.toTimeString().split(' ')[0];
        const futureTime = thirtyMinutesFromNow.toTimeString().split(' ')[0];
        
        console.log(`Checking appointments between ${nowTime} and ${futureTime}`);
        
        const query = `
            SELECT a.*, u.email, u.full_name, s.name as service_name, nurse.full_name as nurse_name
            FROM appointments a
            JOIN users u ON a.student_id = u.id
            LEFT JOIN services s ON a.service_id = s.id
            LEFT JOIN users nurse ON a.nurse_id = nurse.id
            WHERE a.status = 'scheduled'
            AND a.appointment_date = date('now')
            AND time(a.appointment_time) BETWEEN time(?) AND time(?)
            AND (a.reminder_sent = 0 OR a.reminder_sent IS NULL)
        `;
        
        db.all(query, [nowTime, futureTime], async (err, appointments) => {
            if (err) {
                console.error('❌ Error fetching appointments for reminders:', err);
                return;
            }
            
            console.log(`📧 Found ${appointments.length} appointments needing reminders`);
            
            for (const appointment of appointments) {
                try {
                    console.log(`Sending reminder for appointment ${appointment.id} to ${appointment.email}`);
                    
                    await sendAppointmentReminder(
                        appointment.email,
                        appointment.full_name,
                        {
                            appointment_date: appointment.appointment_date,
                            appointment_time: appointment.appointment_time,
                            service_name: appointment.service_name,
                            nurse_name: appointment.nurse_name
                        }
                    );
                    
                    // Mark reminder as sent
                    db.run(
                        'UPDATE appointments SET reminder_sent = 1 WHERE id = ?',
                        [appointment.id],
                        (updateErr) => {
                            if (updateErr) {
                                console.error('❌ Error updating reminder status:', updateErr);
                            } else {
                                console.log(`✅ Reminder marked as sent for appointment ${appointment.id}`);
                            }
                        }
                    );
                    
                } catch (emailError) {
                    console.error(`❌ Failed to send reminder for appointment ${appointment.id}:`, emailError.message);
                }
            }
            
            if (appointments.length === 0) {
                console.log('✅ No appointments need reminders at this time');
            }
        });
        
    } catch (error) {
        console.error('❌ Error in reminder service:', error);
    }
};

// Schedule the reminder check to run every minute
const startReminderService = () => {
    console.log('🔄 Starting appointment reminder service...');
    
    // Verify email connection first
    verifyEmailConnection().then(success => {
        if (success) {
            // Run every minute
            nodeCron.schedule('* * * * *', checkAppointmentReminders);
            console.log('✅ Appointment reminder service started successfully');
            console.log('⏰ Reminder service will check for appointments every minute');
            
            // Run initial check
            setTimeout(checkAppointmentReminders, 2000);
        } else {
            console.error('❌ Failed to start reminder service due to email connection issues');
        }
    }).catch(error => {
        console.error('❌ Error starting reminder service:', error);
    });
};

module.exports = {
    checkAppointmentReminders,
    startReminderService
};