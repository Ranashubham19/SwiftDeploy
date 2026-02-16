# SwiftDeploy AI - Production Deployment Guide

## Overview
This guide provides detailed instructions for deploying the SwiftDeploy AI application to production environments, specifically focusing on Railway for the backend and Vercel for the frontend.

## Architecture
The application is split into two main components:
- **Backend**: Node.js/Express server handling Telegram bot integration, AI processing, and authentication
- **Frontend**: React/Vite SPA serving the user interface

## Backend Deployment (Railway)

### Prerequisites
- GitHub repository with the code
- Railway account

### Steps
1. Push your code to a GitHub repository
2. Connect your repository to Railway
3. Set the required environment variables in Railway dashboard:

```
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
API_KEY=your_gemini_api_key
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
SESSION_SECRET=your_session_secret
BASE_URL=https://your-railway-app.up.railway.app
NODE_ENV=production
```

4. Railway will automatically detect and build your Node.js application using the package.json
5. The backend will be deployed and accessible at your Railway domain

## Frontend Deployment (Vercel)

### Prerequisites
- GitHub repository with the code
- Vercel account

### Steps
1. Connect your repository to Vercel
2. Configure the build settings:
   - Build Command: `npm run build:frontend`
   - Output Directory: `dist`
   - Root Directory: `.`
3. Set the required environment variables:

```
VITE_API_URL=https://your-railway-backend-domain.up.railway.app
```

4. Vercel will build and deploy your frontend application

## Combined Deployment Process

### 1. Deploy Backend First
- Deploy the backend to Railway first
- Note the Railway domain URL (e.g., `https://your-app.up.railway.app`)

### 2. Configure Frontend Environment
- Set `VITE_API_URL` to your Railway backend URL
- This ensures the frontend communicates with your production backend

### 3. Deploy Frontend
- Deploy the frontend to Vercel with the correct backend URL

### 4. Post-Deployment Setup
- Visit `https://your-frontend-domain.com/set-webhook` to activate the Telegram webhook
- The system will register the webhook with Telegram using your production backend

## Environment Variables Reference

### Backend (Railway)
```
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
API_KEY=your_gemini_api_key
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
SESSION_SECRET=your_session_secret_32_chars_minimum
JWT_SECRET=your_jwt_secret_32_chars_minimum
BASE_URL=https://your-production-domain.com
FRONTEND_URL=https://your-frontend-domain.com
NODE_ENV=production
PORT=3001
```

### Frontend (Vercel)
```
VITE_API_URL=https://your-backend-domain.com
VITE_GOOGLE_CLIENT_ID=your_google_client_id
```

## Webhook Configuration
The system automatically registers webhooks with Telegram using the BASE_URL environment variable. After deployment:

1. Visit `https://your-backend-domain.com/set-webhook` to register the webhook
2. The system will communicate with Telegram API to set up the webhook endpoint
3. Telegram will start sending updates to your production endpoint

## Security Considerations
- Keep all API keys and secrets secure
- Use strong session secrets (minimum 32 characters)
- Enable HTTPS in production
- Regularly rotate secrets and API keys
- Monitor logs for unauthorized access attempts

## Troubleshooting
- If webhook registration fails, verify your BASE_URL is accessible to Telegram
- Check CORS settings if frontend-backend communication fails
- Ensure all required environment variables are set in production
- Review logs in Railway/Vercel dashboards for error details