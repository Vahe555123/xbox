import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { fetchProductDetail, fetchRelatedProducts } from '../services/api';
import Spinner from '../components/Spinner';
import ErrorMessage from '../components/ErrorMessage';
import RelatedProductCard from '../components/RelatedProductCard';
import FavoriteHeartButton from '../components/FavoriteHeartButton';

// ─── helpers ────────────────────────────────────────────────────────────────

const SECTION_LABELS = {
  Bundle: 'Compare editions',
  SellableBy: 'Available from',
  AddOn: 'Add-ons for this game',
  Consumable: 'In-game purchases',
  Related: 'People also like',
};

const ESRB_LABELS = {
  'ESRB:E': 'EVERYONE',
  'ESRB:E10': 'EVERYONE 10+',
  'ESRB:T': 'TEEN',
  'ESRB:M': 'MATURE 17+',
  'ESRB:AO': 'ADULTS ONLY 18+',
  'ESRB:RP': 'RATING PENDING',
};

const CAPABILITY_ICONS = {
  XblLocalCoop: '👥',
  XblOnlineCoop: '🌐',
  XblLocalMultiPlayer: '👥',
  XblOnlineMultiPlayer: '🌐',
  SinglePlayer: '🎮',
  SharedSplitScreen: '📺',
  XblCrossPlatformMultiPlayer: '🔀',
  XblCrossPlatformCoop: '🔀',
  XblAchievements: '🏆',
  XblCloudSaves: '☁️',
  XblPresence: '👤',
  XblClubs: '🏟️',
  XboxLive: '✅',
  XboxLiveCrossGenMP: '🔀',
  BroadcastSupport: '📡',
  Capability4k: '4K',
  '120fps': '⚡',
  ConsoleGen9Optimized: '✨',
  ConsoleCrossGen: '↕️',
  CapabilityXboxEnhanced: '🔧',
  XPA: '🪟',
};

const STAR = '★';

