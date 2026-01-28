# Beattribe - Product Requirements Document

## Vision
**"Unite Through Rhythm"** - Application d'écoute musicale synchronisée en temps réel.

## État Actuel - SDK Supabase Refactoré

### ✅ Refactoring Upload (28 Jan 2026)
- **SDK Supabase** : Utilisation correcte de `supabase.storage.from().upload()`
- **Pas de double lecture** : Une seule réponse `{ data, error }` traitée
- **Barre de progression** : Devient verte à 100% avant le message de succès
- **Erreurs dynamiques** : Message exact de Supabase affiché
- **Instructions SQL** : Affichées en console avec couleurs pour copier-coller

## Configuration Requise

### Variables d'environnement (déjà configurées)
```env
REACT_APP_SUPABASE_URL=https://tfghpbgbtpgrjlhomlvz.supabase.co
REACT_APP_SUPABASE_ANON_KEY=sb_publishable_***
REACT_APP_SUPABASE_BUCKET=audio-tracks
```

### ⚠️ Policies RLS à ajouter dans Supabase SQL Editor

Allez sur : https://supabase.com/dashboard/project/tfghpbgbtpgrjlhomlvz/sql

```sql
-- 1. Policy INSERT (permettre les uploads)
CREATE POLICY "Allow public uploads"
ON storage.objects FOR INSERT
TO anon
WITH CHECK (bucket_id = 'audio-tracks');

-- 2. Policy SELECT (permettre la lecture)
CREATE POLICY "Allow public read"
ON storage.objects FOR SELECT
TO anon
USING (bucket_id = 'audio-tracks');
```

## Architecture Upload SDK

```typescript
// supabaseClient.ts - Approche correcte
const { data, error } = await supabase.storage
  .from(AUDIO_BUCKET)
  .upload(filePath, file, {
    cacheControl: '3600',
    upsert: false,
    contentType: file.type,
  });

// Une seule lecture, pas de double parsing
if (error) {
  // Traitement erreur
}

if (data?.path) {
  const { data: urlData } = supabase.storage
    .from(AUDIO_BUCKET)
    .getPublicUrl(data.path);
  // Succès avec urlData.publicUrl
}
```

## Gestion des erreurs

| Erreur Supabase | Message affiché |
|-----------------|-----------------|
| `not found` / `bucket` | "Bucket introuvable. Créez-le dans Dashboard." |
| `policy` / `permission` / `403` | "Permission refusée (403). Vérifiez vos politiques SQL RLS." |
| `too large` / `size` | "Fichier trop volumineux." |
| `duplicate` | "Un fichier avec ce nom existe déjà." |

## Checklist Complétée

- [x] SDK Supabase utilisé correctement
- [x] Aucune double lecture du stream
- [x] Barre de progression verte à 100%
- [x] Instructions SQL dans console
- [x] Build réussi sans erreurs
- [ ] **Test upload réel** (en attente ajout policies RLS)

## Fichiers Modifiés

- `/frontend/src/lib/supabaseClient.ts` - Upload SDK refactoré
- `/frontend/src/components/audio/TrackUploader.tsx` - Barre verte à 100%

## Test à effectuer

1. **Ajouter les policies SQL** ci-dessus dans Supabase
2. **Tester un upload MP3** (8 Mo max recommandé)
3. **Vérifier** que le fichier apparaît dans la playlist

---
*Dernière mise à jour: 28 Jan 2026 - SDK Supabase refactoré*
