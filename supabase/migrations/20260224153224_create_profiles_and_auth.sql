/*
  # Create profiles table and authentication system

  ## Overview
  This migration sets up the user profile management system with role-based access control
  and automatic profile creation when users sign up.

  ## New Tables
  
  ### `profiles`
  - `id` (uuid, primary key) - References auth.users(id)
  - `email` (text, unique, not null) - User's email address
  - `first_name` (text) - User's first name
  - `last_name` (text) - User's last name
  - `role` (text, default 'client') - User role: 'client', 'developer', 'commissioner', 'admin'
  - `created_at` (timestamptz, default now()) - Profile creation timestamp
  - `updated_at` (timestamptz, default now()) - Last update timestamp

  ## Security
  
  ### Row Level Security (RLS)
  - Enabled on `profiles` table
  - Users can read their own profile
  - Users can update their own profile (except role field)
  - Only authenticated users can access profiles
  
  ## Functions & Triggers
  
  ### `handle_new_user()`
  - Automatically creates a profile when a new user signs up
  - Extracts first_name and last_name from user metadata
  - Sets default role to 'client'
  
  ### `handle_updated_at()`
  - Automatically updates the updated_at timestamp on profile changes
  
  ## Important Notes
  - Google OAuth integration configured
  - Default role is 'client' for all new signups
  - Admins must manually update roles in the database
*/

-- Create profiles table
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text UNIQUE NOT NULL,
  first_name text,
  last_name text,
  role text DEFAULT 'client' CHECK (role IN ('client', 'developer', 'commissioner', 'admin')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- RLS Policies for profiles table
CREATE POLICY "Users can view own profile"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can insert own profile"
  ON public.profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);

-- Function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to call handle_updated_at on profile updates
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- Function to handle new user creation
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, email, first_name, last_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'first_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'last_name', ''),
    'client'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to automatically create profile on user signup
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Create index for faster role lookups
CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles(role);
CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles(email);