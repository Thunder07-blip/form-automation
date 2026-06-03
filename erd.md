# Google Forms Auto-Fill Extension - ERD

## Overview

This database supports:

* Google Sign-In authentication
* Student demographic collection
* User activity tracking
* Form auto-fill analytics
* Question-solving statistics
* Future recommendation and advertising systems

---

# Entity Relationship Diagram

```text
┌─────────────────────┐
│        Users        │
└─────────────────────┘
           │
           │ 1
           │
           ▼
┌─────────────────────┐
│      FormUsage      │
└─────────────────────┘

Users (1) --------< FormUsage (Many)
```

---

# Users Table

Stores student profile information.

| Field             | Type             | Description                      |
| ----------------- | ---------------- | -------------------------------- |
| user_id           | UUID / BIGINT PK | Internal user ID                 |
| email             | VARCHAR UNIQUE   | Google account email             |
| name              | VARCHAR          | Student name                     |
| gender            | ENUM             | Male / Female / Other            |
| college           | VARCHAR          | College name                     |
| branch            | VARCHAR          | Branch / Department              |
| year              | INTEGER          | Academic year                    |
| created_at        | TIMESTAMP        | Account creation time            |
| last_login_at     | TIMESTAMP        | Last successful login            |
| consent_analytics | BOOLEAN          | Analytics consent                |
| consent_marketing | BOOLEAN          | Recommendation/marketing consent |

---

# FormUsage Table

Stores every use of the auto-fill feature.

| Field              | Type               | Description                            |
| ------------------ | ------------------ | -------------------------------------- |
| usage_id           | UUID PK            | Usage record ID                        |
| user_id            | FK → Users.user_id | User                                   |
| timestamp          | TIMESTAMP          | Time feature was used                  |
| time_taken_seconds | INTEGER            | Time taken to complete                 |
| questions_detected | INTEGER            | Questions found in form                |
| questions_filled   | INTEGER            | Questions successfully answered        |
| success            | BOOLEAN            | Whether filling completed successfully |

---

# Relationships

## Users → FormUsage

One user may use the extension many times.

```text
User
 ├── Usage 1
 ├── Usage 2
 ├── Usage 3
 └── Usage N
```

---

# Login Flow

```text
User
 ↓
Sign in with Google
 ↓
Google OAuth
 ↓
Email + Name received
 ↓
Backend verifies token
 ↓
Check Users table
 ↓
Create user if first login
 ↓
Update last_login_at
 ↓
Allow access
```

---

# Analytics Supported

## User Analytics

* Total Users
* Active Users
* Daily Active Users (DAU)
* Monthly Active Users (MAU)

---

## Demographic Analytics

* Users by College
* Users by Branch
* Users by Academic Year
* Gender Distribution

---

## Usage Analytics

* Total Forms Processed
* Average Questions Solved
* Average Time Saved
* Most Active Users

---

## Question Analytics

* Total Questions Solved
* Questions Solved per User
* Questions Solved per College
* Questions Solved per Branch

---

# Recommended Indexes

```sql
CREATE UNIQUE INDEX idx_users_email
ON Users(email);

CREATE INDEX idx_users_college
ON Users(college);

CREATE INDEX idx_users_branch
ON Users(branch);

CREATE INDEX idx_usage_user
ON FormUsage(user_id);

CREATE INDEX idx_usage_timestamp
ON FormUsage(timestamp);
```

---

# Final Architecture

```text
Google Login
      │
      ▼
    Users
      │
      ▼
  FormUsage
```

This design is intentionally minimal, easy to implement, and sufficient for an MVP serving college students using a Google Forms auto-fill extension.
