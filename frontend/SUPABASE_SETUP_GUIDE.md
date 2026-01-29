# 🔐 Guide de Configuration Supabase Auth - Beattribe

## 📋 Étape 1 : Exécuter le SQL de Configuration

1. Allez dans votre **Supabase Dashboard** :
   - https://supabase.com/dashboard/project/tfghpbgbtpgrjlhomlvz/sql

2. Copiez-collez le contenu du fichier `supabase-setup.sql` dans l'éditeur SQL

3. Cliquez sur **Run** pour exécuter toutes les commandes

---

## 🔑 Étape 2 : Activer Google Auth

### 2.1 Créer les identifiants Google

1. Allez sur **Google Cloud Console** :
   - https://console.cloud.google.com/apis/credentials

2. Créez un projet ou sélectionnez un projet existant

3. Cliquez sur **+ CREATE CREDENTIALS** > **OAuth client ID**

4. Sélectionnez **Web application**

5. Configurez :
   - **Name** : `Beattribe`
   - **Authorized JavaScript origins** :
     ```
     https://tfghpbgbtpgrjlhomlvz.supabase.co
     https://beattribe-sync.preview.emergentagent.com
     ```
   - **Authorized redirect URIs** :
     ```
     https://tfghpbgbtpgrjlhomlvz.supabase.co/auth/v1/callback
     ```

6. Cliquez **Create** et notez le **Client ID** et **Client Secret**

### 2.2 Configurer Supabase

1. Allez dans votre **Supabase Dashboard** :
   - https://supabase.com/dashboard/project/tfghpbgbtpgrjlhomlvz/auth/providers

2. Trouvez **Google** dans la liste des providers

3. Cliquez sur le toggle pour **activer**

4. Remplissez :
   - **Client ID** : (celui de Google)
   - **Client Secret** : (celui de Google)

5. Cliquez **Save**

---

## 👤 Étape 3 : Définir l'Administrateur

Après avoir créé votre compte avec l'email `contact.artboost@gmail.com`, exécutez :

```sql
UPDATE public.profiles 
SET role = 'admin', subscription_status = 'enterprise' 
WHERE email = 'contact.artboost@gmail.com';
```

---

## ✅ Vérification

1. Testez la connexion Email/Password
2. Testez la connexion Google
3. Vérifiez que le badge "👑 Mode Admin" apparaît

---

## 🐛 Dépannage

### Erreur "Invalid login credentials"
- Vérifiez que le compte existe
- Réinitialisez le mot de passe via "Mot de passe oublié"

### Erreur "Unsupported provider: google"
- Activez Google dans Supabase Dashboard > Auth > Providers

### Erreur "Stream already read"
- Cette erreur est résolue dans la dernière version du code

### Le badge Admin n'apparaît pas
- Exécutez le SQL pour définir le rôle admin
- Déconnectez-vous et reconnectez-vous