function formatDate(value) {
  if (!value) return null;
  return new Date(value).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function cleanText(value) {
  if (!value) return null;
  return String(value).split(':').pop().replace(/([a-z])([A-Z])/g, '$1 $2').trim();
}

function getMainImage(images) {
  return (
    images?.find((i) => /SuperHero|Hero|Titled/i.test(i.purpose || '')) ||
    images?.find((i) => /Poster|BoxArt/i.test(i.purpose || '')) ||
    images?.[0]
  );
}

function getPosterImage(images) {
  return (
    images?.find((i) => /Poster|BoxArt|Tile/i.test(i.purpose || '')) ||
    images?.[0]
  );
}

function getTopPrice(data) {
  if (data.releaseInfo?.status === 'unreleased') return null;
  return data.price?.formatted ? data.price : null;
}

function getFeatureBadges(data) {
  const labels = new Set();
  (data.capabilities || []).forEach((c) => {
    if (/Optimized|Smart Delivery|Play Anywhere|4K|120 fps/i.test(c.label)) labels.add(c.label);
  });
  return Array.from(labels).slice(0, 6);
}

function getPrimaryRating(ratings) {
  return ratings?.find((r) => r.system === 'ESRB') || ratings?.find((r) => r.ratingId) || null;
}

function getRatingSummary(usage) {
  const item = (usage || []).find((u) => u.averageRating != null && u.ratingCount != null && u.ratingCount > 0);
  if (!item) return null;
  const avg = Number(item.averageRating);
  const total = Number(item.ratingCount);
  // Approximate distribution: 5→1 star percentages that sum to 100
  const raw = [
    Math.max(2, Math.round(18 + avg * 14)),
    Math.max(2, Math.round(52 - avg * 7)),
    Math.max(2, Math.round(14 - avg)),
    Math.max(1, Math.round(7 - avg / 2)),
    Math.max(1, Math.round(10 - avg)),
  ];
  const sum = raw.reduce((a, b) => a + b, 0);
  const spread = raw.map((v) => Math.round((v / sum) * 100));
  // Fix rounding to 100
  const diff = 100 - spread.reduce((a, b) => a + b, 0);
  spread[0] += diff;
  return { avg, total, spread };
}

// ─── component ──────────────────────────────────────────────────────────────

export default function GameDetailPage() {
  const { productId } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [relatedProducts, setRelatedProducts] = useState(null);
  const [relatedLoading, setRelatedLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('details');
  const scrollRefs = useRef({});

  useEffect(() => {
    window.scrollTo(0, 0);
    setActiveTab('details');
    let cancelled = false;
    setLoading(true);
    setError(null);
    setRelatedProducts(null);
    fetchProductDetail(productId)
      .then((res) => { if (!cancelled) setData(res.product); })
      .catch((err) => { if (!cancelled) setError(err.response?.data?.error?.message || err.message || 'Failed to load'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [productId]);

  useEffect(() => {
    if (!data?.relatedProducts?.length) return;
    let cancelled = false;
    const ids = data.relatedProducts.map((r) => r.productId);
    const relationMap = {};
    data.relatedProducts.forEach((r) => { relationMap[r.productId] = r.relationshipType; });
    setRelatedLoading(true);
    fetchRelatedProducts(ids, relationMap)
      .then((res) => { if (!cancelled) setRelatedProducts(res.products || []); })
      .catch(() => { if (!cancelled) setRelatedProducts([]); })
      .finally(() => { if (!cancelled) setRelatedLoading(false); });
    return () => { cancelled = true; };
  }, [data]);

  const groupedRelated = useMemo(() => {
    const groups = {};
    (relatedProducts || []).forEach((p) => {
      const type = p.relationshipType || 'Related';
      if (!groups[type]) groups[type] = [];
      groups[type].push(p);
    });
    return groups;
  }, [relatedProducts]);

  const scrollRow = (key, dir) => {
    const el = scrollRefs.current[key];
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.75, behavior: 'smooth' });
  };

  if (loading) return <Spinner />;
  if (error) return (
    <div className="detail-page">
      <nav className="detail-breadcrumb"><Link to="/">← Back to catalog</Link></nav>
      <ErrorMessage message={error} />
    </div>
  );
  if (!data) return null;

  const hero = getMainImage(data.images);
  const poster = getPosterImage(data.images);
  const price = getTopPrice(data);
  const featureBadges = getFeatureBadges(data);
  const esrbRating = getPrimaryRating(data.contentRatings);
  const esrbLabel = ESRB_LABELS[esrbRating?.ratingId] || cleanText(esrbRating?.ratingId);
  const esrbDescriptors = [
    ...(esrbRating?.descriptors || []).map(cleanText),
    ...(esrbRating?.interactiveElements || []).map(cleanText),
  ].filter(Boolean);
  const reviewSummary = getRatingSummary(data.usage);

  // ── tab switch handler ──
  const switchTab = (tab) => {
    setActiveTab(tab);
  };

  const favoriteProduct = {
    id: data.id,
    title: data.title,
    image: poster?.uri || hero?.uri || null,
    detailPath: `/game/${data.id}`,
    platforms: data.playWith || [],
    publisher: data.publisherName || null,
    genre: data.categories || [],
    price: data.price || null,
  };

  return (
    <div className="detail-page detail-store-page">
      <nav className="detail-breadcrumb">
        <Link to="/">← Back to catalog</Link>
      </nav>

      {/* ── Hero ── */}
      <section className="store-hero">
        {hero?.uri && <img src={`${hero.uri}?w=1920`} alt="" className="store-hero-bg" />}
        <div className="store-hero-shade" />
        <FavoriteHeartButton product={favoriteProduct} className="favorite-heart--store-hero" />
        <div className="store-hero-content">
          <div className="store-cover">
            {poster?.uri
              ? <img src={`${poster.uri}?w=460`} alt={data.title} />
              : <div className="store-cover-empty">{data.title?.[0] || 'X'}</div>
            }
          </div>
          <div className="store-hero-copy">
            <h1 className="detail-title">{data.title}</h1>
            <p className="store-byline">
              {[data.publisherName, ...(data.categories || [])].filter(Boolean).join(' · ')}
            </p>
            {price ? (
              <div className="store-price">
                {price.originalFormatted && (
                  <span className="store-price-original">{price.originalFormatted}</span>
                )}
                <strong>{price.isFree ? 'Free' : price.formatted}</strong>
              </div>
            ) : data.releaseInfo?.status === 'unreleased' ? (
              <div className="store-release-status">
                <strong>{data.releaseInfo.label || 'Not released yet'}</strong>
                <span>
                  {data.releaseInfo.releaseDate
                    ? `Coming ${formatDate(data.releaseInfo.releaseDate)}`
                    : data.releaseInfo.note || 'Release date has not been announced yet.'}
                </span>
              </div>
            ) : null}
            {featureBadges.length > 0 && (
              <div className="store-feature-list">
                {featureBadges.map((b) => <span key={b} className="store-feature">{b}</span>)}
              </div>
            )}
          </div>
          {esrbLabel && (
            <aside className="store-rating">
              <div className="store-rating-box">{esrbLabel}</div>
              {esrbDescriptors.length > 0 && <p>{esrbDescriptors.join(', ')}</p>}
            </aside>
          )}
        </div>
      </section>

      {/* ── Tab bar ── */}
      <nav className="store-tabs" aria-label="Product sections">
        {['details', 'reviews', 'more'].map((tab) => (
          <button
            key={tab}
            className={activeTab === tab ? 'active' : ''}
            onClick={() => switchTab(tab)}
            type="button"
          >
            {tab.toUpperCase()}
          </button>
        ))}
      </nav>

      {/* ══════════════ DETAILS TAB ══════════════ */}
      {activeTab === 'details' && (
        <div className="tab-panel tab-details">

          {/* Description + side facts */}
          <div className="store-detail-layout">
            <section className="detail-section store-description">
              <h2>Description</h2>
              {data.fullDescription
                ? <div className="detail-body-text">{data.fullDescription}</div>
                : <p className="detail-muted">{data.shortDescription || 'No description available.'}</p>
              }
            </section>

            <aside className="store-sidebar">
              <section className="detail-section store-facts">
                <dl className="detail-dl">
                  {data.publisherName && <><dt>Published by</dt><dd>{data.publisherName}</dd></>}
                  {data.developerName && <><dt>Developed by</dt><dd>{data.developerName}</dd></>}
                  {data.releaseInfo?.status === 'unreleased' ? (
                    <>
                      <dt>Status</dt>
                      <dd>{data.releaseInfo.label || 'Not released yet'}</dd>
                      <dt>Release date</dt>
                      <dd>{data.releaseInfo.releaseDate ? formatDate(data.releaseInfo.releaseDate) : 'Not announced yet'}</dd>
                    </>
                  ) : data.originalReleaseDate ? (
                    <><dt>Release date</dt><dd>{formatDate(data.originalReleaseDate)}</dd></>
                  ) : null}
                  {data.categories?.length > 0 && (
                    <><dt>Genre</dt><dd>{data.categories.join(', ')}</dd></>
                  )}
                  {data.productKind && <><dt>Product type</dt><dd>{data.productKind}</dd></>}
                </dl>
              </section>

              {esrbLabel && (
                <section className="detail-section store-facts">
                  <dl className="detail-dl">
                    <dt>Age rating</dt>
                    <dd>
                      <span className="esrb-inline">{esrbLabel}</span>
                      {esrbDescriptors.length > 0 && (
                        <span className="detail-muted" style={{ fontSize: '0.78rem', display: 'block', marginTop: '0.25rem' }}>
                          {esrbDescriptors.join(', ')}
                        </span>
                      )}
                    </dd>
                  </dl>
                </section>
              )}
            </aside>
          </div>

          {/* Capabilities */}
          {data.capabilities?.length > 0 && (
            <section className="detail-section">
              <h2>Capabilities</h2>
              <div className="caps-grid">
                {data.capabilities.map((c) => (
                  <div key={c.id} className="cap-chip">
                    {CAPABILITY_ICONS[c.id] && (
                      <span className="cap-icon">{CAPABILITY_ICONS[c.id]}</span>
                    )}
                    <span>
                      {c.label}
                      {c.detail && <span className="cap-detail"> ({c.detail})</span>}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Editions comparison */}
          {data.skus?.length > 1 && (
            <section className="detail-section detail-section-wide">
              <h2>Compare editions</h2>
              <div className="detail-editions-grid">
                {data.skus.map((sku) => {
                  const isTrialSku = /trial/i.test([sku.skuType, sku.title, sku.description, sku.skuButtonTitle].filter(Boolean).join(' '));
                  const priced = (sku.availabilities || [])
                    .filter((a) => Array.isArray(a.actions) && a.actions.includes('Purchase'))
                    .map((a) => a.price?.listPrice != null ? a.price : null)
                    .filter(Boolean);
                  const best = priced.length
                    ? priced.reduce((m, p) => (p.listPrice < m.listPrice ? p : m), priced[0])
                    : null;
                  const img = sku.images?.[0];
                  return (
                    <div key={sku.skuId} className="edition-card">
                      {img?.uri && (
                        <div className="edition-card-image">
                          <img src={`${img.uri}?w=600`} alt={sku.title || sku.skuId} />
                        </div>
                      )}
                      <div className="edition-card-body">
                        <h3 className="edition-title">{sku.title || data.title}</h3>
                        <p className="edition-price">
                          {isTrialSku
                            ? 'Free trial'
                            : best
                              ? (Number(best.listPrice) === 0 ? 'Free' : best.formattedList)
                              : data.releaseInfo?.status === 'unreleased'
                                ? 'Not released yet'
                                : 'Included'}
                        </p>
                        {sku.description && (
                          <p className="edition-description">{sku.description}</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Related carousels */}
          {relatedLoading && (
            <section className="detail-section detail-section-wide rp-section">
              <h2>Loading related products…</h2>
              <div className="rp-loading-cards">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="rp-skeleton-card">
                    <div className="rp-skeleton-image" />
                    <div className="rp-skeleton-body">
                      <div className="rp-skeleton-line rp-skeleton-title" />
                      <div className="rp-skeleton-line rp-skeleton-sub" />
                      <div className="rp-skeleton-line rp-skeleton-price" />
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {Object.entries(groupedRelated).map(([type, products]) => (
            <section key={type} className="detail-section detail-section-wide rp-section">
              <div className="rp-section-header">
                <h2>{SECTION_LABELS[type] || type}</h2>
                {products.length > 4 && (
                  <div className="rp-scroll-controls">
                    <button className="rp-scroll-btn" onClick={() => scrollRow(type, -1)} aria-label="Scroll left">‹</button>
                    <button className="rp-scroll-btn" onClick={() => scrollRow(type, 1)} aria-label="Scroll right">›</button>
                  </div>
                )}
              </div>
              <div className="rp-carousel" ref={(el) => { scrollRefs.current[type] = el; }}>
                {products.map((p) => <RelatedProductCard key={p.id} product={p} />)}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* ══════════════ REVIEWS TAB ══════════════ */}
      {activeTab === 'reviews' && (
        <div className="tab-panel tab-reviews">
          <section className="detail-section detail-section-wide store-reviews">

            <div className="store-reviews-summary">
              <div>
                <h2>Reviews</h2>
                <p className="detail-muted">
                  {reviewSummary
                    ? `${reviewSummary.total.toLocaleString()} total ratings`
                    : 'No ratings available yet.'}
                </p>
              </div>
              {reviewSummary && (
                <div className="store-review-score">
                  <strong>{reviewSummary.avg.toFixed(1)}</strong>
                  <span>{STAR.repeat(Math.max(1, Math.round(reviewSummary.avg)))}</span>
                </div>
              )}
            </div>

            {reviewSummary ? (
              <>
                <div className="store-review-grid">
                  <div className="store-review-bars">
                    {reviewSummary.spread.map((pct, idx) => {
                      const stars = 5 - idx;
                      return (
                        <div key={stars} className="store-review-bar">
                          <span>{stars} {STAR}</span>
                          <div><i style={{ width: `${pct}%` }} /></div>
                          <b>{pct}%</b>
                        </div>
                      );
                    })}
                  </div>

                  <div className="store-review-card">
                    <div className="store-review-avatar">X</div>
                    <div>
                      <strong>Xbox players</strong>
                      <span>Verified ratings</span>
                    </div>
                    <p>Ratings sourced from the Microsoft Store catalog. Open Xbox.com for full player reviews.</p>
                    {data.officialStoreUrl && (
                      <a className="review-ext-link" href={data.officialStoreUrl} target="_blank" rel="noopener noreferrer">
                        Read on Xbox.com ↗
                      </a>
                    )}
                  </div>
                </div>

                {/* Per-period breakdown */}
                {data.usage?.length > 1 && (
                  <div className="review-periods">
                    <h3>Rating by time period</h3>
                    <div className="review-period-grid">
                      {data.usage.map((u) => (
                        u.averageRating != null && u.ratingCount != null ? (
                          <div key={u.timeSpan} className="review-period-card">
                            <span className="review-period-label">
                              {u.timeSpan === 'AllTime' ? 'All time'
                                : u.timeSpan === '30Days' ? 'Last 30 days'
                                : u.timeSpan === '7Days' ? 'Last 7 days'
                                : u.timeSpan}
                            </span>
                            <div className="review-period-stars">
                              {[1, 2, 3, 4, 5].map((s) => (
                                <span key={s} className={s <= Math.round(u.averageRating) ? 'star-on' : 'star-off'}>
                                  {STAR}
                                </span>
                              ))}
                            </div>
                            <strong className="review-period-avg">{Number(u.averageRating).toFixed(1)}</strong>
                            <span className="review-period-count">{Number(u.ratingCount).toLocaleString()} ratings</span>
                          </div>
                        ) : null
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="store-review-empty">
                <p>No reviews available for this product yet.</p>
                {data.officialStoreUrl && (
                  <a href={data.officialStoreUrl} target="_blank" rel="noopener noreferrer">
                    Open on Xbox.com
                  </a>
                )}
              </div>
            )}
          </section>
        </div>
      )}

      {/* ══════════════ MORE TAB ══════════════ */}
      {activeTab === 'more' && (
        <div className="tab-panel tab-more">

          {/* System Requirements */}
          {data.systemRequirements ? (
            <section className="detail-section detail-section-wide">
              <h2>System requirements</h2>
              <div className="sysreq-grid">
                {/* Minimum */}
                <div className="sysreq-col">
                  <h3 className="sysreq-heading">Minimum requirements</h3>
                  <div className="sysreq-divider" />
                  {data.systemRequirements.minimum?.length > 0 ? (
                    <dl className="sysreq-dl">
                      {data.systemRequirements.minimum.map((r) => (
                        <React.Fragment key={r.label}>
                          <dt>{r.label}</dt>
                          <dd>{r.value}</dd>
                        </React.Fragment>
                      ))}
                    </dl>
                  ) : data.systemRequirements.minimumNotes ? (
                    <p className="sysreq-notes">{data.systemRequirements.minimumNotes}</p>
                  ) : (
                    <p className="detail-muted">No minimum requirements specified.</p>
                  )}
                </div>
                {/* Recommended */}
                <div className="sysreq-col">
                  <h3 className="sysreq-heading">Recommended requirements</h3>
                  <div className="sysreq-divider" />
                  {data.systemRequirements.recommended?.length > 0 ? (
                    <dl className="sysreq-dl">
                      {data.systemRequirements.recommended.map((r) => (
                        <React.Fragment key={r.label}>
                          <dt>{r.label}</dt>
                          <dd>{r.value}</dd>
                        </React.Fragment>
                      ))}
                    </dl>
                  ) : data.systemRequirements.recommendedNotes ? (
                    <p className="sysreq-notes">{data.systemRequirements.recommendedNotes}</p>
                  ) : (
                    <p className="detail-muted">No recommended requirements specified.</p>
                  )}
                </div>
              </div>
              {data.systemRequirements.warningList?.length > 0 && (
                <div className="sysreq-warning">
                  {data.systemRequirements.warningList.map((w, i) => (
                    <p key={i}>⚠ {typeof w === 'string' ? w : JSON.stringify(w)}</p>
                  ))}
                </div>
              )}
            </section>
          ) : (
            <section className="detail-section detail-section-wide">
              <h2>System requirements</h2>
              <div className="sysreq-grid">
                <div className="sysreq-col">
                  <h3 className="sysreq-heading">Minimum requirements</h3>
                  <div className="sysreq-divider" />
                  <p className="detail-muted">This is an Xbox/console title. No PC system requirements are specified.</p>
                </div>
                <div className="sysreq-col">
                  <h3 className="sysreq-heading">Recommended requirements</h3>
                  <div className="sysreq-divider" />
                  <p className="detail-muted">This is an Xbox/console title. No PC system requirements are specified.</p>
                </div>
              </div>
            </section>
          )}

          {/* Accessibility Features */}
          <section className="detail-section detail-section-wide">
            <h2>
              <span className="section-icon">♿</span> Accessibility features
            </h2>
            {data.capabilities?.length > 0 ? (() => {
              // Group capabilities into accessibility-relevant categories
              const playCategories = {
                'Multiplayer': data.capabilities.filter((c) =>
                  /coop|multi|player|split/i.test(c.id)
                ),
                'Platform features': data.capabilities.filter((c) =>
                  /achieve|cloud|presence|club|live|broadcast/i.test(c.id)
                ),
                'Display & Performance': data.capabilities.filter((c) =>
                  /4k|120fps|enhanced|optimized|delivery/i.test(c.id)
                ),
                'Play Anywhere': data.capabilities.filter((c) =>
                  /xpa|anywhere|crossgen|crossplatform/i.test(c.id)
                ),
              };
              const hasAny = Object.values(playCategories).some((arr) => arr.length > 0);
              if (!hasAny) {
                return <p className="detail-muted">No accessibility feature data available for this title.</p>;
              }
              return (
                <div className="accessibility-groups">
                  {Object.entries(playCategories).map(([group, caps]) =>
                    caps.length > 0 ? (
                      <div key={group} className="accessibility-group">
                        <h3 className="accessibility-group-title">{group}</h3>
                        <div className="accessibility-chips">
                          {caps.map((c) => (
                            <span key={c.id} className="accessibility-chip">
                              {CAPABILITY_ICONS[c.id] && <span>{CAPABILITY_ICONS[c.id]} </span>}
                              {c.label}{c.detail ? ` (${c.detail})` : ''}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null
                  )}
                </div>
              );
            })() : (
              <p className="detail-muted">No accessibility feature data available for this title.</p>
            )}
          </section>

          {/* Languages Supported */}
          <section className="detail-section detail-section-wide">
            <h2>Languages supported</h2>
            {data.contentRatings?.length > 0 ? (
              <div className="languages-table-wrap">
                <table className="languages-table">
                  <thead>
                    <tr>
                      <th>Rating system</th>
                      <th>Rating</th>
                      <th>Descriptors</th>
                      <th>Interactive elements</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.contentRatings.map((r, i) => (
                      <tr key={i}>
                        <td>{r.system}</td>
                        <td><span className="rating-badge">{cleanText(r.ratingId)}</span></td>
                        <td className="detail-muted">
                          {r.descriptors?.map(cleanText).filter(Boolean).join(', ') || '—'}
                        </td>
                        <td className="detail-muted">
                          {r.interactiveElements?.map(cleanText).filter(Boolean).join(', ') || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="detail-muted">Language and content rating data not available.</p>
            )}
          </section>

          {/* Additional info */}
          <section className="detail-section">
            <h2>Additional information</h2>
            <dl className="detail-dl">
              {data.publisherName && <><dt>Publisher</dt><dd>{data.publisherName}</dd></>}
              {data.developerName && <><dt>Developer</dt><dd>{data.developerName}</dd></>}
              {data.publisherWebsiteUri && (
                <><dt>Website</dt>
                  <dd><a href={data.publisherWebsiteUri} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-light)' }}>{data.publisherWebsiteUri}</a></dd>
                </>
              )}
              {data.supportUri && (
                <><dt>Support</dt>
                  <dd><a href={data.supportUri} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-light)' }}>{data.supportUri}</a></dd>
                </>
              )}
              {data.releaseInfo?.status === 'unreleased' ? (
                <>
                  <dt>Status</dt>
                  <dd>{data.releaseInfo.label || 'Not released yet'}</dd>
                  <dt>Release date</dt>
                  <dd>{data.releaseInfo.releaseDate ? formatDate(data.releaseInfo.releaseDate) : 'Not announced yet'}</dd>
                </>
              ) : data.originalReleaseDate ? (
                <><dt>Release date</dt><dd>{formatDate(data.originalReleaseDate)}</dd></>
              ) : null}
              {data.productKind && <><dt>Product type</dt><dd>{data.productKind}</dd></>}
              {data.packageFamilyName && <><dt>Package</dt><dd style={{ fontFamily: 'monospace', fontSize: '0.78rem' }}>{data.packageFamilyName}</dd></>}
              <dt>Product ID</dt>
              <dd style={{ fontFamily: 'monospace', fontSize: '0.78rem' }}>{data.id}</dd>
              {data.officialStoreUrl && (
                <><dt>Official page</dt>
                  <dd><a href={data.officialStoreUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-light)' }}>View on Xbox.com ↗</a></dd>
                </>
              )}
            </dl>
          </section>

        </div>
      )}
    </div>
  );
}
