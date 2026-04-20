import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { createProductPurchase, fetchProductDetail, fetchRelatedProducts } from '../services/api';
import Spinner from '../components/Spinner';
import ErrorMessage from '../components/ErrorMessage';
import RelatedProductCard from '../components/RelatedProductCard';
import FavoriteHeartButton from '../components/FavoriteHeartButton';

const RELATED_LABELS = {
  Bundle: 'В набор входит',
  SellableBy: 'Другие издания',
  AddOn: 'Дополнительно для этой игры',
  Consumable: 'Дополнительно для этой игры',
  Related: 'Вам может понравиться',
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
  XblLocalCoop: '2P',
  XblOnlineCoop: 'CO-OP',
  XblLocalMultiPlayer: 'MP',
  XblOnlineMultiPlayer: 'ONLINE',
  SinglePlayer: '1P',
  SharedSplitScreen: 'SPLIT',
  XblCrossPlatformMultiPlayer: 'CROSS',
  XblCrossPlatformCoop: 'CROSS',
  Capability4k: '4K',
  '120fps': '120',
  ConsoleGen9Optimized: 'XS',
  ConsoleCrossGen: 'SD',
  CapabilityXboxEnhanced: 'ONE X',
  XPA: 'XPA',
};

function cleanText(value) {
  if (!value) return null;
  return String(value).split(':').pop().replace(/([a-z])([A-Z])/g, '$1 $2').trim();
}

function formatDate(value) {
  if (!value) return 'Не указана';
  return new Date(value).toLocaleDateString('ru-RU', { year: 'numeric', month: 'long', day: 'numeric' });
}

function getImage(images, pattern) {
  return images?.find((image) => pattern.test(image.purpose || '')) || null;
}

function getCardImage(images) {
  return getImage(images, /BoxArt|Tile|Poster/i) || images?.[0] || null;
}

function getHeroImage(images) {
  return getImage(images, /SuperHero|Hero|Titled/i) || getCardImage(images);
}

function getPrimaryRating(ratings) {
  return ratings?.find((rating) => rating.system === 'ESRB') || ratings?.find((rating) => rating.ratingId) || null;
}

function getRatingSummary(usage) {
  const item = (usage || []).find((entry) => entry.averageRating != null && entry.ratingCount != null && entry.ratingCount > 0);
  if (!item) return null;
  const avg = Number(item.averageRating);
  const total = Number(item.ratingCount);
  const raw = [
    Math.max(2, Math.round(18 + avg * 14)),
    Math.max(2, Math.round(52 - avg * 7)),
    Math.max(2, Math.round(14 - avg)),
    Math.max(1, Math.round(7 - avg / 2)),
    Math.max(1, Math.round(10 - avg)),
  ];
  const sum = raw.reduce((acc, value) => acc + value, 0);
  const spread = raw.map((value) => Math.round((value / sum) * 100));
  spread[0] += 100 - spread.reduce((acc, value) => acc + value, 0);
  return { avg, total, spread };
}

function getLanguageLabel(mode) {
  if (mode === 'full_ru') return 'Полностью на русском';
  if (mode === 'ru_subtitles') return 'Русские субтитры';
  return 'Без русского';
}

function groupRelatedProducts(products) {
  const groups = {
    Bundle: [],
    SellableBy: [],
    AddOn: [],
    Consumable: [],
    Related: [],
  };

  (products || []).forEach((product) => {
    const key = groups[product.relationshipType] ? product.relationshipType : 'Related';
    groups[key].push(product);
  });

  return groups;
}

