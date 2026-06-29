import React from 'react';

/**
 * Renders the full product description pulled from the Digiseller page:
 *  - addInfo: main body (e.g. the list of games included in the subscription)
 *  - info:    activation terms, delivery time and warnings
 *  - images:  product preview images
 */
export default function DigisellerDescription({ description, showImages = true }) {
  if (!description) return null;
  const info = description.info || [];
  const addInfo = description.addInfo || [];
  const images = showImages ? (description.images || []) : [];
  if (!info.length && !addInfo.length && !images.length) return null;

  return (
    <section className="gp-page-features gp-desc">
      {addInfo.length > 0 && (
        <div className="gp-desc-block">
          <h2>Описание</h2>
          <div className="gp-desc-body">
            {addInfo.map((line, i) => (
              <p key={`add-${i}`} className="gp-desc-line">{line}</p>
            ))}
          </div>
        </div>
      )}

      {info.length > 0 && (
        <div className="gp-desc-block">
          <h2>Условия активации и доставка</h2>
          <div className="gp-desc-body">
            {info.map((line, i) => (
              <p key={`info-${i}`} className="gp-desc-line">{line}</p>
            ))}
          </div>
        </div>
      )}

      {images.length > 0 && (
        <div className="gp-desc-gallery">
          {images.map((src, i) => (
            <img key={`img-${i}`} src={src} alt="" loading="lazy" className="gp-desc-img" />
          ))}
        </div>
      )}
    </section>
  );
}
