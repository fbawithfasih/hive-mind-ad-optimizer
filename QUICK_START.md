# 🚀 AMAIOP Quick Start Guide

Welcome to the AMAIOP (Amazon Multi-tenant AI Optimizer Platform) project! This guide will get you up and running in minutes.

---

## 1️⃣ Prerequisites

- **Node.js** 18+ ([download](https://nodejs.org/))
- **PostgreSQL** 12+ OR **Docker** ([download Docker](https://www.docker.com/))
- **npm** (comes with Node.js)

---

## 2️⃣ Setup PostgreSQL Database

### Option A: Quick Start with Docker (Recommended)

```bash
# Start PostgreSQL in Docker
docker run --name amaiop-db \
  -e POSTGRES_PASSWORD=password \
  -e POSTGRES_DB=amaiop_dev \
  -d \
  -p 5432:5432 \
  postgres:latest

# Verify it's running
docker ps | grep amaiop-db
```

### Option B: Local PostgreSQL Installation

See `DATABASE_SETUP.md` for detailed installation instructions for your OS.

---

## 3️⃣ Install Dependencies

```bash
cd /Users/fasihuddinahmer/Projects/AMAIOP

# Install all dependencies
npm install

# Generate Prisma Client
npm run prisma:generate
```

---

## 4️⃣ Initialize Database

```bash
# Create database schema and run migrations
npm run prisma:migrate

# When prompted, name your first migration: "init"
# This creates all 20 tables automatically
```

---

## 5️⃣ Verify Setup

```bash
# Open Prisma Studio (visual database explorer)
npm run prisma:studio
```

Visit http://localhost:5555 - you should see all your database tables!

---

## 6️⃣ Start Development Server

```bash
# Terminal 1: Backend
npm run dev
# Backend runs on http://localhost:3000

# Terminal 2: Frontend (in another terminal)
cd frontend
npm run dev
# Frontend runs on http://localhost:5173
```

---

## 📋 What You Have Now

✅ **Multi-tenant Database** - Ready for 5-10 beta customers
✅ **Encryption** - Amazon tokens stored securely (AES-256-GCM)
✅ **Password Hashing** - bcryptjs with 12 salt rounds
✅ **Audit Logging** - Track who did what and when
✅ **Billing Ready** - Subscription table for Stripe integration

---

## 🔑 Environment Variables

All environment variables are configured in `.env`:

```env
DATABASE_URL=postgresql://postgres:password@localhost:5432/amaiop_dev
SESSION_SECRET=your_super_secret_jwt_key_change_this_min_32_chars
ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
NODE_ENV=development
FRONTEND_URL=http://localhost:5173
```

✏️ **Important**: Update `SESSION_SECRET` and `ENCRYPTION_KEY` with secure random values:

```bash
# Generate secure SESSION_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Generate ENCRYPTION_KEY (same command, use different values)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## 📚 Documentation

- **`DATABASE_SETUP.md`** - Detailed database configuration
- **`PHASE_1_1_SUMMARY.md`** - What was built in Phase 1.1
- **`prisma/schema.prisma`** - Full database schema

---

## ✅ Useful Commands

```bash
# Generate Prisma Client (after schema changes)
npm run prisma:generate

# Create new migration
npm run prisma:migrate

# View database visually
npm run prisma:studio

# Reset database (dev only - deletes all data!)
npm run prisma:reset

# Run tests
npm test

# Run tests in watch mode
npm test:watch
```

---

## 🐛 Troubleshooting

### "Connection refused" Error
- Ensure PostgreSQL is running: `docker ps | grep amaiop-db`
- Check connection string in `.env`
- Verify username/password is correct

### "Prisma Client not found"
```bash
npm run prisma:generate
```

### "Migration Failed"
- Check PostgreSQL logs: `docker logs amaiop-db`
- Ensure database exists: `docker exec amaiop-db psql -U postgres -c "\\l"`
- Review migration file: `ls prisma/migrations/`

See `DATABASE_SETUP.md` for more troubleshooting.

---

## 🎯 What's Next?

### Phase 1.2: Authentication (2-3 weeks)
- Implement user signup/login
- Replace hardcoded JWT with database auth
- Add password reset flow

### Phase 1.3: Tenant Isolation (1 week)
- Implement multi-tenant middleware
- Ensure org_id validation on all routes
- Add audit logging middleware

See the comprehensive 6-month plan: `/plan file`

---

## 🚀 Ready?

1. ✅ Set up PostgreSQL
2. ✅ Run `npm install && npm run prisma:migrate`
3. ✅ Run `npm run dev` to start the backend
4. ✅ Check `http://localhost:3000/health` → should return `{"status":"ok"}`
5. 🎉 You're ready to start Phase 1.2!

---

## 📞 Need Help?

Check the documentation in this order:
1. `QUICK_START.md` (this file) - For basic setup
2. `DATABASE_SETUP.md` - For database-specific issues
3. `PHASE_1_1_SUMMARY.md` - For what was built

---

**Status**: Phase 1.1 Complete ✅
**Next**: Phase 1.2 - Authentication & Authorization
**Timeline**: 6-month roadmap to full multi-tenant SaaS platform

Let's build something amazing! 🚀
