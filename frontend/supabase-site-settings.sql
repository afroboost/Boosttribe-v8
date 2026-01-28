-- =============================================
-- BEATTRIBE SITE SETTINGS TABLE
-- =============================================
-- This table stores the CMS configuration for the site
-- Run this in your Supabase SQL Editor

-- Drop existing table if needed (uncomment if you want to reset)
-- DROP TABLE IF EXISTS site_settings;

-- Create site_settings table
CREATE TABLE IF NOT EXISTS site_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Site Identity
  site_name TEXT NOT NULL DEFAULT 'Beattribe',
  site_slogan TEXT NOT NULL DEFAULT 'Unite Through Rhythm',
  site_description TEXT NOT NULL DEFAULT 'Rejoignez la communauté des beatmakers et producteurs.',
  site_badge TEXT NOT NULL DEFAULT 'La communauté des créateurs',
  favicon_url TEXT DEFAULT '',
  
  -- Colors (hex format)
  color_primary TEXT NOT NULL DEFAULT '#8A2EFF',
  color_secondary TEXT NOT NULL DEFAULT '#FF2FB3',
  color_background TEXT NOT NULL DEFAULT '#000000',
  
  -- Button Labels
  btn_login TEXT NOT NULL DEFAULT 'Connexion',
  btn_start TEXT NOT NULL DEFAULT 'Commencer',
  btn_join TEXT NOT NULL DEFAULT 'Rejoindre la tribu',
  btn_explore TEXT NOT NULL DEFAULT 'Explorer les beats',
  
  -- Stats
  stat_creators TEXT NOT NULL DEFAULT '50K+',
  stat_beats TEXT NOT NULL DEFAULT '1M+',
  stat_countries TEXT NOT NULL DEFAULT '120+',
  
  -- Stripe Links
  stripe_pro_monthly TEXT DEFAULT '',
  stripe_pro_yearly TEXT DEFAULT '',
  stripe_enterprise_monthly TEXT DEFAULT '',
  stripe_enterprise_yearly TEXT DEFAULT '',
  
  -- Metadata
  updated_by UUID REFERENCES auth.users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add favicon_url column if table exists but column doesn't
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'site_settings' AND column_name = 'favicon_url') THEN
    ALTER TABLE site_settings ADD COLUMN favicon_url TEXT DEFAULT '';
  END IF;
END $$;

-- Insert default settings if not exists
INSERT INTO site_settings (id, site_name)
SELECT gen_random_uuid(), 'Beattribe'
WHERE NOT EXISTS (SELECT 1 FROM site_settings LIMIT 1);

-- Enable RLS
ALTER TABLE site_settings ENABLE ROW LEVEL SECURITY;

-- Drop existing policies
DROP POLICY IF EXISTS "Anyone can read site settings" ON site_settings;
DROP POLICY IF EXISTS "Admin can update site settings" ON site_settings;
DROP POLICY IF EXISTS "Admin can insert site settings" ON site_settings;

-- Policy: Anyone can read site settings
CREATE POLICY "Anyone can read site settings"
  ON site_settings
  FOR SELECT
  USING (true);

-- Policy: Only admin can update site settings
CREATE POLICY "Admin can update site settings"
  ON site_settings
  FOR UPDATE
  USING (
    auth.uid() IN (
      SELECT id FROM profiles WHERE role = 'admin'
    )
    OR
    auth.jwt() ->> 'email' = 'contact.artboost@gmail.com'
  );

-- Policy: Only admin can insert site settings
CREATE POLICY "Admin can insert site settings"
  ON site_settings
  FOR INSERT
  WITH CHECK (
    auth.uid() IN (
      SELECT id FROM profiles WHERE role = 'admin'
    )
    OR
    auth.jwt() ->> 'email' = 'contact.artboost@gmail.com'
  );

-- Create function to update timestamp
CREATE OR REPLACE FUNCTION update_site_settings_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for auto-updating timestamp
DROP TRIGGER IF EXISTS site_settings_updated_at ON site_settings;
CREATE TRIGGER site_settings_updated_at
  BEFORE UPDATE ON site_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_site_settings_timestamp();

-- Grant access
GRANT SELECT ON site_settings TO authenticated;
GRANT SELECT ON site_settings TO anon;
GRANT UPDATE ON site_settings TO authenticated;
GRANT INSERT ON site_settings TO authenticated;
