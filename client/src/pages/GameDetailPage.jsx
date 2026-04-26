import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { createProductPurchase, fetchProductDetail, fetchProfile, fetchRelatedProducts } from '../services/api';
import Spinner from '../components/Spinner';
import ErrorMessage from '../components/ErrorMessage';
import ProductCard from '../components/ProductCard';
import FavoriteHeartButton from '../components/FavoriteHeartButton';
import {
  PAYMENT_PRICE_ORDER,
  getPaymentOriginalPriceText,
  getPaymentPrice,
  getPaymentPriceEntries,
  getPaymentPriceLine,
} from '../utils/paymentPrices';

const RELATED_LABELS = {
  ProductAddOns: 'Дополнения для этой игры',
  MoreLike: 'Вам может понравиться',
  PeopleAlsoLike: 'Вам может понравиться',
  Bundle: 'Дополнения для этой игры',
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

const PAYMENT_MODES = [
  { id: 'special_offer', title: 'СПЕЦПРЕДЛОЖЕНИЕ', description: 'Специальное предложение', enabled: true },
  { id: 'oplata', title: 'ПОКУПКА НА АККАУНТ', description: 'Оплата на ваш Xbox-аккаунт', enabled: true },
  { id: 'key_activation', title: 'КЛЮЧ НА ИГРУ', description: 'Получить ключ и открыть чат с продавцом', enabled: true },
  { id: 'topup_cards', title: 'КАРТЫ ПОПОЛНЕНИЯ', description: 'Пополнить Xbox-баланс комбинацией карт', enabled: true },
];

const EMPTY_PURCHASE_FORM = {
  purchaseEmail: '',
  accountEmail: '',
  accountPassword: '',
  paymentMode: 'oplata',
  saveToProfile: false,
};

function readStoredUser() {
  try {
    return JSON.parse(localStorage.getItem('auth:user') || 'null');
  } catch {
    return null;
  }
}

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
    ProductAddOns: [],
    SellableBy: [],
    MoreLike: [],
    Related: [],
  };

  (products || []).forEach((product) => {
    const key = normalizeRelatedGroup(product.relationshipType);
    groups[key].push(product);
  });

  return groups;
}

