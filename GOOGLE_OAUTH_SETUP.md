# Google OAuth Setup Instructions

## Google OAuth Credentials
- **Client ID**: Your Google OAuth Web Client ID
- **Client Secret**: Your Google OAuth Web Client Secret

## Configure in Supabase Dashboard

### Step 1: Access Authentication Settings
1. Go to your Supabase project dashboard
2. Navigate to **Authentication** → **Providers**
3. Find **Google** in the list of providers

### Step 2: Enable Google Provider
1. Toggle **Enable Sign in with Google** to ON
2. Enter your Google OAuth credentials:
   - **Client ID**: from Google Cloud Console
   - **Client Secret**: from Google Cloud Console
3. Click **Save**

### Step 3: Configure Redirect URLs in Google Console
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Select your project
3. Navigate to **APIs & Services** → **Credentials**
4. Click on your OAuth 2.0 Client ID
5. Add these Authorized Redirect URIs:
   ```
   https://smdbfaomeghoejqqkplv.supabase.co/auth/v1/callback
   http://localhost:3000/auth/v1/callback
   ```
   If you run the app on a different local port, update the localhost URI to match it.
6. Save changes

### Step 4: Verify Configuration
1. The application will automatically redirect users to the correct dashboard based on their role:
   - **client** → `client_dashboard.html`
   - **developer** → `developer_dashboard.html`
   - **commissioner** → `sales_dashboard.html`
   - **admin** → `admin_dashboard.html`

2. All new signups default to the 'client' role
3. To change user roles, update the `profiles` table directly:
   ```sql
   UPDATE public.profiles
   SET role = 'admin'
   WHERE email = 'user@example.com';
   ```

## How It Works

### Landing Page
- Users can sign up or log in using email/password or Google OAuth
- The auth modal is triggered by clicking any "Join Network", "Client Area", "Start a Project", or similar buttons
- After successful authentication, users are automatically redirected to their role-specific dashboard

### Dashboard Protection
- All dashboards are protected by `protectDashboard()` function
- Unauthenticated users are redirected to the landing page
- Users accessing a dashboard they don't have permission for are redirected to their correct dashboard

### Authentication Flow
1. User clicks login/signup button
2. Auth modal opens with options for:
   - Email/password authentication
   - Google OAuth (one-click)
3. After successful authentication:
   - Profile is automatically created (if new user)
   - User is redirected to their role-specific dashboard
4. Dashboard loads and verifies user permission

## Testing

### Optional Load Test Seeding (Not for normal use)
For stress/performance testing only, you can seed users with a custom mix:

```bash
npm run seed:scale -- --clients 1500 --developers 250 --commissioners 120 --admins 8 --concurrency 6 --prefix codestudio --domain codestudio.ke
```

For normal operation, keep this off and let users sign up naturally.

Required environment variables:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

### Test Google OAuth
1. Open the landing page
2. Click "Client Area" or "Join Network"
3. Click "Continue with Google"
4. Sign in with any Google account
5. You should be redirected to the client dashboard (default role)

## Troubleshooting

### "Google OAuth not configured" error
- Verify the credentials are correctly entered in Supabase dashboard
- Check that the provider is enabled

### Redirect not working
- Ensure the redirect URLs are properly configured in Google Console
- Check browser console for errors

### Wrong dashboard after login
- Verify the user's role in the `profiles` table
- Check that `protectDashboard()` is called on each dashboard page

### Email confirmation issues
- Email confirmation is disabled by default in this setup
- Users can log in immediately after signup
