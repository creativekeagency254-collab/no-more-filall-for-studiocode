# Testing Guide - Authentication System

## Quick Start Testing

### 1. Test Email/Password Signup (Works Immediately)
1. Open `landing_page.html` in your browser
2. Click "Join Network" or "Start a Project" button
3. Auth modal opens → Click "Sign Up" tab (if not already there)
4. Fill in the form:
   - First Name: `John`
   - Last Name: `Doe`
   - Email: `john@example.com`
   - Password: `TestPass123!`
5. Click "Create Account →"
6. You should be redirected to `client_dashboard.html`
7. Verify you see the client dashboard interface

### 2. Test Login
1. From the dashboard, click sign out
2. You're redirected to landing page
3. Click "Client Area" or "Sign In"
4. Auth modal opens → Enter credentials:
   - Email: `john@example.com`
   - Password: `TestPass123!`
5. Click "Sign In →"
6. You should be redirected back to `client_dashboard.html`

### 3. Test Google OAuth (Requires Configuration First)

#### Prerequisites
Before testing Google OAuth, you MUST:
1. Go to Supabase Dashboard
2. Navigate to Authentication → Providers
3. Enable Google provider
4. Enter credentials:
   - Client ID: your Google OAuth Client ID
   - Client Secret: your Google OAuth Client Secret
5. In Google Cloud Console, add redirect URI:
   ```
   https://smdbfaomeghoejqqkplv.supabase.co/auth/v1/callback
   ```

#### Test Steps
1. Open `landing_page.html`
2. Click any auth button (Join Network, Client Area, etc.)
3. In the auth modal, click "Continue with Google"
4. You'll be redirected to Google's sign-in page
5. Select a Google account
6. Approve permissions
7. You should be redirected back to `client_dashboard.html`

### 4. Test Dashboard Protection
1. While logged out, try to directly access:
   - `client_dashboard.html`
   - `admin_dashboard.html`
   - `developer_dashboard.html`
   - `sales_dashboard.html`
2. All should redirect you to `landing_page.html`

### 5. Test Role-Based Access

#### Create Different Role Users
After creating accounts, use Supabase SQL Editor to change roles:

```sql
-- View all users and their roles
SELECT email, role FROM public.profiles;

-- Make john@example.com an admin
UPDATE public.profiles
SET role = 'admin'
WHERE email = 'john@example.com';

-- Create more users with different roles
-- You can sign up multiple accounts and then update their roles:

-- Developer
UPDATE public.profiles
SET role = 'developer'
WHERE email = 'developer.user@example.com';

-- Commissioner (Sales)
UPDATE public.profiles
SET role = 'commissioner'
WHERE email = 'sales.user@example.com';
```

#### Test Role Redirects
1. Log in with `john@example.com` (admin role)
2. Should redirect to `admin_dashboard.html`
3. Try to manually navigate to `client_dashboard.html`
4. Should auto-redirect back to `admin_dashboard.html`

Repeat for each role:
- `client` → `client_dashboard.html`
- `developer` → `developer_dashboard.html`
- `commissioner` → `sales_dashboard.html`
- `admin` → `admin_dashboard.html`

## Expected Behaviors

### Landing Page
- ✅ All auth buttons open the modal
- ✅ Modal tabs switch between Sign In / Sign Up
- ✅ Email/password forms work
- ✅ Google OAuth button appears
- ✅ Form validation works
- ✅ Password strength indicator shows on signup

### After Successful Auth
- ✅ Toast notification shows "Success! Redirecting..."
- ✅ Automatic redirect to correct dashboard
- ✅ No errors in browser console

### Dashboard Pages
- ✅ Protected from unauthenticated access
- ✅ Users redirected to their role-specific dashboard
- ✅ Sign out button works
- ✅ After sign out, redirected to landing page

### Auth State Persistence
- ✅ User stays logged in after page refresh
- ✅ Can navigate between pages while logged in
- ✅ Session persists until sign out

## Troubleshooting

### "Login failed: Invalid login credentials"
- Check that you're using the correct email/password
- Passwords are case-sensitive
- Make sure account was created successfully

### Google OAuth doesn't work
- Verify Google provider is enabled in Supabase
- Check that credentials are correctly entered
- Ensure redirect URI is configured in Google Console
- Open browser console to see detailed error messages

### Redirects to wrong dashboard
- Check user role in database:
  ```sql
  SELECT email, role FROM public.profiles WHERE email = 'your@email.com';
  ```
- Update role if needed
- Sign out and sign back in

### Stuck on landing page after login
- Open browser console (F12)
- Look for error messages
- Check Network tab for failed requests
- Verify `supabase-client.js` is loaded

### "Supabase client not initialized"
- Refresh the page
- Check that Supabase CDN script loads successfully
- Verify internet connection

## Browser Console Logs

Good authentication flow should show:
```
[INFO] Supabase client initialized.
[DEBUG] Auth Event: SIGNED_IN
[INFO] User session detected, checking dashboard for role...
[DEBUG] Redirect check: Current = landing_page.html, Target = client_dashboard.html
[INFO] Redirecting to client_dashboard.html
```

## Test Checklist

- [ ] Email signup works
- [ ] Email login works
- [ ] Password strength indicator appears
- [ ] Form validation prevents empty submissions
- [ ] Google OAuth button appears
- [ ] Google OAuth works (after configuration)
- [ ] Sign out works from all dashboards
- [ ] Dashboard protection works (no unauthorized access)
- [ ] Role-based redirects work correctly
- [ ] Session persists after page refresh
- [ ] No console errors during auth flow

## Advanced Testing

### Test Concurrent Sessions
1. Open landing page in Chrome
2. Sign in with user A
3. Open landing page in Firefox
4. Sign in with user B
5. Both should work independently

### Test Session Expiry
1. Sign in
2. Wait for session to expire (default: 1 hour)
3. Try to access a dashboard
4. Should redirect to landing page

### Test Network Issues
1. Open DevTools → Network tab
2. Throttle to "Slow 3G"
3. Try to sign in
4. Should show loading states properly
5. Should handle timeout gracefully
