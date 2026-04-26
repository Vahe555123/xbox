import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCart } from '../context/CartContext';
import { createCartPurchase, fetchProfile } from '../services/api';
import {
  formatRub,
  getPaymentPrice,
} from '../utils/paymentPrices';

const PAYMENT_MODES = [
  { id: 'oplata', title: 'ПОКУПКА НА АККАУНТ', description: 'Оплата на ваш Xbox-аккаунт' },
  { id: 'key_activation', title: 'КЛЮЧ НА ИГРУ', description: 'Получить ключ и активировать' },
  { id: 'topup_cards', title: 'КОДОМ ПОПОЛНЕНИЯ БАЛАНСА', description: 'Пополнить Xbox-баланс комбинацией карт' },
];

const SPECIAL_OFFER_MODE = { id: 'special_offer', title: 'СПЕЦПРЕДЛОЖЕНИЕ', description: 'Спецпредложение для каждого товара' };

const EMPTY_FORM = {
  purchaseEmail: '',
  accountEmail: '',
  accountPassword: '',
  paymentMode: 'oplata',
};

function readStoredUser() {
  try {
    return JSON.parse(localStorage.getItem('auth:user') || 'null');
  } catch {
    return null;
  }
}

function getProductImage(product) {
  if (product?.image) return product.image;
  const images = product?.images || [];
  const preferred = images.find((i) => /BoxArt|Tile|FeaturePromotionalSquareArt/i.test(i.purpose || ''));
  return preferred?.uri || images[0]?.uri || null;
}

function computeTotal(items, modeId) {
  let total = 0;
  let allHave = true;
  let cardsCount = 0;
  for (const item of items) {
    const price = getPaymentPrice(item, modeId);
    if (!price?.available || !Number.isFinite(Number(price.value))) {
      allHave = false;
      break;
    }
    total += Number(price.value);
    if (modeId === 'topup_cards' && Number.isFinite(Number(price.cardsCount))) {
      cardsCount += Number(price.cardsCount);
    }
  }
  if (!allHave) return null;
  return {
    value: total,
    formatted: formatRub(total),
    cardsCount: modeId === 'topup_cards' ? cardsCount : null,
  };
}

function allHaveSpecialOffer(items) {
  if (!items.length) return false;
  return items.every((item) => Boolean(item.specialOfferUrl));
}

function paymentModeAvailable(items, modeId) {
  if (!items.length) return false;
  if (modeId === 'special_offer') return allHaveSpecialOffer(items);
  return items.every((item) => {
    const price = getPaymentPrice(item, modeId);
    return Boolean(price?.available);
  });
}

