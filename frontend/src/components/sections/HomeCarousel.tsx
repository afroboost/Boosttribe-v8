import React, { useEffect, useRef, useState } from 'react';
import supabase, { isSupabaseConfigured } from '@/lib/supabaseClient';

interface CarouselImage { url: string; alt?: string }

// Textes ALT par défaut (éditables dans l'admin « Identité » → home_carousel[i].alt).
const DEFAULT_ALTS = [
  "Deux sportifs en plein effort, chacun avec son propre casque, connectés à la même musique sur BoostTribe.",
  "Un duo qui s'entraîne en rythme, chacun ses écouteurs, la même playlist partagée en direct.",
  "Deux danseurs sur le même son, casques différents, expérience musicale synchronisée BoostTribe.",
];

/**
 * 🖼️ Carrousel d'images d'accueil — intégré DANS le hero (sous le sous-titre, au-dessus du bloc code).
 * Défilement auto fluide (gauche → droite) en boucle, responsive, coins légèrement arrondis, SANS cadre
 * ni bordure (fond noir homogène). Indicateurs (points) + swipe tactile. Images gérées depuis l'admin
 * « Identité ». Si aucune image → ne s'affiche pas (fallback propre).
 */
export const HomeCarousel: React.FC = () => {
  const [images, setImages] = useState<CarouselImage[]>([]);
  const [index, setIndex] = useState(0);
  const touchX = useRef<number | null>(null);
  const pausedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!supabase || !isSupabaseConfigured) return;
      try {
        const { data } = await supabase.from('site_settings').select('home_carousel').limit(1).maybeSingle();
        if (cancelled || !data) return;
        const raw = (data as { home_carousel?: unknown }).home_carousel;
        const arr = Array.isArray(raw) ? (raw as CarouselImage[]).filter((i) => i && typeof i.url === 'string' && i.url.trim()) : [];
        setImages(arr.slice(0, 3));
      } catch { /* fallback : pas de carrousel */ }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (images.length <= 1) return;
    const id = setInterval(() => { if (!pausedRef.current) setIndex((i) => (i + 1) % images.length); }, 4000);
    return () => clearInterval(id);
  }, [images.length]);

  if (images.length === 0) return null; // fallback propre

  const go = (i: number) => setIndex(((i % images.length) + images.length) % images.length);
  const onTouchStart = (e: React.TouchEvent) => { touchX.current = e.touches[0].clientX; pausedRef.current = true; };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchX.current === null) return;
    const dx = e.changedTouches[0].clientX - touchX.current;
    if (Math.abs(dx) > 40) go(index + (dx < 0 ? 1 : -1));
    touchX.current = null; pausedRef.current = false;
  };

  return (
    <div className="w-full max-w-2xl mx-auto mb-10">
      <div
        className="relative overflow-hidden rounded-2xl"
        style={{ aspectRatio: '16 / 9', background: '#000000' }}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        onMouseEnter={() => { pausedRef.current = true; }}
        onMouseLeave={() => { pausedRef.current = false; }}
        data-testid="home-carousel"
      >
        {/* Piste défilante (translateX) — sans cadre ni bordure */}
        <div className="flex h-full transition-transform duration-700 ease-in-out" style={{ transform: `translateX(-${index * 100}%)` }}>
          {images.map((img, i) => {
            // Texte effectif : champ admin, sinon défaut. Sert de LÉGENDE visible ET d'attribut alt.
            const caption = (img.alt?.trim() || DEFAULT_ALTS[i] || '').trim();
            return (
              <div key={i} className="relative w-full h-full flex-shrink-0">
                <img
                  src={img.url}
                  alt={caption || `Image d'accueil ${i + 1}`}
                  className="w-full h-full object-cover"
                  loading={i === 0 ? 'eager' : 'lazy'}
                  draggable={false}
                />
                {/* 📝 Légende visible — overlay bas, dégradé sombre pour la lisibilité (rien si vide). */}
                {caption && (
                  <div className="absolute inset-x-0 bottom-0 px-4 pt-10 pb-9 sm:pb-10 bg-gradient-to-t from-black/85 via-black/45 to-transparent pointer-events-none">
                    <p className="text-white text-center text-[13px] leading-snug sm:text-sm md:text-base font-medium max-w-2xl mx-auto drop-shadow-[0_2px_6px_rgba(0,0,0,0.9)]">
                      {caption}
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Indicateurs (points) */}
        {images.length > 1 && (
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-2">
            {images.map((_, i) => (
              <button
                key={i}
                onClick={() => go(i)}
                aria-label={`Aller à l'image ${i + 1}`}
                className="h-2 rounded-full transition-all"
                style={{
                  width: i === index ? 22 : 8,
                  background: i === index ? 'linear-gradient(135deg, #9A3FC0 0%, #E24A9E 100%)' : 'rgba(255,255,255,0.5)',
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default HomeCarousel;
