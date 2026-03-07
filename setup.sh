#!/bin/bash
# Infusion100 Setup Script
# Run this to set up the environment on a fresh Linux/macOS machine

set -e

echo "=== Infusion100 Setup ==="
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
  echo "Node.js is not installed. Installing via nvm..."
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
  export NVM_DIR="$HOME/.nvm"
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
  nvm install 20
  nvm use 20
fi
echo "Node.js version: $(node --version)"

# Check PostgreSQL
if ! command -v psql &> /dev/null; then
  echo ""
  echo "PostgreSQL is not installed."
  echo "Please install PostgreSQL:"
  echo "  macOS: brew install postgresql@16 && brew services start postgresql@16"
  echo "  Ubuntu: sudo apt install postgresql postgresql-contrib && sudo systemctl start postgresql"
  exit 1
fi
echo "PostgreSQL: $(psql --version)"

# Create database if it doesn't exist
echo ""
echo "Creating database 'infusion100'..."
createdb infusion100 2>/dev/null && echo "Database created." || echo "Database already exists."

# Install dependencies
echo ""
echo "Installing npm dependencies..."
npm install

# Create .env if it doesn't exist
if [ ! -f .env ]; then
  echo ""
  echo "Creating .env file from template..."
  cp .env.example .env
  # Generate random secrets
  SESSION_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(16).toString('hex'))")
  sed -i.bak "s/your_random_secret_here/$SESSION_SECRET/" .env
  sed -i.bak "s/your_32_char_random_key_here/$ENCRYPTION_KEY/" .env
  rm -f .env.bak
  echo ".env created. Please update it with your OAuth credentials."
fi

# Apply database schema
# Alternative: npm run db:init (uses DATABASE_URL from .env, no psql needed)
echo ""
echo "Applying database schema..."
psql -d infusion100 -f db/schema.sql

# Seed bridges
echo "Seeding London bridges data..."
psql -d infusion100 -f db/seed-bridges.sql

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Next steps:"
echo "  1. Edit .env with your OAuth credentials (Google, Apple, Strava)"
echo "  2. Run: npm start"
echo "  3. Visit: http://localhost:3000"
echo ""
