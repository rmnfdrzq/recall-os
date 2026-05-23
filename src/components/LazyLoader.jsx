import { useState } from 'react';

/**
 * GlimmerSkeleton Component
 * Renders pulsating animated structural skeletons during loading states.
 */
export function GlimmerSkeleton({ variant = 'card', count = 1, className = '' }) {
  const skeletons = Array.from({ length: count });

  const getStyle = () => {
    switch (variant) {
      case 'title':
        return 'h-6 w-3/4 rounded-md mb-2';
      case 'text':
        return 'h-4 w-full rounded-sm mb-2';
      case 'avatar':
        return 'w-10 h-10 rounded-full';
      case 'image':
        return 'w-full h-40 rounded-lg mb-3';
      case 'card':
      default:
        return 'p-4 rounded-xl border border-white/[0.04] bg-white/[0.02] flex flex-col gap-2';
    }
  };

  return (
    <>
      {skeletons.map((_, idx) => (
        <div
          key={idx}
          className={`skeleton-glimmer ${getStyle()} ${className}`}
          style={{ minHeight: variant === 'card' ? '120px' : undefined }}
        >
          {variant === 'card' && (
            <>
              <div className="skeleton-glimmer h-5 w-1/3 rounded bg-white/[0.04] mb-2" />
              <div className="skeleton-glimmer h-3 w-5/6 rounded bg-white/[0.02] mb-1" />
              <div className="skeleton-glimmer h-3 w-2/3 rounded bg-white/[0.02]" />
            </>
          )}
        </div>
      ))}
    </>
  );
}

/**
 * BlurUpImage Component
 * Displays a soft blurry inline placeholder before fading in the fully loaded image.
 */
export function BlurUpImage({ src, alt, className = '', containerClassName = '' }) {
  const [isLoaded, setIsLoaded] = useState(false);

  // Tiny inline base64 SVG representing a sleek document/image icon to blur up from
  const svgPlaceholder = `data:image/svg+xml;charset=utf-8,%3Csvg xmlns%3D'http://www.w3.org/2000/svg' viewBox%3D'0 0 100 100'%3E%3Crect width%3D'100' height%3D'100' fill%3D'%231f2937'/%3E%3C/svg%3E`;

  return (
    <div
      className={`relative overflow-hidden ${containerClassName}`}
      style={{ isolation: 'isolate' }}
    >
      {/* Blurred Placeholder */}
      {!isLoaded && (
        <img
          src={svgPlaceholder}
          alt="Loading..."
          className={`w-full h-full object-cover transition-opacity duration-500 blur-xl ${className}`}
          style={{ position: 'absolute', top: 0, left: 0 }}
        />
      )}

      {/* Main High-res Image */}
      <img
        src={src}
        alt={alt}
        onLoad={() => setIsLoaded(true)}
        loading="lazy"
        className={`w-full h-full object-cover transition-all duration-700 ease-out ${
          isLoaded ? 'opacity-100 scale-100 blur-0' : 'opacity-0 scale-95'
        } ${className}`}
      />
    </div>
  );
}
