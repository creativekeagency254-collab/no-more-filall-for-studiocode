# Quick Start - Authentication System

## Ready to Use Now

Your authentication system is **fully functional** for email/password login. Google OAuth requires a one-time setup in Supabase.

## Run Localhost First

From `project/`:

```bash
npm install
npm run dev
```

Open:

```txt
http://localhost:3000/landing_page.html
```

## Test It Right Now (2 Minutes)

### 1. Open the Landing Page
Open `http://localhost:3000/landing_page.html` in your browser

### 2. Create an Account
1. Click "Join Network" or "Client Area" button
2. In the modal, click "Sign Up" tab
3. Enter:
   - First Name: Test
   - Last Name: User
   - Email: test@example.com
   - Password: TestPass123!
4. Click "Create Account"

### 3. You're In!
You'll automatically be redirected to the client dashboard

### 4. Test Sign Out
Click the sign out button in the dashboard

### 5. Test Login
1. Click "Client Area" on landing page
2. Enter your credentials
3. You're back in the dashboard

## Add Google OAuth (5 Minutes)

### Step 1: Open Supabase
Go to your Supabase project: https://supabase.com/dashboard/project/smdbfaomeghoejqqkplv

### Step 2: Enable Google
1. Click **Authentication** in sidebar
2. Click **Providers**
3. Find **Google** in the list
4. Toggle it **ON**

### Step 3: Add Credentials
Paste your Google OAuth values:
- **Client ID**: from Google Cloud Console
- **Client Secret**: from Google Cloud Console

### Step 4: Save
Click **Save** button

### Step 5: Configure Google Console
1. Go to https://console.cloud.google.com/
2. Select your project
3. Go to **APIs & Services** → **Credentials**
4. Click your OAuth 2.0 Client ID
5. Under **Authorized redirect URIs**, add:
   ```
   https://smdbfaomeghoejqqkplv.supabase.co/auth/v1/callback
   ```
6. Click **Save**

### Step 6: Test It
1. Open landing page
2. Click any auth button
3. Click "Continue with Google"
4. Sign in with Google
5. Done!

## Change User Roles

### Make Someone an Admin
1. Go to Supabase project
2. Click **Table Editor** → **profiles**
3. Find the user's row
4. Change **role** column from `client` to `admin`
5. User must sign out and back in to see admin dashboard

Available roles:
- `client` - Client dashboard (default)
- `developer` - Developer dashboard
- `commissioner` - Sales dashboard
- `admin` - Admin dashboard

## Where Everything Is

### Use These Pages
- `landing_page.html` - Main page with login/signup
- `client_dashboard.html` - Client dashboard
- `developer_dashboard.html` - Developer dashboard
- `sales_dashboard.html` - Commissioner dashboard
- `admin_dashboard.html` - Admin dashboard

### Read These If You Need Help
- `README_AUTH.md` - Full overview
- `TESTING_GUIDE.md` - How to test everything
- `GOOGLE_OAUTH_SETUP.md` - Detailed Google setup
- `AUTH_SETUP_COMPLETE.md` - What was implemented

## What Works

- Login with email/password
- Signup with email/password
- Google OAuth (after setup)
- Automatic redirect to correct dashboard
- Dashboard protection (can't access without login)
- Role-based access control
- Sign out from any dashboard
- Session persistence (stay logged in)
- Password strength indicator
- Form validation

## That's It!

Your authentication system is ready. Email/password works immediately. Google OAuth takes 5 minutes to configure.

**Need help?** Check `TESTING_GUIDE.md` for troubleshooting.
