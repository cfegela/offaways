# Offaways — Filing Management

Serverless filing management with Lambda (Node 20), Aurora Serverless v2 PostgreSQL, Cognito auth, and a vanilla-JS frontend on CloudFront.

---

## Local Development

### Prerequisites
- Docker + Docker Compose
- Node 20 (for running scripts outside Docker)

### Start

```bash
docker compose up --build
```

| Service  | URL                           |
|----------|-------------------------------|
| Frontend | http://localhost:8080         |
| API      | http://localhost:3000         |
| Postgres | localhost:5432 (offaways/offaways_dev) |

The database schema is applied automatically on first run via the Docker volume mount.

### Create an admin user (local)

```bash
cd backend
npm install
node scripts/create-admin.js admin@example.com password123
```

Then sign in at http://localhost:8080/login.html.

---

## Project Structure

```
offaways/
├── docker-compose.yml
├── nginx.conf
├── backend/
│   ├── serverless.yml          # AWS infrastructure + Lambda functions
│   ├── package.json
│   ├── Dockerfile.local
│   ├── .env.local              # Local env vars (gitignored)
│   ├── scripts/
│   │   └── create-admin.js
│   └── src/
│       ├── local.js            # Express server (local dev entry point)
│       ├── handlers/
│       │   ├── filings.js      # CRUD for filings
│       │   ├── users.js        # Admin user management
│       │   ├── auth.js         # Login (local dev only)
│       │   └── cognito-config.js
│       ├── db/
│       │   ├── client.js
│       │   └── schema.sql
│       └── utils/
│           ├── auth.js
│           └── response.js
└── frontend/
    ├── login.html
    ├── index.html              # Filings
    ├── filing.html             # Filing detail / edit
    ├── admin.html              # Admin panel
    ├── user.html               # Create / edit user
    ├── css/styles.css
    └── js/
        ├── config.js           # Auto-detects local vs prod
        ├── auth.js             # Local JWT or Cognito
        ├── api.js              # Fetch wrapper
        ├── login.js
        ├── app.js
        ├── filing.js
        ├── admin.js
        └── user.js
```

---

## API Endpoints

| Method | Path                             | Auth     | Description                        |
|--------|----------------------------------|----------|------------------------------------|
| POST   | /auth/login                      | None     | Local dev login                    |
| GET    | /filings                         | User     | List own (all for admin)           |
| POST   | /filings                         | User     | Create filing                      |
| GET    | /filings/:id                     | User     | Get filing                         |
| PUT    | /filings/:id                     | User     | Update filing                      |
| DELETE | /filings/:id                     | User     | Delete filing                      |
| GET    | /admin/users                     | Admin    | List all users                     |
| POST   | /admin/users                     | Admin    | Create user                        |
| GET    | /admin/users/:id                 | Admin    | Get user                           |
| PUT    | /admin/users/:id                 | Admin    | Update user                        |
| DELETE | /admin/users/:id                 | Admin    | Delete user                        |
| GET    | /config                          | None     | Cognito config (prod)              |

---

## AWS Deployment

### Prerequisites

1. AWS CLI configured with appropriate credentials
2. Serverless Framework v3: `npm install -g serverless@3`

### 1. Store the DB password in SSM

```bash
aws ssm put-parameter \
  --name /offaways/dev/db-password \
  --value "your_secure_password" \
  --type SecureString \
  --region us-east-1
```

### 2. Fill in your VPC details

Edit `backend/serverless.yml` and replace:
- `vpc-REPLACE_WITH_YOUR_VPC_ID` → your VPC ID
- `subnet-REPLACE_ME_1` / `subnet-REPLACE_ME_2` → private subnet IDs (in two AZs)

### 3. Deploy

```bash
cd backend
npm install
npx serverless deploy --stage dev
```

The deploy outputs:
- `ApiGatewayUrl`
- `CloudFrontUrl`
- `CognitoUserPoolId`
- `CognitoClientId`

### 4. Run the DB migration on Aurora

After first deploy, connect to Aurora via the bastion or RDS Query Editor and run `backend/src/db/schema.sql`.

### 5. Create the first admin (production)

Invite the user via Cognito console (or `aws cognito-idp admin-create-user`), then:

```bash
cd backend
COGNITO_USER_POOL_ID=us-east-1_XXXXX \
STAGE=dev \
node scripts/create-admin.js admin@example.com
```

### 6. Deploy the frontend

```bash
# Upload frontend files to S3
BUCKET=$(aws cloudformation describe-stacks \
  --stack-name offaways-dev \
  --query "Stacks[0].Outputs[?OutputKey=='FrontendBucketName'].OutputValue" \
  --output text)

aws s3 sync frontend/ s3://$BUCKET/ --delete

# Invalidate CloudFront cache
DIST_ID=$(aws cloudformation describe-stacks \
  --stack-name offaways-dev \
  --query "Stacks[0].Outputs[?OutputKey=='CloudFrontDistributionId'].OutputValue" \
  --output text)

aws cloudfront create-invalidation --distribution-id $DIST_ID --paths "/*"
```

---

## Auth Flow

### Local dev
- `POST /auth/login` → verifies bcrypt hash, returns JWT
- JWT payload includes `sub` (DB UUID), `email`, `role`, and `cognito:groups` (for compatibility)

### Production
- Cognito Hosted UI or `amazon-cognito-identity-js` on the login page
- API Gateway validates the Cognito ID token before invoking Lambda
- Lambda reads claims from `event.requestContext.authorizer.claims`
- Admin check uses `cognito:groups` claim (`["Admins"]`)

---

## Environment Variables

| Variable              | Local | Lambda | Description                        |
|-----------------------|-------|--------|------------------------------------|
| `NODE_ENV`            | local | dev/prod | Controls auth strategy           |
| `DB_HOST`             | ✓     | ✓      | PostgreSQL host                    |
| `DB_PORT`             | ✓     | ✓      | PostgreSQL port                    |
| `DB_NAME`             | ✓     | ✓      | Database name                      |
| `DB_USER`             | ✓     | ✓      | Database user                      |
| `DB_PASSWORD`         | ✓     | SSM    | Database password                  |
| `JWT_SECRET`          | ✓     | —      | Local JWT signing secret           |
| `COGNITO_USER_POOL_ID`| —     | ✓      | Cognito User Pool ID               |
| `COGNITO_REGION`      | —     | ✓      | AWS region for Cognito             |
| `CORS_ORIGIN`         | ✓     | ✓      | Allowed CORS origin                |
