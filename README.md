
# SwiftDeploy AI — Production Deployment Guide

This guide will help you deploy your AI bot for global production use.

## 🚀 1. Local Development Setup

To develop and test your bot locally:

1.  **Install dependencies**:
    ```bash
    npm install
    cd backend && npm install
    ```
2.  **Setup Environment**:
    Create a `.env.local` file in the root directory with your local configuration:
    ```env
    # Local development settings
    NODE_ENV=development
    BASE_URL=http://localhost:3001
    FRONTEND_URL=http://localhost:3000
    VITE_API_URL=http://localhost:3001
    TELEGRAM_BOT_TOKEN=your_local_bot_token
    GEMINI_API_KEY=your_gemini_api_key
    PORT=3001
    GOOGLE_CLIENT_ID=your_google_client_id
    GOOGLE_CLIENT_SECRET=your_google_client_secret
    SESSION_SECRET=your_session_secret
    ```
3.  **Run Development Servers**:
    ```bash
    npm run dev
    ```
4.  **Test**:
    Access the application at `http://localhost:3000` and test your bot functionality.

## 🌍 2. Production Deployment

### Option A: Railway Deployment (Backend)

1.  **Configure Environment Variables**:
    - Push your code to a GitHub repository
    - Connect your repository to Railway
    - Set the required environment variables in Railway dashboard using the `.env.example` file as reference

2.  **Deployment Configuration**:
    - The `railway.toml` file is already configured for automatic deployment
    - Railway will automatically detect and build your Node.js application

3.  **Post-Deployment**:
    - Once deployed, visit `https://your-production-domain.com/set-webhook` to activate the Telegram webhook
    - Your bot backend will be accessible

### Option B: Vercel Deployment (Frontend)

1.  **Prepare for Frontend Deployment**:
    - Make sure `VITE_API_URL` is set to your backend production URL
    - The `vercel.json` file is configured for static hosting

2.  **Deploy to Vercel**:
    - Connect your repository to Vercel
    - Use the build command: `npm run build:frontend`
    - Output directory: `dist`

3.  **Environment Variables**:
    - Set `VITE_API_URL` to your backend URL (e.g., `https://your-backend-domain.up.railway.app`)

### Option C: Combined Deployment Approach

For a complete setup with frontend on Vercel and backend on Railway:

1.  Deploy the backend first to Railway
2.  Take note of your Railway backend URL
3.  Deploy the frontend to Vercel with `VITE_API_URL` set to your Railway backend URL
4.  The frontend will communicate with the backend via API calls

### Option D: Manual Deployment

1.  **Build the Application**:
    ```bash
    npm run build
    ```
2.  **Set Environment Variables**:
    Configure all required environment variables on your hosting platform
3.  **Start the Application**:
    ```bash
    npm start
    ```

## 🔒 Security
- The `/webhook` endpoint is public, but only Telegram should know the token path.
- All AI processing happens server-side, keeping your API keys secure.
- Session secrets and JWT tokens should be strong and kept confidential.

## 📋 Required Environment Variables
See `.env.example` for a complete list of required environment variables for production deployment.

## Telegram OpenRouter Bot Docs
For the new ChatGPT-style Telegram bot implementation (Telegraf + OpenRouter + Prisma), see:
- `backend/README.md`
