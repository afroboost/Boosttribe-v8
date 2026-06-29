/// <reference types="vite/client" />

// Variables d'environnement existantes (préfixe REACT_APP_ conservé via envPrefix dans vite.config.ts).
interface ImportMetaEnv {
  readonly REACT_APP_API_URL?: string;
  readonly REACT_APP_SUPABASE_URL?: string;
  readonly REACT_APP_SUPABASE_ANON_KEY?: string;
  readonly REACT_APP_SUPABASE_BUCKET?: string;
  readonly REACT_APP_TURN_URL?: string;
  readonly REACT_APP_TURN_USERNAME?: string;
  readonly REACT_APP_TURN_CREDENTIAL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
