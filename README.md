# UMP Clinic Web App

Clinic booking and management system for University of Mpumalanga students. Students register, verify their email and book clinic visits. Nurses manage the patient queue and consultations. Admins manage users, services and clinic settings.

Live demo: https://clinic-ten-zeta.vercel.app

## Team project

Built as a student team project with Theophilus Thobejane. The original repository is [TheoInCodeLand/clinic__](https://github.com/TheoInCodeLand/clinic__).

My part:

- Student dashboards (dashboard, book appointment, my appointments, medical records, profile)
- Backend database logic
- Email verification feature (contributed)

## Features

- Three roles: student, nurse and admin, each with its own dashboard
- Email verification on sign-up, with resend option
- Appointment booking with clinic opening hours and daily limits
- Automatic appointment reminder emails
- Nurse patient queue, consultations and student history
- Admin user management, services and clinic settings

## Tech stack

Node.js, Express, EJS, SQLite, bcrypt, Nodemailer, node-cron

## Project structure

```
app.js              Express app, sessions and route setup
database/db.js      SQLite connection, tables and default data
routes/             auth, students, nurses, admin and public routes
services/           email and reminder services
views/              EJS pages for each role, plus shared partials
public/             CSS and client-side JavaScript
```

## Run locally

1. Install Node.js 18 or later.
2. Install dependencies: `npm install`
3. Copy `.env.example` to `.env` and fill in the values. Email features need a Gmail address and a Gmail app password.
4. Start the app: `npm start`
5. Open http://localhost:3000

The database file is created automatically on first run.
