# Database Setup Guide for AMAIOP

This guide explains how to set up the PostgreSQL database and Prisma ORM for the AMAIOP multi-tenant SaaS platform.

## Prerequisites

- Node.js 18+ installed
- PostgreSQL 12+ installed locally OR Docker
- npm or yarn package manager

## Option 1: Local PostgreSQL Installation

### macOS (using Homebrew)
```bash
brew install postgresql
brew services start postgresql
createdb amaiop_dev
```

### Ubuntu/Debian
```bash
sudo apt-get install postgresql postgresql-contrib
sudo -u postgres createdb amaiop_dev
```

### Windows
Download and install PostgreSQL from https://www.postgresql.org/download/windows/

Then create the database:
```bash
psql -U postgres -c "CREATE DATABASE amaiop_dev;"
```

## Option 2: Docker (Recommended for Development)

If you have Docker installed, run:

```bash
docker run --name amaiop-db \
  -e POSTGRES_PASSWORD=password \
  -e POSTGRES_DB=amaiop_dev \
  -d \
  -p 5432:5432 \
  postgres:latest
```

Verify the database is running:
```bash
docker ps | grep amaiop-db
```

## Configuration

1. **Update .env file** with your database connection string:

```env
# For local PostgreSQL:
DATABASE_URL="postgresql://postgres:password@localhost:5432/amaiop_dev"

# For Docker:
DATABASE_URL="postgresql://postgres:password@localhost:5432/amaiop_dev"

# Encryption key (generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
ENCRYPTION_KEY="<your_32_byte_hex_string>"

# JWT Session secret
SESSION_SECRET="<your_random_secret_min_32_chars>"
```

2. **Generate Prisma Client**:

```bash
npm run prisma:generate
```

## Initial Migration

Create the initial database schema:

```bash
npm run prisma:migrate
```

This will:
1. Create the migration file (e.g., `001_init`)
2. Run the migration against your database
3. Generate Prisma Client types

## Database Schema

The database includes the following tables for multi-tenancy:

### Core Tables
- **users** - User accounts with authentication
- **organizations** - Tenant organizations
- **org_members** - Organization membership and roles
- **amazon_credentials** - Encrypted Amazon API credentials per org
- **seller_profiles** - Amazon seller profiles per organization

### Listing Optimization
- **listing_optimizations** - History of AI-optimized listings

### Analytics & Reporting
- **report_jobs** - Async report generation jobs
- **usage_metrics** - Monthly usage tracking per organization

### Billing & Subscriptions
- **subscriptions** - Stripe subscription data
- **invoices** - Invoice records
- **audit_logs** - Action audit trail

### Security
- **audit_logs** - Who did what and when
- **api_keys** - API keys for integrations

## Useful Commands

### View Database in Studio
```bash
npm run prisma:studio
```

Opens http://localhost:5555 with a visual database explorer.

### Reset Database (Development Only!)
```bash
npm run prisma:reset
```

⚠️ **WARNING**: This command will:
1. Delete all data
2. Drop and recreate the database
3. Re-run all migrations
4. Seed initial data (if seed.ts exists)

### Create New Migration
```bash
npm run prisma:migrate
```

Follow the prompts to name your migration (e.g., "add_listings_table").

### Deploy Migrations (Production)
```bash
npm run prisma:migrate:prod
```

This runs pending migrations without creating a new one.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `ENCRYPTION_KEY` | Yes | 32-byte hex string for encrypting tokens |
| `SESSION_SECRET` | Yes | Random string for JWT signing (min 32 chars) |
| `NODE_ENV` | Yes | `development` or `production` |
| `FRONTEND_URL` | Yes | Frontend origin for CORS |

## Connection Pooling (Production)

For production deployments, use connection pooling:

### PgBouncer
```
# In PgBouncer config
[databases]
amaiop = host=<rds-endpoint> port=5432 dbname=amaiop

# In .env
DATABASE_URL="postgresql://user:pass@pgbouncer:6432/amaiop"
```

### AWS RDS with IAM Auth
```bash
# Install AWS CLI
# Use temporary credentials

DATABASE_URL="postgresql://user@endpoint:5432/amaiop?sslmode=require&authSource=AWS"
```

## Backup Strategy

### Automated Daily Backups
```bash
# Create backup
pg_dump amaiop_dev > backups/amaiop_dev_$(date +%Y%m%d_%H%M%S).sql

# Restore backup
psql amaiop_dev < backups/amaiop_dev_20240101_000000.sql
```

### AWS RDS
- Automated backups: 7-35 day retention
- Point-in-time recovery enabled
- Multi-AZ for high availability

## Troubleshooting

### Connection Refused
- Ensure PostgreSQL is running: `sudo systemctl status postgresql`
- Check connection string: `psql postgresql://localhost/amaiop_dev`
- For Docker: `docker ps | grep amaiop-db`

### Migration Fails
- Check existing migrations: `ls prisma/migrations/`
- View Prisma logs: `NODE_DEBUG=* npm run prisma:migrate`
- Reset database (dev only): `npm run prisma:reset`

### Authentication Errors
- Verify PostgreSQL password in .env
- Ensure user has database creation permissions
- For Docker: Check container environment variables

### Encryption Key Issues
- Ensure `ENCRYPTION_KEY` is set in .env
- Key must be 32-byte hex string (64 characters)
- Generate new key: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

## Next Steps

1. ✅ Set up PostgreSQL database
2. ✅ Configure .env with `DATABASE_URL`
3. ✅ Run `npm run prisma:migrate` to create schema
4. ✅ Verify with `npm run prisma:studio`
5. Start building the authentication layer (Phase 1.2)

See MULTI_TENANT_GUIDE.md for implementing multi-tenancy features.
