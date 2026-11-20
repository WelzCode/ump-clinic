const nodemailer = require('nodemailer');

// Configure email transporter
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    }
});

const sendAppointmentReminder = async (studentEmail, studentName, appointmentDetails) => {
    try {
        const { appointment_date, appointment_time, service_name, nurse_name } = appointmentDetails;
        
        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: studentEmail,
            subject: 'Appointment Reminder - UMP Health Clinic',
            html: `
                <!DOCTYPE html>
                <html>
                <head>
                    <style>
                        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                        .header { background: #001aff; color: white; padding: 20px; text-align: center; }
                        .content { padding: 20px; }
                        .appointment-details { background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 15px 0; }
                        .footer { background: #f1f5f9; padding: 15px; text-align: center; font-size: 14px; color: #64748b; }
                    </style>
                </head>
                <body>
                    <div class="header">
                        <h1>UMP Health Clinic</h1>
                        <p>Appointment Reminder</p>
                    </div>
                    <div class="content">
                        <h2>Dear ${studentName},</h2>
                        <p>This is a friendly reminder about your upcoming appointment at the UMP Health Clinic:</p>
                        
                        <div class="appointment-details">
                            <h3>Appointment Details</h3>
                            <p><strong>Service:</strong> ${service_name}</p>
                            <p><strong>Date:</strong> ${new Date(appointment_date).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
                            <p><strong>Time:</strong> ${appointment_time}</p>
                            ${nurse_name ? `<p><strong>Healthcare Professional:</strong> ${nurse_name}</p>` : ''}
                        </div>
                        
                        <p><strong>Location:</strong> UMP Mbombela Campus, Building 11, Room 1011, First Floor</p>
                        
                        <p><strong>Please arrive 10 minutes before your scheduled appointment time.</strong></p>
                        
                        <p>If you need to reschedule or cancel your appointment, please visit the student portal or contact us.</p>
                        
                        <p><strong>Emergency Contact:</strong> 013 002 0001</p>
                        <p><strong>Clinic Phone:</strong> 013 002 0018</p>
                    </div>
                    <div class="footer">
                        <p>University of Mpumalanga Health Clinic</p>
                        <p>Mbombela Campus | Building 11, Room 1011</p>
                    </div>
                </body>
                </html>
            `
        };

        const result = await transporter.sendMail(mailOptions);
        console.log(`✅ Reminder email sent to ${studentEmail} for appointment on ${appointment_date} at ${appointment_time}`);
        return result;
    } catch (error) {
        console.error('❌ Error sending reminder email:', error);
        throw error;
    }
};

// Test email connection
const verifyEmailConnection = async () => {
    try {
        await transporter.verify();
        console.log('✅ Email server connection verified');
        return true;
    } catch (error) {
        console.error('❌ Email server connection failed:', error);
        return false;
    }
};

module.exports = {
    sendAppointmentReminder,
    verifyEmailConnection
};