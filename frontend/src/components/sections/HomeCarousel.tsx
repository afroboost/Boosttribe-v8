import React, { useEffect, useRef, useState } from 'react';
import supabase, { isSupabaseConfigured } from '@/lib/supabaseClient';

interface CarouselImage { url: string; alt?: string }

/**
 * 🖼️ Carrousel d'images d'accueil — défilement automatique fluide (gauche → droite), en boucle.
 * Responsive, coins arrondis, indicateurs (points), swipe tactile. Images gérées depuis l'admin « Identité »
 * (site_settings.home_carousel). Si aucune image configurée → la section ne s'affiche pas (fallback propre).
 */
export const HomeCarousel: React.FC = () => {
  const [images, setImages] = useState<CarouselImage[]>([]);
  const [index, setIndex] = useState(0);
  const touchX = useRef<number | null>(null);
  const pausedRef = useRef(false);

  // Charge les images du carrousel depuis site_settings.
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

  // Défilement automatique (boucle) — en pause pendant un geste tactile.
  useEffect(() => {
    if (images.length <= 1) return;
    const id = setInterval(() => {
      if (!pausedRef.current) setIndex((i) => (i + 1) % images.length);
    }, 4000);
    return () => clearInterval(id);
  }, [images.length]);

  if (images.length === 0) return null; // fallback propre : rien si non configuré

  const go = (i: number) => setIndex(((i % images.length) + images.length) % images.length);

  const onTouchStart = (e: React.TouchEvent) => { touchX.current = e.touches[0].clientX; pausedRef.current = true; };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchX.current === null) return;
    const dx = e.changedTouches[0].clientX - touchX.current;
    if (Math.abs(dx) > 40) go(index + (dx < 0 ? 1 : -1)); // swipe gauche = suivant
    touchX.current = null;
    pausedRef.current = false;
  };

  return (
    <section className="w-full px-4 sm:px-6 lg:px-8 py-10 sm:py-14" aria-label="Galerie d'accueil">
      <div className="max-w-5xl mx-auto">
        <div
          className="relative overflow-hidden rounded-3xl border border-white/10 shadow-2xl bg-black/40"
          style={{ aspectRatio: '16 / 9' }}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
          onMouseEnter={() => { pausedRef.current = true; }}
          onMouseLeave={() => { pausedRef.current = false; }}
          data-testid="home-carousel"
        >
          {/* Piste défilante (translateX) */}
          <div
            className="flex h-full transition-transform duration-700 ease-in-out"
            style={{ transform: `translateX(-${index * 100}%)` }}
          >
            {images.map((img, i) => (
              <div key={i} className="w-full h-full flex-shrink-0">
                <img
                  src={img.url}
                  alt={img.alt || `Image d'accueil ${i + 1}`}
                  className="w-full h-full object-cover"
                  loading={i === 0 ? 'eager' : 'lazy'}
                  draggable={false}
                />
              </div>
            ))}
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
                    background: i === index ? 'linear-gradient(135deg, #D91CD2 0%, #FF2DAA 100%)' : 'rgba(255,255,255,0.45)',
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
};

export default HomeCarousel;
