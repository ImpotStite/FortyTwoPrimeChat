/**
 * Site-wide maintenance notice. Shown on every route unless disabled via env.
 */
export function MaintenanceBanner() {
  if (import.meta.env.VITE_MAINTENANCE_BANNER === "false") {
    return null;
  }

  return (
    <div className="maintenance-banner" role="alert" aria-live="polite">
      <div className="maintenance-banner__inner">
        <strong className="maintenance-banner__title">Under maintenance</strong>
        <p className="maintenance-banner__text">
          Fortytwo Prime chat may be slow, unavailable, or behave unexpectedly
          while we work on the service. Payments and sessions could fail—check
          back soon. Thank you for your patience.
        </p>
      </div>
    </div>
  );
}