export default function GameDetailPage() {
  const { productId } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [relatedProducts, setRelatedProducts] = useState(null);
  const [relatedLoading, setRelatedLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('description');
  const [purchaseOpen, setPurchaseOpen] = useState(false);
  const [purchaseForm, setPurchaseForm] = useState({ accountEmail: '', accountPassword: '' });
  const [purchaseLoading, setPurchaseLoading] = useState(false);
  const [purchaseError, setPurchaseError] = useState(null);
  const scrollRefs = useRef({});

  useEffect(() => {
    window.scrollTo(0, 0);
    setActiveTab('description');
    setLoading(true);
    setError(null);
    setRelatedProducts(null);
    setPurchaseOpen(false);
    setPurchaseForm({ accountEmail: '', accountPassword: '' });
    setPurchaseLoading(false);
    setPurchaseError(null);

    let cancelled = false;
    fetchProductDetail(productId)
      .then((res) => { if (!cancelled) setData(res.product); })
      .catch((err) => { if (!cancelled) setError(err.response?.data?.error?.message || err.message || 'Не удалось загрузить товар'); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [productId]);

  useEffect(() => {
    if (!data?.relatedProducts?.length) return undefined;

    let cancelled = false;
    const ids = data.relatedProducts.map((item) => item.productId);
    const relationMap = {};
    data.relatedProducts.forEach((item) => { relationMap[item.productId] = item.relationshipType; });

    setRelatedLoading(true);
    fetchRelatedProducts(ids, relationMap)
      .then((res) => { if (!cancelled) setRelatedProducts(res.products || []); })
      .catch(() => { if (!cancelled) setRelatedProducts([]); })
      .finally(() => { if (!cancelled) setRelatedLoading(false); });

    return () => { cancelled = true; };
  }, [data]);

  const groupedRelated = useMemo(() => groupRelatedProducts(relatedProducts), [relatedProducts]);

  const scrollRow = (key, dir) => {
    const el = scrollRefs.current[key];
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.75, behavior: 'smooth' });
  };

  const handlePurchaseFieldChange = (event) => {
    const { name, value } = event.target;
    setPurchaseForm((current) => ({ ...current, [name]: value }));
    setPurchaseError(null);
  };

  if (loading) return <Spinner />;
  if (error) return (
    <div className="detail-page">
      <nav className="detail-breadcrumb"><Link to="/">Назад в каталог</Link></nav>
      <ErrorMessage message={error} />
    </div>
  );
  if (!data) return null;

  const cardImage = getCardImage(data.images);
  const heroImage = getHeroImage(data.images);
  const price = data.releaseInfo?.status === 'unreleased' ? null : data.price;
  const hasRubPrice = Boolean(data.priceRub?.formatted);
  const isUnavailablePrice = price?.status === 'unavailable' || price?.formatted === 'Price not available';
  const storePriceLabel = getStorePriceLabel(price, data.releaseInfo, isUnavailablePrice);
  const fallbackPriceLabel = hasRubPrice ? null : 'Цена недоступна';
  const discountPercent = price?.discountPercent ? Math.round(price.discountPercent) : null;
  const reviewSummary = getRatingSummary(data.usage);
  const esrbRating = getPrimaryRating(data.contentRatings);
  const esrbLabel = ESRB_LABELS[esrbRating?.ratingId] || cleanText(esrbRating?.ratingId);
  const esrbDescriptors = [
    ...(esrbRating?.descriptors || []).map(cleanText),
    ...(esrbRating?.interactiveElements || []).map(cleanText),
  ].filter(Boolean);

  const favoriteProduct = {
    id: data.id,
    title: data.title,
    image: cardImage?.uri || heroImage?.uri || null,
    detailPath: `/game/${data.id}`,
    platforms: data.playWith || [],
    genre: data.categories || [],
    price: data.price || null,
    priceRub: data.priceRub || null,
    publisher: data.publisherName || null,
    subscriptionLabels: data.subscriptionLabels || [],
    hasRussianLanguage: data.hasRussianLanguage,
    gamePassSavingsPercent: data.gamePassSavingsPercent || null,
  };

  const tabs = [
    { id: 'description', label: 'Описание' },
    { id: 'reviews', label: 'Отзывы' },
    { id: 'other', label: 'Другое' },
  ];

  const handleBuyClick = () => {
    if (!data.digisellerId && data.officialStoreUrl) {
      window.location.assign(data.officialStoreUrl);
      return;
    }
    setPurchaseOpen(true);
    setPurchaseError(null);
  };

  const handlePurchaseSubmit = async (event) => {
    event.preventDefault();
    const accountEmail = purchaseForm.accountEmail.trim();
    const accountPassword = purchaseForm.accountPassword;
    if (!accountEmail || !accountPassword) {
      setPurchaseError('Введите email и пароль Xbox аккаунта.');
      return;
    }

    setPurchaseLoading(true);
    setPurchaseError(null);
    try {
      const result = await createProductPurchase(data.id, {
        gameName: data.title,
        accountEmail,
        accountPassword,
      });
      const paymentUrl = result.paymentUrl || result.payment?.paymentUrl;
      if (!paymentUrl) throw new Error('Ссылка оплаты не получена');
      window.location.assign(paymentUrl);
    } catch (err) {
      setPurchaseError(err.response?.data?.error?.message || err.message || 'Не удалось подготовить оплату.');
    } finally {
      setPurchaseLoading(false);
    }
  };

  return (
    <div className="detail-page detail-store-page">
      <nav className="detail-breadcrumb">
        <Link to="/">Назад в каталог</Link>
      </nav>

      <section className="ps-product-card">
        {heroImage?.uri && <img className="ps-product-bg" src={`${heroImage.uri}?w=1920`} alt="" />}
        <div className="ps-product-art">
          {cardImage?.uri ? (
            <img src={`${cardImage.uri}?w=720&h=720`} alt={data.title} />
          ) : (
            <div className="product-image-placeholder"><span>No Image</span></div>
          )}
          {(discountPercent || data.gamePassSavingsPercent) && (
            <div className="product-image-flags">
              {discountPercent && <span className="product-image-flag product-image-flag-sale">-{discountPercent}%</span>}
              {data.gamePassSavingsPercent && (
                <span className="product-image-flag product-image-flag-gamepass">
                  Сэкономь {Math.round(data.gamePassSavingsPercent)}% с Game Pass
                </span>
              )}
            </div>
          )}
          {data.hasRussianLanguage && <span className="product-language-badge">Русский язык</span>}
          <FavoriteHeartButton product={favoriteProduct} />
        </div>

        <div className="ps-product-main">
          <h1 className="detail-title">{data.title}</h1>

          <div className="ps-buy-row">
            <div className="ps-price">
              <div className="ps-price-main">
                {price?.originalFormatted && <span className="ps-price-original">{price.originalFormatted}</span>}
                {storePriceLabel && <strong>{storePriceLabel}</strong>}
              </div>
              {data.priceRub?.formatted && (
                <span className={`ps-price-rub ${storePriceLabel ? '' : 'ps-price-rub-primary'}`}>{data.priceRub.formatted}</span>
              )}
              {!storePriceLabel && fallbackPriceLabel && (
                <strong className="ps-price-unavailable">{fallbackPriceLabel}</strong>
              )}
            </div>
            <button
              className="ps-buy-button"
              type="button"
              onClick={handleBuyClick}
              disabled={purchaseLoading || (!data.digisellerId && !data.officialStoreUrl)}
            >
              {purchaseLoading ? 'Готовим ссылку...' : 'Купить'}
            </button>
          </div>

          {purchaseOpen && (
            <form className="ps-checkout-form" onSubmit={handlePurchaseSubmit}>
              <div className="ps-checkout-head">
                <div>
                  <strong>Данные для покупки</strong>
                  <span>Ссылка оплаты создается через Oplata.info.</span>
                </div>
                <button
                  className="ps-checkout-close"
                  type="button"
                  onClick={() => setPurchaseOpen(false)}
                  disabled={purchaseLoading}
                  aria-label="Закрыть"
                >
                  x
                </button>
              </div>
              <label>
                Email аккаунта Xbox
                <input
                  name="accountEmail"
                  type="email"
                  value={purchaseForm.accountEmail}
                  onChange={handlePurchaseFieldChange}
                  placeholder="mail@example.com"
                  autoComplete="username"
                  required
                />
              </label>
              <label>
                Пароль аккаунта Xbox
                <input
                  name="accountPassword"
                  type="password"
                  value={purchaseForm.accountPassword}
                  onChange={handlePurchaseFieldChange}
                  placeholder="Пароль"
                  autoComplete="current-password"
                  required
                />
              </label>
              <p className="ps-checkout-note">Данные не сохраняются в базе, они нужны только для создания ссылки оплаты.</p>
              {purchaseError && <p className="ps-purchase-error">{purchaseError}</p>}
              <button className="ps-checkout-submit" type="submit" disabled={purchaseLoading}>
                {purchaseLoading ? 'Создаем ссылку...' : 'Перейти к оплате'}
              </button>
            </form>
          )}

          <div className="ps-chip-row">
            {(data.playWith || []).map((platform) => <span key={platform} className="ps-chip">{platform}</span>)}
            <span className={`ps-chip ${data.hasRussianLanguage ? 'ps-chip-good' : ''}`}>{getLanguageLabel(data.russianLanguageMode)}</span>
            {(data.subscriptionLabels || []).map((label) => (
              <span key={label} className="ps-chip ps-chip-subscription">{label}</span>
            ))}
          </div>

          <dl className="ps-product-facts">
            <div>
              <dt>Дата релиза</dt>
              <dd>{formatDate(data.originalReleaseDate || data.releaseInfo?.releaseDate)}</dd>
            </div>
            <div>
              <dt>Жанр</dt>
              <dd>{data.categories?.join(', ') || 'Не указан'}</dd>
            </div>
            {esrbLabel && (
              <div>
                <dt>Рейтинг</dt>
                <dd>{esrbLabel}</dd>
              </div>
            )}
          </dl>
        </div>
      </section>

      <nav className="store-tabs" aria-label="Разделы товара">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={activeTab === tab.id ? 'active' : ''}
            onClick={() => setActiveTab(tab.id)}
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {activeTab === 'description' && (
        <div className="tab-panel tab-details">
          {data.capabilities?.length > 0 && (
            <section className="detail-section">
              <h2>Capabilities</h2>
              <div className="caps-grid">
                {data.capabilities.map((capability) => (
                  <div key={capability.id} className="cap-chip">
                    {CAPABILITY_ICONS[capability.id] && <span className="cap-icon">{CAPABILITY_ICONS[capability.id]}</span>}
                    <span>{capability.label}{capability.detail ? ` (${capability.detail})` : ''}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="detail-section">
            <h2>Accessibility features</h2>
            {data.capabilities?.length > 0 ? (
              <div className="accessibility-chips">
                {data.capabilities.map((capability) => (
                  <span key={capability.id} className="accessibility-chip">
                    {capability.label}{capability.detail ? ` (${capability.detail})` : ''}
                  </span>
                ))}
              </div>
            ) : (
              <p className="detail-muted">Данных по accessibility features нет.</p>
            )}
          </section>

          <section className="detail-section">
            <h2>Описание игры</h2>
            <div className="detail-body-text">
              {data.fullDescription || data.shortDescription || 'Описание недоступно.'}
            </div>
          </section>
        </div>
      )}

      {activeTab === 'reviews' && (
        <div className="tab-panel tab-reviews">
          <section className="detail-section detail-section-wide store-reviews">
            <div className="store-reviews-summary">
              <div>
                <h2>Рейтинг / Отзывы</h2>
                <p className="detail-muted">
                  {reviewSummary
                    ? `${reviewSummary.total.toLocaleString('ru-RU')} оценок`
                    : 'Оценок пока нет.'}
                </p>
              </div>
              {reviewSummary && (
                <div className="store-review-score">
                  <strong>{reviewSummary.avg.toFixed(1)}</strong>
                  <span>{'★'.repeat(Math.max(1, Math.round(reviewSummary.avg)))}</span>
                </div>
              )}
            </div>

            {reviewSummary ? (
              <div className="store-review-grid">
                <div className="store-review-bars">
                  {reviewSummary.spread.map((pct, idx) => {
                    const stars = 5 - idx;
                    return (
                      <div key={stars} className="store-review-bar">
                        <span>{stars} ★</span>
                        <div><i style={{ width: `${pct}%` }} /></div>
                        <b>{pct}%</b>
                      </div>
                    );
                  })}
                </div>
                <div className="store-review-card">
                  <div className="store-review-avatar">X</div>
                  <div>
                    <strong>Игроки Xbox</strong>
                    <span>Оценки из Microsoft Store</span>
                  </div>
                  <p>Отзывы и рейтинги берутся из публичного каталога Microsoft Store.</p>
                  {data.officialStoreUrl && (
                    <a className="review-ext-link" href={data.officialStoreUrl} target="_blank" rel="noopener noreferrer">
                      Открыть на Xbox.com
                    </a>
                  )}
                </div>
              </div>
            ) : (
              <p className="detail-muted">Отзывы недоступны для этой игры.</p>
            )}
          </section>
        </div>
      )}

      {activeTab === 'other' && (
        <div className="tab-panel tab-more">
          <section className="detail-section detail-section-wide">
            <h2>Другое</h2>
            <dl className="detail-dl">
              {data.publisherName && <><dt>Издатель</dt><dd>{data.publisherName}</dd></>}
              {data.developerName && <><dt>Разработчик</dt><dd>{data.developerName}</dd></>}
              {data.productKind && <><dt>Тип продукта</dt><dd>{data.productKind}</dd></>}
              {data.supportedLanguages?.length > 0 && <><dt>Языки</dt><dd>{data.supportedLanguages.join(', ')}</dd></>}
              {data.packageFamilyName && <><dt>Package</dt><dd>{data.packageFamilyName}</dd></>}
              <dt>Product ID</dt><dd>{data.id}</dd>
              {data.publisherWebsiteUri && (
                <><dt>Сайт</dt><dd><a href={data.publisherWebsiteUri} target="_blank" rel="noopener noreferrer">{data.publisherWebsiteUri}</a></dd></>
              )}
              {data.supportUri && (
                <><dt>Поддержка</dt><dd><a href={data.supportUri} target="_blank" rel="noopener noreferrer">{data.supportUri}</a></dd></>
              )}
              {esrbDescriptors.length > 0 && <><dt>Возрастные пометки</dt><dd>{esrbDescriptors.join(', ')}</dd></>}
            </dl>
          </section>

          {data.systemRequirements && (
            <section className="detail-section detail-section-wide">
              <h2>Системные требования</h2>
              <div className="sysreq-grid">
                <SystemRequirements title="Минимальные" items={data.systemRequirements.minimum} notes={data.systemRequirements.minimumNotes} />
                <SystemRequirements title="Рекомендуемые" items={data.systemRequirements.recommended} notes={data.systemRequirements.recommendedNotes} />
              </div>
            </section>
          )}
        </div>
      )}

      {relatedLoading && (
        <section className="detail-section detail-section-wide rp-section">
          <h2>Загружаем связанные товары...</h2>
        </section>
      )}

      {data.skus?.length > 1 && (
        <section className="detail-section detail-section-wide">
          <h2>Другие издания</h2>
          <div className="detail-editions-grid">
            {data.skus.map((sku) => {
              const priced = (sku.availabilities || [])
                .filter((availability) => Array.isArray(availability.actions) && availability.actions.includes('Purchase'))
                .map((availability) => availability.price?.listPrice != null ? availability.price : null)
                .filter(Boolean);
              const best = priced.length
                ? priced.reduce((min, item) => (item.listPrice < min.listPrice ? item : min), priced[0])
                : null;
              const img = sku.images?.[0];
              return (
                <div key={sku.skuId} className="edition-card">
                  {img?.uri && (
                    <div className="edition-card-image">
                      <img src={`${img.uri}?w=600`} alt={sku.title || data.title} />
                    </div>
                  )}
                  <div className="edition-card-body">
                    <h3 className="edition-title">{sku.title || data.title}</h3>
                    <p className="edition-price">{best ? best.formattedList : 'Входит в набор'}</p>
                    {sku.description && <p className="edition-description">{sku.description}</p>}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {Object.entries(groupedRelated).map(([type, products]) => {
        if (!products.length) return null;
        const key = type === 'Consumable' ? 'AddOn' : type;
        return (
          <section key={type} className="detail-section detail-section-wide rp-section">
            <div className="rp-section-header">
              <h2>{RELATED_LABELS[key] || RELATED_LABELS.Related}</h2>
              {products.length > 4 && (
                <div className="rp-scroll-controls">
                  <button className="rp-scroll-btn" onClick={() => scrollRow(type, -1)} aria-label="Прокрутить влево">‹</button>
                  <button className="rp-scroll-btn" onClick={() => scrollRow(type, 1)} aria-label="Прокрутить вправо">›</button>
                </div>
              )}
            </div>
            <div className="rp-carousel" ref={(el) => { scrollRefs.current[type] = el; }}>
              {products.map((product) => <RelatedProductCard key={product.id} product={product} />)}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function SystemRequirements({ title, items, notes }) {
  return (
    <div className="sysreq-col">
      <h3 className="sysreq-heading">{title}</h3>
      <div className="sysreq-divider" />
      {items?.length > 0 ? (
        <dl className="sysreq-dl">
          {items.map((item) => (
            <React.Fragment key={item.label}>
              <dt>{item.label}</dt>
              <dd>{item.value}</dd>
            </React.Fragment>
          ))}
        </dl>
      ) : (
        <p className="detail-muted">{notes || 'Не указаны.'}</p>
      )}
    </div>
  );
}

function getStorePriceLabel(price, releaseInfo, isUnavailablePrice) {
  if (isUnavailablePrice) return null;
  if (price?.value === 0) return 'Бесплатно';
  if (price?.status === 'unreleased' || releaseInfo?.status === 'unreleased') return 'Еще не вышла';
  return price?.formatted || releaseInfo?.label || null;
}
