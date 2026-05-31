# Three-Factor Authentication Service

A complete three-factor authentication implementation featuring:
- **WebAuthn** (Biometric / Hardware Key - Touch ID, Face ID, YubiKey, etc.)
- **TOTP** (Time-based One-Time Password - Google Authenticator, Authy, etc.)
- **Backup Codes** (10 one-time recovery codes)

## Architecture

```
├── backend/          # Node.js + Express + PostgreSQL
└── frontend/         # React application
```

## Prerequisites

1. **Node.js** (v16 or higher)
2. **PostgreSQL** (v12 or higher)
3. **npm** or **yarn**

## Database Setup

1. Create a PostgreSQL database:

```sql
CREATE DATABASE mfa_auth;
```

2. Configure your database credentials in `backend/.env`

## Backend Setup

1. Navigate to the backend directory:

```bash
cd backend
```

2. Install dependencies:

```bash
npm install
```

3. Initialize the database:

```bash
npm run init-db
```

4. Start the backend server:

```bash
npm run dev
```

The backend will run on `http://localhost:3001`

## Frontend Setup

1. Open a new terminal and navigate to the frontend directory:

```bash
cd frontend
```

2. Install dependencies:

```bash
npm install
```

3. Start the React development server:

```bash
npm start
```

The frontend will run on `http://localhost:3000`

## Features

### 1. User Registration
- Email and password registration
- Passwords are hashed using bcrypt

### 2. WebAuthn (FIDO2)
- Register biometric devices (Touch ID, Face ID, Windows Hello)
- Register hardware security keys (YubiKey)
- Multiple devices per user supported

### 3. TOTP (Authenticator App)
- QR code setup for easy configuration
- Works with Google Authenticator, Authy, 1Password, etc.
- TOTP secrets are encrypted in the database

### 4. Backup Codes
- 10 one-time backup codes generated
- SHA-256 hashed storage (never stored in plaintext)
- Codes are marked as used after consumption

### 5. Authentication Flow
1. User enters email and password
2. If MFA is enabled, user selects from available methods
3. After successful MFA verification, JWT token is issued

## API Endpoints

### Auth
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login with email/password
- `GET /api/auth/me` - Get user profile (JWT required)

### WebAuthn
- `POST /api/webauthn/register/options` - Get registration options
- `POST /api/webauthn/register/verify` - Verify registration
- `POST /api/webauthn/auth/options` - Get authentication options
- `POST /api/webauthn/auth/verify` - Verify authentication
- `GET /api/webauthn/credentials` - List registered credentials
- `DELETE /api/webauthn/credentials/:id` - Remove credential

### TOTP
- `GET /api/totp/setup` - Get TOTP setup QR code
- `POST /api/totp/verify-setup` - Verify and enable TOTP
- `POST /api/totp/disable` - Disable TOTP
- `POST /api/totp/auth` - Authenticate with TOTP

### Backup Codes
- `GET /api/backup/generate` - Generate backup codes
- `GET /api/backup/list` - List backup code status
- `POST /api/backup/disable` - Disable backup codes
- `POST /api/backup/auth` - Authenticate with backup code

### Policies
- `GET /api/policies/conditions` - Get available condition types
- `GET /api/policies` - Get all policies for user
- `POST /api/policies` - Create new policy
- `PUT /api/policies/:id` - Update policy
- `DELETE /api/policies/:id` - Delete policy
- `POST /api/policies/:id/set-default` - Set policy as default
- `POST /api/policies/init-default` - Initialize default policies
- `GET /api/policies/devices` - Get user devices
- `PUT /api/policies/devices/:fingerprint/trust` - Mark device as trusted
- `PUT /api/policies/devices/:fingerprint/name` - Update device name
- `DELETE /api/policies/devices/:fingerprint` - Delete device
- `GET /api/policies/logs` - Get authentication logs

## Security Features

- **Password hashing**: bcrypt with 10 rounds
- **TOTP encryption**: AES-256-CBC for stored secrets
- **Backup codes**: SHA-256 hashed, one-time use
- **JWT**: Signed tokens for session management
- **CORS**: Configured for secure cross-origin requests

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Backend server port | 3001 |
| `DB_HOST` | PostgreSQL host | localhost |
| `DB_PORT` | PostgreSQL port | 5432 |
| `DB_NAME` | Database name | mfa_auth |
| `DB_USER` | Database user | postgres |
| `DB_PASSWORD` | Database password | postgres |
| `JWT_SECRET` | JWT signing secret | - |
| `JWT_EXPIRES_IN` | Token expiration | 24h |
| `ENCRYPTION_KEY` | 32-byte encryption key | - |
| `RP_NAME` | WebAuthn relying party name | MFA Auth Service |
| `RP_ID` | WebAuthn relying party ID | localhost |
| `ORIGIN` | Frontend origin | http://localhost:3000 |

## Important Notes for WebAuthn

1. WebAuthn requires a secure context (HTTPS) except for localhost
2. The RP_ID must match the domain where the app is served
3. For production, you must use HTTPS

## Browser Support

WebAuthn is supported in:
- Chrome 67+
- Firefox 60+
- Safari 13+
- Edge 79+
- Mobile Safari 13+ (iOS)
- Chrome Mobile 70+ (Android)
