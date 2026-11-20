const express = require('express');
const router = express.Router();
const db = require('../database/db');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');

// Helper function to hash passwords (using bcrypt now)
async function hashPassword(password) {
    const saltRounds = 10;
    return await bcrypt.hash(password, saltRounds);
}

const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: process.env.EMAIL_SECURE === 'true', // true for 465, false for other ports
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
    tls: {
        rejectUnauthorized: false
    }
});

transporter.verify((error, success) => {
    if (error) {
        console.log('Email transporter error:', error);
    } else {
        console.log('Email server is ready to send messages');
    }
});

// Helper function to generate verification token
function generateVerificationToken() {
    return crypto.randomBytes(32).toString('hex');
}

// Helper function to send verification email
async function sendVerificationEmail(email, token, fullName) {
    const verificationLink = `http://localhost:3000/auth/verify-email?token=${token}`;
    
    const mailOptions = {
        from: process.env.EMAIL_USER || 'university-clinic@example.com',
        to: email,
        subject: 'Verify Your University Clinic Account',
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #0d6efd;">Welcome to University Health Clinic!</h2>
                <p>Dear ${fullName},</p>
                <p>Thank you for registering with University Health Clinic. To complete your registration, please verify your email address by clicking the button below:</p>
                
                <div style="text-align: center; margin: 30px 0;">
                    <a href="${verificationLink}" 
                       style="background-color: #0d6efd; color: white; padding: 12px 24px; 
                              text-decoration: none; border-radius: 5px; display: inline-block;">
                        Verify Email Address
                    </a>
                </div>
                
                <p>Or copy and paste this link in your browser:</p>
                <p style="word-break: break-all; color: #666;">${verificationLink}</p>
                
                <p>This verification link will expire in 24 hours.</p>
                
                <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd;">
                    <p style="color: #666; font-size: 14px;">
                        If you didn't create an account with University Health Clinic, 
                        please ignore this email.
                    </p>
                </div>
            </div>
        `
    };

    try {
        await transporter.sendMail(mailOptions);
        return true;
    } catch (error) {
        console.error('Error sending verification email:', error);
        return false;
    }
}

// Registration page
router.get('/register', (req, res) => {
    if (req.session.user) {
        return res.redirect('/' + req.session.user.role);
    }
    res.render('public/register', { 
        title: 'Student Registration', 
        error: null,
        formData: {}
    });
});

// Handle registration with email verification
router.post('/register', async (req, res) => {
    const { student_number, full_name, email, password, confirm_password } = req.body;

    try {
        // Validation
        if (password !== confirm_password) {
            return res.render('public/register', { 
                title: 'Student Registration', 
                error: 'Passwords do not match',
                formData: req.body
            });
        }

        if (!student_number.match(/^2\d{8}$/)) {
            return res.render('public/register', { 
                title: 'Student Registration', 
                error: 'Student number must be 9 digits starting with 2',
                formData: req.body
            });
        }

        // Check if student number or email already exists
        db.get(
            'SELECT * FROM users WHERE student_number = ? OR email = ?', 
            [student_number, email],
            async (err, row) => {
                if (err) {
                    console.error('Registration error:', err);
                    return res.render('public/register', { 
                        title: 'Student Registration', 
                        error: 'Database error occurred',
                        formData: req.body
                    });
                }

                if (row) {
                    return res.render('public/register', { 
                        title: 'Student Registration', 
                        error: 'Student number or email already exists',
                        formData: req.body
                    });
                }

                // Generate verification token and hash password
                const verificationToken = generateVerificationToken();
                const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
                const hashedPassword = await hashPassword(password);

                // Insert new student with verification data
                db.run(
                    `INSERT INTO users (student_number, full_name, email, password, role, 
                     verification_token, verification_expires) 
                     VALUES (?, ?, ?, ?, 'student', ?, ?)`,
                    [student_number, full_name, email, hashedPassword, verificationToken, verificationExpires.toISOString()],
                    async function(err) {
                        if (err) {
                            console.error('Registration insert error:', err);
                            return res.render('public/register', { 
                                title: 'Student Registration', 
                                error: 'Registration failed. Please try again.',
                                formData: req.body
                            });
                        }

                        // Send verification email
                        const emailSent = await sendVerificationEmail(email, verificationToken, full_name);
                        
                        if (emailSent) {
                            req.flash('success', 'Registration successful! Please check your email to verify your account.');
                            res.redirect('/auth/login');
                        } else {
                            // If email fails, delete the user and show error
                            db.run('DELETE FROM users WHERE id = ?', [this.lastID]);
                            return res.render('public/register', { 
                                title: 'Student Registration', 
                                error: 'Failed to send verification email. Please try again.',
                                formData: req.body
                            });
                        }
                    }
                );
            }
        );
    } catch (error) {
        console.error('Registration process error:', error);
        return res.render('public/register', { 
            title: 'Student Registration', 
            error: 'Registration failed. Please try again.',
            formData: req.body
        });
    }
});

// Email verification page
router.get('/verify-email', (req, res) => {
    const { token } = req.query;
    
    if (!token) {
        return res.render('public/verify-email', {
            title: 'Email Verification',
            success: false,
            message: 'Invalid verification link.'
        });
    }

    // Find user with this token and check expiration
    db.get(
        'SELECT * FROM users WHERE verification_token = ? AND verification_expires > ?',
        [token, new Date().toISOString()],
        (err, user) => {
            if (err) {
                console.error('Verification error:', err);
                return res.render('public/verify-email', {
                    title: 'Email Verification',
                    success: false,
                    message: 'Verification error occurred.'
                });
            }

            if (!user) {
                return res.render('public/verify-email', {
                    title: 'Email Verification',
                    success: false,
                    message: 'Invalid or expired verification link. Please request a new one.'
                });
            }

            // Update user as verified and active
            db.run(
                'UPDATE users SET is_verified = 1, is_active = 1, verification_token = NULL, verification_expires = NULL WHERE id = ?',
                [user.id],
                function(err) {
                    if (err) {
                        console.error('Verification update error:', err);
                        return res.render('public/verify-email', {
                            title: 'Email Verification',
                            success: false,
                            message: 'Verification failed. Please try again.'
                        });
                    }

                    res.render('public/verify-email', {
                        title: 'Email Verification',
                        success: true,
                        message: 'Email verified successfully! You can now login to your account.'
                    });
                }
            );
        }
    );
});

// Resend verification email
router.get('/resend-verification', (req, res) => {
    res.render('public/resend-verification', {
        title: 'Resend Verification Email',
        error: null,
        success: null
    });
});

router.post('/resend-verification', async (req, res) => {
    const { email } = req.body;

    // Find user by email
    db.get(
        'SELECT * FROM users WHERE email = ? AND is_verified = 0',
        [email],
        async (err, user) => {
            if (err) {
                console.error('Resend verification error:', err);
                return res.render('public/resend-verification', {
                    title: 'Resend Verification Email',
                    error: 'Error occurred. Please try again.',
                    success: null
                });
            }

            if (!user) {
                return res.render('public/resend-verification', {
                    title: 'Resend Verification Email',
                    error: 'No unverified account found with this email, or account is already verified.',
                    success: null
                });
            }

            // Generate new verification token
            const newToken = generateVerificationToken();
            const newExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

            // Update user with new token
            db.run(
                'UPDATE users SET verification_token = ?, verification_expires = ? WHERE id = ?',
                [newToken, newExpires.toISOString(), user.id],
                async function(err) {
                    if (err) {
                        console.error('Token update error:', err);
                        return res.render('public/resend-verification', {
                            title: 'Resend Verification Email',
                            error: 'Failed to generate new verification link.',
                            success: null
                        });
                    }

                    // Send new verification email
                    const emailSent = await sendVerificationEmail(user.email, newToken, user.full_name);
                    
                    if (emailSent) {
                        res.render('public/resend-verification', {
                            title: 'Resend Verification Email',
                            error: null,
                            success: 'Verification email sent! Please check your inbox.'
                        });
                    } else {
                        res.render('public/resend-verification', {
                            title: 'Resend Verification Email',
                            error: 'Failed to send verification email. Please try again.',
                            success: null
                        });
                    }
                }
            );
        }
    );
});

// Updated login to check for verification
router.post('/login', (req, res) => {
    const { student_number, password } = req.body;

    db.get(
        `SELECT id, student_number, full_name, email, role, is_active, is_verified, password
         FROM users WHERE (student_number = ? OR email = ?) AND is_active = 1`,
        [student_number, student_number],
        async (err, user) => {
            if (err) {
                console.error('Login error:', err);
                return res.render('public/login', { 
                    title: 'Login', 
                    error: 'Database error occurred'
                });
            }

            if (!user) {
                return res.render('public/login', { 
                    title: 'Login', 
                    error: 'Invalid credentials or account inactive'
                });
            }

            // Check if account is verified
            if (!user.is_verified) {
                return res.render('public/login', { 
                    title: 'Login', 
                    error: 'Please verify your email before logging in. <a href="/auth/resend-verification">Resend verification email</a>'
                });
            }

            // Verify password
            const passwordMatch = await bcrypt.compare(password, user.password);
            if (!passwordMatch) {
                return res.render('public/login', { 
                    title: 'Login', 
                    error: 'Invalid credentials'
                });
            }

            // Set session (remove password from session)
            const { password: _, ...userWithoutPassword } = user;
            req.session.user = userWithoutPassword;
            req.flash('success', `Welcome back, ${user.full_name}!`);
            res.redirect('/' + user.role);
        }
    );
});

// Keep existing logout and other routes...
router.get('/login', (req, res) => {
    if (req.session.user) {
        return res.redirect('/' + req.session.user.role);
    }
    res.render('public/login', { 
        title: 'Login', 
        error: null
    });
});

router.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('Error destroying session:', err);
        }
        res.redirect('/');
    });
});

module.exports = router;