function normalizeRelatedGroup(type) {
  if (type === 'ProductAddOns' || type === 'AddOn' || type === 'Consumable' || type === 'Bundle') {
    return 'ProductAddOns';
  }
  if (type === 'MoreLike' || type === 'PeopleAlsoLike') return 'MoreLike';
  if (type === 'SellableBy') return 'SellableBy';
  return 'Related';
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
  const [purchaseForm, setPurchaseForm] = useState(EMPTY_PURCHASE_FORM);
  const [purchaseProfile, setPurchaseProfile] = useState(null);
  const [purchaseProfileLoading, setPurchaseProfileLoading] = useState(false);
  const [purchaseCanSave, setPurchaseCanSave] = useState(false);
  const [purchaseLoading, setPurchaseLoading] = useState(false);
  const [purchaseError, setPurchaseError] = useState(null);
  const [purchaseResult, setPurchaseResult] = useState(null);
  const [copyMessage, setCopyMessage] = useState('');
  const scrollRefs = useRef({});

  useEffect(() => {
    window.scrollTo(0, 0);
    setActiveTab('description');
    setLoading(true);
    setError(null);
    setRelatedProducts(null);
    setPurchaseOpen(false);
    setPurchaseForm(EMPTY_PURCHASE_FORM);
    setPurchaseProfile(null);
    setPurchaseProfileLoading(false);
    setPurchaseCanSave(false);
    setPurchaseLoading(false);
    setPurchaseError(null);
    setPurchaseResult(null);
    setCopyMessage('');

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
    const { name, value, type, checked } = event.target;
    setPurchaseForm((current) => ({ ...current, [name]: type === 'checkbox' ? checked : value }));
    setPurchaseError(null);
    setCopyMessage('');
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
  const gamePassSavingsBadgePercent = Number(data.gamePassSavingsPercent) > 0
    ? Math.round(Number(data.gamePassSavingsPercent))
    : null;
  const paymentPriceEntries = getPaymentPriceEntries(data, { includeUnavailable: true });
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
    paymentPrices: data.paymentPrices || null,
    topupCombo: data.topupCombo || null,
    publisher: data.publisherName || null,
    subscriptionLabels: data.subscriptionLabels || [],
    hasRussianLanguage: data.hasRussianLanguage,
    russianLanguageMode: data.russianLanguageMode,
    gamePassSavingsPercent: data.gamePassSavingsPercent || null,
  };

  const tabs = [
    { id: 'description', label: 'Описание' },
    { id: 'reviews', label: 'Отзывы' },
    { id: 'other', label: 'Другое' },
  ];

  const purchaseSettings = purchaseProfile?.purchaseSettings || {};
  const purchaseUser = purchaseProfile?.user || null;
  const registrationEmail = purchaseUser?.email || '';
  const canUseTelegramDelivery = purchaseUser?.provider === 'telegram';
  const hasSavedPurchaseEmail = Boolean(purchaseSettings.purchaseEmail);
  const hasSavedAccountEmail = Boolean(purchaseSettings.xboxAccountEmail);
  const hasSavedAccountPassword = Boolean(purchaseSettings.hasXboxAccountPassword);
  const isKeyActivationMode = purchaseForm.paymentMode === 'key_activation';
  const isTopupMode = purchaseForm.paymentMode === 'topup_cards';
  const isSpecialOfferMode = purchaseForm.paymentMode === 'special_offer';
  const skipAccountFields = isKeyActivationMode || isTopupMode || isSpecialOfferMode;
  const needsPurchaseEmail = !hasSavedPurchaseEmail && !registrationEmail && !canUseTelegramDelivery;
  const needsAccountEmail = !skipAccountFields && !hasSavedAccountEmail;
  const needsAccountPassword = !skipAccountFields && !hasSavedAccountPassword;
  const hasMissingPurchaseFields = needsPurchaseEmail || needsAccountEmail || needsAccountPassword;
  const selectedPaymentPrice = getPaymentPrice(data, purchaseForm.paymentMode);
  const selectedPaymentFallback = purchaseForm.paymentMode === 'oplata'
    ? data.priceRub?.formatted || storePriceLabel || 'Цена будет рассчитана перед оплатой'
    : 'Цена будет рассчитана перед оплатой';
  const selectedPaymentPriceLine = getPaymentPriceLine(
    selectedPaymentPrice,
    selectedPaymentFallback,
  );

  const handleBuyClick = async () => {
    if (!data.digisellerId && data.officialStoreUrl) {
      window.location.assign(data.officialStoreUrl);
      return;
    }
    const storedUser = readStoredUser();
    setPurchaseOpen(true);
    setPurchaseResult(null);
    setPurchaseError(null);
    setCopyMessage('');
    setPurchaseProfile(null);
    setPurchaseCanSave(Boolean(storedUser));
    setPurchaseForm({ ...EMPTY_PURCHASE_FORM, saveToProfile: Boolean(storedUser) });

    if (!storedUser) return;
    setPurchaseProfileLoading(true);
    try {
      const profile = await fetchProfile();
      const settings = profile.purchaseSettings || {};
      setPurchaseProfile(profile);
      const hasPurchaseDelivery = Boolean(settings.purchaseEmail || profile.user?.email || profile.user?.provider === 'telegram');
      const settingsMissing = !hasPurchaseDelivery || !settings.xboxAccountEmail || !settings.hasXboxAccountPassword;
      setPurchaseForm((current) => ({
        ...current,
        paymentMode: settings.paymentMode || 'oplata',
        saveToProfile: settingsMissing,
      }));
    } catch {
      setPurchaseProfile(null);
      setPurchaseCanSave(false);
      setPurchaseForm((current) => ({ ...current, saveToProfile: false }));
    } finally {
      setPurchaseProfileLoading(false);
    }
  };

  const handlePurchaseSubmit = async (event) => {
    event.preventDefault();
    const purchaseEmail = purchaseForm.purchaseEmail.trim();
    const accountEmail = purchaseForm.accountEmail.trim();
    const accountPassword = purchaseForm.accountPassword;
    if (needsPurchaseEmail && !purchaseEmail) {
      setPurchaseError('Введите email для покупки.');
      return;
    }
    if (needsAccountEmail && !accountEmail) {
      setPurchaseError('Введите email аккаунта Xbox.');
      return;
    }
    if (needsAccountPassword && !accountPassword) {
      setPurchaseError('Введите пароль аккаунта Xbox.');
      return;
    }

    if (isSpecialOfferMode) {
      if (!data.specialOfferUrl) {
        setPurchaseError('Ссылка спецпредложения недоступна.');
        return;
      }
      setPurchaseResult({ paymentUrl: data.specialOfferUrl });
      return;
    }

    setPurchaseLoading(true);
    setPurchaseError(null);
    setPurchaseResult(null);
    setCopyMessage('');
    try {
      const result = await createProductPurchase(data.id, {
        gameName: data.title,
        purchaseEmail: needsPurchaseEmail ? purchaseEmail : undefined,
        accountEmail: needsAccountEmail ? accountEmail : undefined,
        accountPassword: needsAccountPassword ? accountPassword : undefined,
        paymentMode: purchaseForm.paymentMode,
        saveToProfile: purchaseCanSave && purchaseForm.saveToProfile,
      });
      const paymentUrl = result.paymentUrl || result.payment?.paymentUrl;
      if (!paymentUrl) throw new Error('Ссылка оплаты не получена');
      setPurchaseResult({ ...result.payment, paymentUrl });
    } catch (err) {
      setPurchaseError(err.response?.data?.error?.message || err.message || 'Не удалось подготовить оплату.');
    } finally {
      setPurchaseLoading(false);
    }
  };

  const handleCopyPaymentLink = async () => {
    if (!purchaseResult?.paymentUrl) return;
    try {
      await navigator.clipboard.writeText(purchaseResult.paymentUrl);
      setCopyMessage('Ссылка скопирована');
    } catch {
      const input = document.createElement('textarea');
      input.value = purchaseResult.paymentUrl;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      setCopyMessage('Ссылка скопирована');
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
          <span className={`product-language-badge product-language-badge--${getLanguageClassSuffix(data.russianLanguageMode, data.hasRussianLanguage)}`}>
            {getLanguageDisplayLabel(data.russianLanguageMode, data.hasRussianLanguage)}
          </span>
          <FavoriteHeartButton product={favoriteProduct} />
        </div>

        <div className="ps-product-main">
          <h1 className="detail-title">{data.title}</h1>

          <div className="ps-buy-row">
            <div className="ps-price">
              <div className="ps-price-main">
                {discountPercent && <span className="price-discount-badge">-{discountPercent}%</span>}
                {price?.originalFormatted && <span className="ps-price-original">{price.originalFormatted}</span>}
                {storePriceLabel && <strong>{storePriceLabel}</strong>}
                {gamePassSavingsBadgePercent && (
                  <span className="price-gamepass-badge price-gamepass-badge--after">
                    {getGamePassSavingsText(gamePassSavingsBadgePercent)}
                  </span>
                )}
              </div>
              {paymentPriceEntries.length > 0 && (
                <div className="payment-price-list payment-price-list--detail">
                  {paymentPriceEntries.map((paymentPrice) => (
                    <div className="payment-price-row" key={paymentPrice.id}>
                      <span style={paymentPrice.id === 'special_offer' ? { color: '#ac84f1' } : undefined}>
                        {paymentPrice.title}
                      </span>
                      <PaymentPriceAmount price={paymentPrice} />
                    </div>
                  ))}
                </div>
              )}
              {!paymentPriceEntries.length && data.priceRub?.formatted && (
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
              disabled={purchaseLoading || (!data.digisellerId && !data.officialStoreUrl && !data.keyActivationPayUrl && !data.specialOfferUrl)}
            >
              {purchaseLoading ? 'Готовим ссылку...' : 'Купить'}
            </button>
          </div>

          <div className="ps-chip-row">
            {(data.playWith || []).map((platform) => <span key={platform} className="ps-chip">{platform}</span>)}
            <span className={`ps-chip ps-chip-language ps-chip-language--${getLanguageClassSuffix(data.russianLanguageMode, data.hasRussianLanguage)}`}>
              {getLanguageDisplayLabel(data.russianLanguageMode, data.hasRussianLanguage)}
            </span>
            {(data.subscriptionLabels || []).map((label) => (
              <span key={label} className={getSubscriptionChipClass(label)}>{getDetailSubscriptionLabel(label)}</span>
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

      {purchaseOpen && (
        <div className="purchase-modal-backdrop" onClick={() => !purchaseLoading && setPurchaseOpen(false)}>
          <div className="purchase-modal" onClick={(event) => event.stopPropagation()}>
            <button
              className="purchase-modal-close"
              type="button"
              onClick={() => setPurchaseOpen(false)}
              disabled={purchaseLoading}
              aria-label="Закрыть"
            >
              x
            </button>

            <div className="purchase-modal-head">
              <p className="profile-kicker">Покупка</p>
              <h2>{data.title}</h2>
              <p>{selectedPaymentPriceLine}</p>
            </div>

            <form className="purchase-modal-form" onSubmit={handlePurchaseSubmit}>
              <section className="purchase-modal-section">
                <h3>Способ оплаты</h3>
                <div className="purchase-mode-grid">
                  {PAYMENT_MODES
                    .slice()
                    .filter((mode) => mode.id !== 'special_offer' || Boolean(data.specialOfferUrl))
                    .sort((a, b) => PAYMENT_PRICE_ORDER.indexOf(a.id) - PAYMENT_PRICE_ORDER.indexOf(b.id))
                    .map((mode) => {
                    let modeEnabled = mode.enabled;
                    if (mode.id === 'special_offer') modeEnabled = modeEnabled && Boolean(data.specialOfferUrl);
                    if (mode.id === 'key_activation') modeEnabled = modeEnabled && Boolean(data.keyActivationPayUrl);
                    if (mode.id === 'topup_cards') modeEnabled = modeEnabled && Boolean(data.topupCombo?.available);
                    const modePrice = getPaymentPrice(data, mode.id);
                    let subtitle = getPaymentPriceLine(modePrice, 'Цена будет рассчитана') || mode.description;
                    if (mode.id === 'key_activation' && !data.keyActivationPayUrl) subtitle = 'Недоступно для этого товара';
                    if (mode.id === 'topup_cards' && !data.topupCombo?.available) subtitle = 'Недоступно для этого товара';
                    return (
                      <label key={mode.id} className={`purchase-mode-card ${purchaseForm.paymentMode === mode.id ? 'active' : ''} ${modeEnabled ? '' : 'disabled'}`}>
                        <input
                          type="radio"
                          name="paymentMode"
                          value={mode.id}
                          checked={purchaseForm.paymentMode === mode.id}
                          onChange={handlePurchaseFieldChange}
                          disabled={!modeEnabled || purchaseLoading}
                        />
                        <span>
                          <strong style={mode.id === 'special_offer' ? { color: '#ac84f1' } : undefined}>{mode.title}</strong>
                          <small>{subtitle}</small>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </section>

              {isTopupMode && data.topupCombo?.available && (
                <section className="purchase-modal-section">
                  <h3>Комбинация карт</h3>
                  <p className="purchase-muted">
                    Покрытие цены {data.topupCombo.price} $ минимальным числом карт.
                    Вы оплатите каждую карту отдельно, активационные коды придут на вашу почту.
                  </p>
                  <div className="topup-combo-list">
                    {data.topupCombo.items.map((item) => (
                      <div key={item.usdValue} className="topup-combo-row">
                        <strong>${item.usdValue}</strong>
                        <span>×{item.count}</span>
                        <span className="topup-combo-subtotal">
                          {item.subtotalRubFormatted || (item.priceRub ? `≈${item.priceRub * item.count} ₽` : 'цена будет на Digiseller')}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="topup-combo-total">
                    <span>Итого {data.topupCombo.cardsCount} карт(ы)</span>
                    <strong>
                      {data.topupCombo.totalRubFormatted || 'цена рассчитается на Digiseller'}
                    </strong>
                  </div>
                  {data.topupCombo.substituted && (
                    <p className="purchase-muted">
                      Некоторых номиналов нет в наличии — подобрана альтернативная комбинация.
                    </p>
                  )}
                </section>
              )}

              <section className="purchase-modal-section">
                <h3>Данные</h3>
                {purchaseProfileLoading ? (
                  <p className="purchase-muted">Проверяем сохранённые данные профиля...</p>
                ) : (
                  <>
                    {!hasMissingPurchaseFields && (
                      <div className="purchase-saved-box">
                        <strong>Берём данные из профиля</strong>
                        <span>Почта покупки и аккаунт Xbox уже сохранены, повторно вводить их не нужно.</span>
                      </div>
                    )}

                    {hasSavedPurchaseEmail && (
                      <div className="purchase-data-row">
                        <span>Email для покупки</span>
                        <strong>{purchaseSettings.purchaseEmail}</strong>
                      </div>
                    )}
                    {!hasSavedPurchaseEmail && registrationEmail && (
                      <div className="purchase-data-row">
                        <span>Email регистрации</span>
                        <strong>{registrationEmail}</strong>
                      </div>
                    )}
                    {!hasSavedPurchaseEmail && !registrationEmail && canUseTelegramDelivery && (
                      <div className="purchase-data-row">
                        <span>Доставка ссылки</span>
                        <strong>Telegram</strong>
                      </div>
                    )}
                    {hasSavedAccountEmail && !skipAccountFields && (
                      <div className="purchase-data-row">
                        <span>Аккаунт Xbox</span>
                        <strong>{purchaseSettings.xboxAccountEmail}</strong>
                      </div>
                    )}
                    {hasSavedAccountPassword && !skipAccountFields && (
                      <div className="purchase-data-row">
                        <span>Пароль Xbox</span>
                        <strong>Сохранён в профиле</strong>
                      </div>
                    )}

                    {needsPurchaseEmail && (
                      <label>
                        Email для покупки
                        <input
                          name="purchaseEmail"
                          type="email"
                          value={purchaseForm.purchaseEmail}
                          onChange={handlePurchaseFieldChange}
                          placeholder="mail@example.com"
                          required
                        />
                      </label>
                    )}
                    {needsAccountEmail && (
                      <label>
                        Email аккаунта Xbox
                        <input
                          name="accountEmail"
                          type="email"
                          value={purchaseForm.accountEmail}
                          onChange={handlePurchaseFieldChange}
                          placeholder="xbox@example.com"
                          autoComplete="username"
                          required
                        />
                      </label>
                    )}
                    {needsAccountPassword && (
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
                    )}
                    {purchaseCanSave && hasMissingPurchaseFields && (
                      <label className="purchase-checkbox-row">
                        <input
                          name="saveToProfile"
                          type="checkbox"
                          checked={purchaseForm.saveToProfile}
                          onChange={handlePurchaseFieldChange}
                        />
                        Сохранить эти данные в профиль
                      </label>
                    )}
                  </>
                )}
              </section>

              {purchaseError && <p className="ps-purchase-error">{purchaseError}</p>}

              {purchaseResult?.paymentUrl && purchaseResult?.paymentType === 'topup_cards' ? (
                <div className="purchase-result">
                  <strong>{purchaseResult.cartBatch ? 'Корзина готова' : 'Ссылки готовы'}</strong>
                  <p>
                    {purchaseResult.cartBatch
                      ? 'Все карты добавлены в одну корзину — оплатите единой ссылкой.'
                      : 'Оплатите каждую карту отдельно.'}
                    {' '}Итого:{' '}
                    {purchaseResult.totalRubFormatted || `${purchaseResult.totalRub || ''} ₽`}
                    {' '}за {purchaseResult.cardsCount} карт(ы).
                  </p>
                  <div className="topup-combo-list">
                    {(purchaseResult.links || []).map((link) => (
                      <div key={link.usdValue} className="topup-combo-row">
                        <strong>${link.usdValue} × {link.count}</strong>
                        <span className="topup-combo-subtotal">
                          {link.subtotalRubFormatted || (link.priceRub ? `${link.priceRub * link.count} ₽` : '')}
                        </span>
                        {!purchaseResult.cartBatch && link.paymentUrl && (
                          <a
                            className="purchase-primary"
                            href={link.paymentUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Оплатить
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                  {purchaseResult.cartBatch && (
                    <div className="purchase-result-actions">
                      <button
                        className="purchase-primary"
                        type="button"
                        onClick={() => window.location.assign(purchaseResult.paymentUrl)}
                      >
                        Оплатить корзину
                      </button>
                      <button className="purchase-secondary" type="button" onClick={handleCopyPaymentLink}>
                        Копировать ссылку
                      </button>
                      {copyMessage && <span className="purchase-copy-message">{copyMessage}</span>}
                    </div>
                  )}
                </div>
              ) : purchaseResult?.paymentUrl ? (
                <div className="purchase-result">
                  <strong>Ссылка готова</strong>
                  <p>Можно открыть страницу оплаты или скопировать ссылку.</p>
                  <div className="purchase-result-actions">
                    <button
                      className="purchase-primary"
                      type="button"
                      onClick={() => window.location.assign(purchaseResult.paymentUrl)}
                    >
                      Открыть оплату
                    </button>
                    <button className="purchase-secondary" type="button" onClick={handleCopyPaymentLink}>
                      Копировать ссылку
                    </button>
                  </div>
                  {copyMessage && <span className="purchase-copy-message">{copyMessage}</span>}
                </div>
              ) : (
                <button
                  className="purchase-primary"
                  type="submit"
                  disabled={purchaseLoading || purchaseProfileLoading}
                >
                  {purchaseLoading ? 'Генерируем ссылку...' : isSpecialOfferMode ? 'Перейти к оплате' : 'Сгенерировать ссылку'}
                </button>
              )}
            </form>
          </div>
        </div>
      )}

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
            <div className="rp-carousel rp-catalog-carousel" ref={(el) => { scrollRefs.current[type] = el; }}>
              {products.map((product) => <ProductCard key={product.id} product={product} />)}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function PaymentPriceAmount({ price, fallback }) {
  const originalPriceText = getPaymentOriginalPriceText(price);
  return (
    <strong className="payment-price-amount">
      <span className="payment-price-current">{getPaymentPriceLine(price, fallback)}</span>
      {originalPriceText && <span className="payment-price-original">{originalPriceText}</span>}
    </strong>
  );
}

function getGamePassSavingsText(percent) {
  return `Сэкономь ${Math.round(Number(percent) || 0)}% с Game Pass`;
}

function getSubscriptionChipClass(label) {
  const normalized = String(label || '').toLowerCase();
  const modifiers = [];
  if (normalized.includes('ea play')) modifiers.push('ps-chip-subscription--ea-play');
  if (normalized.includes('ubisoft')) modifiers.push('ps-chip-subscription--ubisoft-plus');
  return ['ps-chip', 'ps-chip-subscription', ...modifiers].join(' ');
}

function getDetailSubscriptionLabel(label) {
  return String(label || '').trim().toLowerCase() === 'game pass' ? 'Ultimate' : label;
}

function getLanguageDisplayLabel(mode, hasRussian) {
  if (mode === 'unknown') return 'Язык не указан';
  if (mode === 'full_ru') return 'Полностью на русском';
  if (mode === 'ru_subtitles' || hasRussian) return 'Русские субтитры';
  return 'Без русского';
}

function getLanguageClassSuffix(mode, hasRussian) {
  if (mode === 'unknown') return 'unknown';
  if (mode === 'full_ru') return 'full-ru';
  if (mode === 'ru_subtitles' || hasRussian) return 'ru-subtitles';
  return 'no-ru';
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