export default function CartPage({ currentUser, onLoginClick }) {
  const { items, count, remove, clear, hydrating } = useCart();
  const [form, setForm] = useState(EMPTY_FORM);
  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [purchaseOpen, setPurchaseOpen] = useState(false);
  const [purchaseLoading, setPurchaseLoading] = useState(false);
  const [purchaseError, setPurchaseError] = useState(null);
  const [purchaseResult, setPurchaseResult] = useState(null);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const totals = useMemo(() => {
    const modes = [];
    if (allHaveSpecialOffer(items)) modes.push({ ...SPECIAL_OFFER_MODE, total: null });
    for (const mode of PAYMENT_MODES) {
      modes.push({ ...mode, total: computeTotal(items, mode.id) });
    }
    return modes;
  }, [items]);

  const purchaseSettings = profile?.purchaseSettings || {};
  const profileUser = profile?.user || null;
  const registrationEmail = profileUser?.email || '';
  const canUseTelegramDelivery = profileUser?.provider === 'telegram';
  const hasSavedPurchaseEmail = Boolean(purchaseSettings.purchaseEmail);
  const hasSavedAccountEmail = Boolean(purchaseSettings.xboxAccountEmail);
  const hasSavedAccountPassword = Boolean(purchaseSettings.hasXboxAccountPassword);

  const isOplata = form.paymentMode === 'oplata';
  const isKey = form.paymentMode === 'key_activation';
  const isTopup = form.paymentMode === 'topup_cards';
  const isSpecial = form.paymentMode === 'special_offer';
  const skipAccountFields = isKey || isTopup || isSpecial;
  const needsPurchaseEmail = !hasSavedPurchaseEmail && !registrationEmail && !canUseTelegramDelivery;
  const needsAccountEmail = !skipAccountFields && !hasSavedAccountEmail;
  const needsAccountPassword = !skipAccountFields && !hasSavedAccountPassword;
  const cartSupportsServer = isOplata || isKey;

  const handleField = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
    setPurchaseError(null);
  };

  const openPurchase = async (modeId) => {
    setPurchaseError(null);
    setPurchaseResult(null);
    setForm({ ...EMPTY_FORM, paymentMode: modeId });
    setPurchaseOpen(true);

    if (!currentUser) return;
    setProfileLoading(true);
    try {
      const fetched = await fetchProfile();
      setProfile(fetched);
      const settings = fetched.purchaseSettings || {};
      setForm((current) => ({ ...current, paymentMode: modeId || settings.paymentMode || 'oplata' }));
    } catch {
      setProfile(null);
    } finally {
      setProfileLoading(false);
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!cartSupportsServer) {
      setPurchaseError('Этот способ оплаты пока не поддерживает покупку всей корзиной.');
      return;
    }
    if (needsPurchaseEmail && !form.purchaseEmail.trim()) {
      setPurchaseError('Введите email для покупки.');
      return;
    }
    if (needsAccountEmail && !form.accountEmail.trim()) {
      setPurchaseError('Введите email аккаунта Xbox.');
      return;
    }
    if (needsAccountPassword && !form.accountPassword) {
      setPurchaseError('Введите пароль аккаунта Xbox.');
      return;
    }

    setPurchaseLoading(true);
    setPurchaseError(null);
    try {
      const productIds = items.map((item) => item.id);
      const result = await createCartPurchase({
        productIds,
        paymentMode: form.paymentMode,
        purchaseEmail: needsPurchaseEmail ? form.purchaseEmail.trim() : undefined,
        accountEmail: needsAccountEmail ? form.accountEmail.trim() : undefined,
        accountPassword: needsAccountPassword ? form.accountPassword : undefined,
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

  const closePurchase = () => {
    if (purchaseLoading) return;
    setPurchaseOpen(false);
    setPurchaseResult(null);
    setPurchaseError(null);
  };

  if (count === 0) {
    return (
      <div className="cart-page">
        <h1 className="cart-page-title">Корзина</h1>
        <div className="cart-empty">
          <p>В корзине пока ничего нет.</p>
          <Link to="/" className="cart-back-link">Перейти в каталог</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="cart-page">
      <h1 className="cart-page-title">Корзина</h1>
      <p className="cart-count-bar">
        В корзине <strong>{count}</strong> {count === 1 ? 'товар' : 'товаров'}
        {hydrating && ' (обновляем цены...)'}
      </p>

      <div className="cart-layout">
        <div className="cart-items">
          {items.map((item) => {
            const image = getProductImage(item);
            const oplata = getPaymentPrice(item, 'oplata');
            const key = getPaymentPrice(item, 'key_activation');
            const topup = getPaymentPrice(item, 'topup_cards');
            const special = getPaymentPrice(item, 'special_offer');
            return (
              <div className="cart-row" key={item.id}>
                <Link to={`/game/${item.id}`} className="cart-row-image">
                  {image ? <img src={`${image}?w=240&h=240`} alt={item.title} /> : <span className="cart-row-noimage">No image</span>}
                </Link>
                <div className="cart-row-body">
                  <Link to={`/game/${item.id}`} className="cart-row-title">{item.title}</Link>
                  <div className="cart-row-prices">
                    {special?.available && (
                      <span className="cart-row-price"><b style={{ color: '#ac84f1' }}>Спецпредл.</b> {special.formatted || formatRub(special.value)}</span>
                    )}
                    {oplata?.available && (
                      <span className="cart-row-price"><b>На аккаунт</b> {oplata.formatted || formatRub(oplata.value)}</span>
                    )}
                    {key?.available && (
                      <span className="cart-row-price"><b>Ключ</b> {key.formatted || formatRub(key.value)}</span>
                    )}
                    {topup?.available && (
                      <span className="cart-row-price"><b>Карты</b> {topup.formatted || formatRub(topup.value)}</span>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  className="cart-row-remove"
                  aria-label="Удалить из корзины"
                  onClick={() => remove(item.id)}
                >
                  ×
                </button>
              </div>
            );
          })}
          <button type="button" className="cart-clear" onClick={clear}>Очистить корзину</button>
        </div>

        <aside className="cart-summary">
          <h2>Общая сумма</h2>
          <ul className="cart-summary-list">
            {totals.map((mode) => {
              const available = mode.id === 'special_offer'
                ? allHaveSpecialOffer(items)
                : Boolean(mode.total);
              const isCartCapable = mode.id === 'oplata' || mode.id === 'key_activation';
              return (
                <li key={mode.id} className={`cart-summary-row ${available ? '' : 'cart-summary-row--disabled'}`}>
                  <div className="cart-summary-mode">
                    <strong style={mode.id === 'special_offer' ? { color: '#ac84f1' } : undefined}>{mode.title}</strong>
                    <small>{mode.description}</small>
                  </div>
                  <div className="cart-summary-amount">
                    {mode.id === 'special_offer' && (
                      available
                        ? <span>у каждого товара — свой</span>
                        : <span className="cart-summary-na">недоступно (нет у части товаров)</span>
                    )}
                    {mode.id !== 'special_offer' && mode.total && (
                      <>
                        <strong>{mode.total.formatted}</strong>
                        {mode.id === 'topup_cards' && mode.total.cardsCount > 0 && (
                          <small>{mode.total.cardsCount} карт</small>
                        )}
                      </>
                    )}
                    {mode.id !== 'special_offer' && !mode.total && (
                      <span className="cart-summary-na">недоступно (нет у части товаров)</span>
                    )}
                  </div>
                  <button
                    type="button"
                    className="cart-summary-buy"
                    disabled={!available || !isCartCapable}
                    title={!isCartCapable && available ? 'Этот способ нельзя оплатить корзиной' : undefined}
                    onClick={() => openPurchase(mode.id)}
                  >
                    Купить
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="cart-summary-note">
            Корзиной (одной ссылкой) поддерживаются режимы «На аккаунт» и «Ключ на игру».
            Остальные режимы — каждый товар оплачивается отдельно.
          </p>
        </aside>
      </div>

      {purchaseOpen && (
        <div className="purchase-modal-backdrop" onClick={closePurchase}>
          <div className="purchase-modal" onClick={(e) => e.stopPropagation()}>
            <button
              className="purchase-modal-close"
              type="button"
              onClick={closePurchase}
              disabled={purchaseLoading}
              aria-label="Закрыть"
            >
              x
            </button>

            <div className="purchase-modal-head">
              <p className="profile-kicker">Покупка корзины</p>
              <h2>{count} {count === 1 ? 'товар' : 'товаров'}</h2>
              {(() => {
                const total = totals.find((t) => t.id === form.paymentMode)?.total;
                return total ? <p>Итого: {total.formatted}</p> : null;
              })()}
            </div>

            {!cartSupportsServer ? (
              <div className="purchase-modal-section">
                <p>Для способа «{PAYMENT_MODES.find((m) => m.id === form.paymentMode)?.title || form.paymentMode}» оплата корзиной пока не поддерживается. Откройте каждый товар отдельно.</p>
              </div>
            ) : (
              <form className="purchase-modal-form" onSubmit={handleSubmit}>
                <section className="purchase-modal-section">
                  <h3>Способ оплаты</h3>
                  <div className="purchase-mode-grid">
                    {PAYMENT_MODES.filter((m) => m.id === 'oplata' || m.id === 'key_activation').map((mode) => {
                      const available = paymentModeAvailable(items, mode.id);
                      return (
                        <label key={mode.id} className={`purchase-mode-card ${form.paymentMode === mode.id ? 'active' : ''} ${available ? '' : 'disabled'}`}>
                          <input
                            type="radio"
                            name="paymentMode"
                            value={mode.id}
                            checked={form.paymentMode === mode.id}
                            onChange={handleField}
                            disabled={!available || purchaseLoading}
                          />
                          <span>
                            <strong>{mode.title}</strong>
                            <small>{available ? mode.description : 'недоступно для части товаров'}</small>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </section>

                <section className="purchase-modal-section">
                  <h3>Данные</h3>
                  {profileLoading ? (
                    <p className="purchase-muted">Проверяем сохранённые данные профиля...</p>
                  ) : (
                    <>
                      {!currentUser && (
                        <p className="purchase-muted">
                          <button type="button" className="cart-link-button" onClick={onLoginClick}>Войдите</button>
                          {' '}чтобы использовать сохранённые данные, либо введите их вручную.
                        </p>
                      )}
                      {hasSavedPurchaseEmail && (
                        <div className="purchase-data-row"><span>Email для покупки</span><strong>{purchaseSettings.purchaseEmail}</strong></div>
                      )}
                      {!hasSavedPurchaseEmail && registrationEmail && (
                        <div className="purchase-data-row"><span>Email регистрации</span><strong>{registrationEmail}</strong></div>
                      )}
                      {hasSavedAccountEmail && !skipAccountFields && (
                        <div className="purchase-data-row"><span>Аккаунт Xbox</span><strong>{purchaseSettings.xboxAccountEmail}</strong></div>
                      )}
                      {hasSavedAccountPassword && !skipAccountFields && (
                        <div className="purchase-data-row"><span>Пароль Xbox</span><strong>Сохранён в профиле</strong></div>
                      )}

                      {needsPurchaseEmail && (
                        <label>
                          Email для покупки
                          <input name="purchaseEmail" type="email" value={form.purchaseEmail} onChange={handleField} placeholder="mail@example.com" required />
                        </label>
                      )}
                      {needsAccountEmail && (
                        <label>
                          Email аккаунта Xbox
                          <input name="accountEmail" type="email" value={form.accountEmail} onChange={handleField} placeholder="xbox@example.com" autoComplete="username" required />
                        </label>
                      )}
                      {needsAccountPassword && (
                        <label>
                          Пароль аккаунта Xbox
                          <input name="accountPassword" type="password" value={form.accountPassword} onChange={handleField} placeholder="Пароль" autoComplete="current-password" required />
                        </label>
                      )}
                    </>
                  )}
                </section>

                {purchaseError && <p className="ps-purchase-error">{purchaseError}</p>}

                {purchaseResult?.paymentUrl ? (
                  <div className="purchase-result">
                    <strong>Корзина готова</strong>
                    <p>Все товары добавлены в одну корзину на oplata.info. Оплатите единой ссылкой.</p>
                    <div className="purchase-result-actions">
                      <button
                        className="purchase-primary"
                        type="button"
                        onClick={() => window.location.assign(purchaseResult.paymentUrl)}
                      >
                        Оплатить корзину
                      </button>
                      <button
                        className="purchase-secondary"
                        type="button"
                        onClick={async () => {
                          try { await navigator.clipboard.writeText(purchaseResult.paymentUrl); } catch { /* ignore */ }
                        }}
                      >
                        Копировать ссылку
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    className="purchase-primary"
                    type="submit"
                    disabled={purchaseLoading || profileLoading}
                  >
                    {purchaseLoading ? 'Формируем корзину...' : 'Сформировать корзину и оплатить'}
                  </button>
                )}
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
