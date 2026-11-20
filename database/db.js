const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const crypto = require('crypto');

const dbPath = path.join(__dirname, 'university_clinic.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
    } else {
        console.log('Connected to SQLite database.');
        initializeTables();
    }
});

function initializeTables() {
    // Create tables one by one with proper error handling
    const tables = [
        `CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_number VARCHAR(9) UNIQUE,
            email VARCHAR(255) UNIQUE NOT NULL,
            password VARCHAR(255) NOT NULL,
            full_name VARCHAR(255) NOT NULL,
            role TEXT CHECK(role IN ('student', 'nurse', 'admin')) DEFAULT 'student',
            phone VARCHAR(20),
            emergency_contact VARCHAR(255),
            allergies TEXT,
            medical_history TEXT,
            is_active BOOLEAN DEFAULT 0, -- Changed to 0 (false) by default
            is_verified BOOLEAN DEFAULT 0, -- New field for email verification
            verification_token TEXT, -- New field for verification token
            verification_expires DATETIME, -- New field for token expiration
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`,
        
        `CREATE TABLE IF NOT EXISTS clinic_settings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            opening_time TIME DEFAULT '09:00',
            closing_time TIME DEFAULT '17:00',
            appointment_duration INTEGER DEFAULT 30,
            max_appointments_per_day INTEGER DEFAULT 20
        )`,
        
        `CREATE TABLE IF NOT EXISTS services (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name VARCHAR(255) NOT NULL,
            description TEXT,
            is_active BOOLEAN DEFAULT 1
        )`,
        
        `CREATE TABLE IF NOT EXISTS appointments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_id INTEGER NOT NULL,
            nurse_id INTEGER,
            service_id INTEGER,
            appointment_date DATE NOT NULL,
            appointment_time TIME NOT NULL,
            status TEXT DEFAULT 'scheduled',
            notes TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (student_id) REFERENCES users (id),
            FOREIGN KEY (nurse_id) REFERENCES users (id),
            FOREIGN KEY (service_id) REFERENCES services (id)
        )`,
        
        `CREATE TABLE IF NOT EXISTS medical_records (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_id INTEGER NOT NULL,
            nurse_id INTEGER NOT NULL,
            appointment_id INTEGER,
            consultation_notes TEXT,
            diagnosis TEXT,
            symptoms TEXT,
            treatment TEXT,
            record_date DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (student_id) REFERENCES users (id),
            FOREIGN KEY (nurse_id) REFERENCES users (id),
            FOREIGN KEY (appointment_id) REFERENCES appointments (id)
        )`,
        
        `CREATE TABLE IF NOT EXISTS prescriptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_id INTEGER NOT NULL,
            nurse_id INTEGER NOT NULL,
            medication_name VARCHAR(255) NOT NULL,
            dosage VARCHAR(100),
            instructions TEXT,
            prescribed_date DATETIME DEFAULT CURRENT_TIMESTAMP,
            is_active BOOLEAN DEFAULT 1,
            FOREIGN KEY (student_id) REFERENCES users (id),
            FOREIGN KEY (nurse_id) REFERENCES users (id)
        )`
    ];

    // Create tables sequentially
    let currentTable = 0;
    
    function createNextTable() {
        if (currentTable >= tables.length) {
            console.log('All tables created successfully');
            initializeDefaultData();
            return;
        }
        
        db.run(tables[currentTable], function(err) {
            if (err) {
                console.error(`Error creating table ${currentTable + 1}:`, err.message);
            } else {
                console.log(`Table ${currentTable + 1} created/verified`);
            }
            currentTable++;
            createNextTable();
        });
    }
    
    createNextTable();
}

function initializeDefaultData() {
    console.log('Initializing default data...');
    
    // Insert default admin user with better error handling
    db.get("SELECT COUNT(*) as count FROM users WHERE role = 'admin'", (err, row) => {
        if (err) {
            console.error('Error checking admin users:', err.message);
            // Continue to create admin user anyway
            createAdminUser();
        } else {
            const count = row ? row.count : 0;
            if (count === 0) {
                createAdminUser();
            } else {
                console.log('Admin user already exists');
            }
        }
    });

    // Insert default clinic settings
    db.get("SELECT COUNT(*) as count FROM clinic_settings", (err, row) => {
        if (err) {
            console.error('Error checking clinic settings:', err.message);
            createClinicSettings();
        } else {
            const count = row ? row.count : 0;
            if (count === 0) {
                createClinicSettings();
            } else {
                console.log('Clinic settings already exist');
            }
        }
    });

    // Insert default services
    db.get("SELECT COUNT(*) as count FROM services", (err, row) => {
        if (err) {
            console.error('Error checking services:', err.message);
            createDefaultServices();
        } else {
            const count = row ? row.count : 0;
            if (count === 0) {
                createDefaultServices();
            } else {
                console.log('Default services already exist');
            }
        }
    });
}

function createAdminUser() {
    const defaultPassword = crypto.createHash('md5').update('admin123').digest('hex');
    db.run(`INSERT INTO users (email, password, full_name, role, is_verified, is_active) 
           VALUES (?, ?, ?, ?, 1, 1)`, 
           ['admin@clinic.edu', defaultPassword, 'System Administrator', 'admin'],
           function(err) {
        if (err) {
            console.error('Error creating admin user:', err.message);
        } else {
            console.log('Default admin user created successfully');
            console.log('Admin login: admin@clinic.edu / admin123');
        }
    });
}

function createClinicSettings() {
    db.run(`INSERT INTO clinic_settings (opening_time, closing_time, appointment_duration, max_appointments_per_day) 
           VALUES (?, ?, ?, ?)`, 
           ['09:00', '17:00', 30, 20],
           function(err) {
        if (err) {
            console.error('Error creating clinic settings:', err.message);
        } else {
            console.log('Default clinic settings created');
        }
    });
}

function createDefaultServices() {
    const defaultServices = [
        ['General Consultation', 'Routine health checkup'],
        ['First Aid', 'Minor injury treatment'],
        ['Vaccination', 'Immunization services'],
        ['Health Counseling', 'Mental health support']
    ];
    
    let inserted = 0;
    defaultServices.forEach((service, index) => {
        db.run(`INSERT INTO services (name, description) VALUES (?, ?)`, service,
            function(err) {
                if (err) {
                    console.error(`Error creating service ${service[0]}:`, err.message);
                } else {
                    inserted++;
                }
                
                if (index === defaultServices.length - 1) {
                    console.log(`Created ${inserted} default services`);
                }
            }
        );
    });
}

// Handle database errors
db.on('error', (err) => {
    console.error('Database error:', err);
});

module.exports = db;