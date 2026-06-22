import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchUbisoft, createUbisoftOrder } from '../services/api';
import { useSeoMeta } from '../utils/useSeoMeta';
import Spinner from '../components/Spinner';

function formatPrice(rub) {
  return rub.toLocaleString('ru-RU') + ' ₽';
}

function OptionList({ opt, selections, basePrice, onChange }) {
  return (
    <div className="gp-page-option-group">
      <p className="gp-option-label">{opt.label}</p>
      <div className="gp-option-list">
        {opt.variants.map((v) => {
          const isSelected = selections[opt.id] === v.value;
          const price = basePrice + v.modifyValue;
          return (
            <label key={v.value} className={`gp-option-row ${isSelected ? 'gp-option-row--selected' : ''}`}>
              <input
                type="radio"
                name={`opt-${opt.id}`}
                value={v.value}
                checked={isSelected}
                onChange={() => onChange(opt.id, v.value)}
              />
              <span className="gp-option-row-indicator" />
              <span className="gp-option-row-text">{v.text}</span>
              <span className="gp-option-row-price">{formatPrice(price)}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

export default function UbisoftPage() {
  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selections, setSelections] = useState({});
  const [buying, setBuying] = useState(false);
  const [buyError, setBuyError] = useState('');

  useSeoMeta({
    title: 'Купить Ubisoft+ — подписка на игры Ubisoft на аккаунт Xbox',
    description: 'Ubisoft+ со скидкой. Доступ к библиотеке игр Ubisoft. Активация на аккаунт Xbox. Оплата через Digiseller.',
  });

  useEffect(() => {
    fetchUbisoft()
      .then(({ product: p }) => {
        setProduct(p);
        const initial = {};
        (p.options || []).forEach((opt) => {
          if (opt.type === 'radio' && opt.variants.length > 0) {
            initial[opt.id] = opt.variants[0].value;
          }
        });
        setSelections(initial);
      })
      .catch((err) => setError(err.response?.data?.error?.message || err.message || 'Не удалось загрузить данные'))
      .finally(() => setLoading(false));
  }, []);

  const totalPrice = product
    ? product.basePrice + (product.options || []).reduce((sum, opt) => {
        const selVal = selections[opt.id];
        if (!selVal) return sum;
        const variant = opt.variants.find((v) => v.value === selVal);
        return sum + (variant?.modifyValue || 0);
      }, 0)
    : 0;

  const handleBuy = async () => {
    setBuying(true);
    setBuyError('');
    try {
      const { payUrl: url } = await createUbisoftOrder(selections);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setBuyError(err.response?.data?.error?.message || err.message || 'Не удалось создать заказ');
    } finally {
      setBuying(false);
    }
  };

  const handleChange = (optId, value) =>
    setSelections((s) => ({ ...s, [optId]: value }));

  return (
    <div className="detail-page detail-store-page">
      <nav className="detail-breadcrumb">
        <Link to="/">Назад в каталог</Link>
      </nav>

      <section className="ps-product-card gp-page-card">
        <div className="gp-page-bg" aria-hidden="true" />

        <div className="ps-product-art gp-page-art">
          <div className="gp-page-logo-wrap">
            <div className="gp-page-logo-icon">
              <svg viewBox="0 0 64 64" width="80" height="80" fill="none" aria-hidden="true">
                <circle cx="32" cy="32" r="32" fill="rgba(255,255,255,0.08)" />
                <text x="32" y="42" textAnchor="middle" fontSize="28" fill="#fff" fontWeight="bold">U+</text>
              </svg>
            </div>
            <div className="gp-page-logo-badge">UBISOFT</div>
            <div className="gp-page-logo-sub">PLUS</div>
          </div>
        </div>

        <div className="ps-product-main">
          <h1 className="detail-title">Ubisoft+</h1>
          <p className="gp-page-subtitle">
            Подписка на библиотеку игр Ubisoft · Новые игры в день релиза · Скидки для подписчиков
          </p>
          <div className="gp-page-delivery-row">
            <span className="gp-page-delivery-badge">⚡ Быстрая активация</span>
            <span className="gp-page-delivery-note">10 мин — 3 часа · продавец активирует на вашем аккаунте</span>
          </div>

          {loading && <div className="gp-page-loading"><Spinner /></div>}

          {error && (
            <div className="gp-error" style={{ marginTop: '1rem' }}>
              {error}
              <br />
              <a href="https://xboxportal.ru/product/3711939" target="_blank" rel="noreferrer" className="gp-error-link">
                Открыть на xboxportal.ru →
              </a>
            </div>
          )}

          {!loading && !error && product && (
            <>
              {product.options.map((opt) => (
                <OptionList
                  key={opt.id}
                  opt={opt}
                  selections={selections}
                  basePrice={product.basePrice}
                  onChange={handleChange}
                />
              ))}

              <div className="ps-buy-row gp-page-buy-row">
                <div className="ps-price">
                  <div className="ps-price-main">
                    <strong className="gp-page-total-price">{formatPrice(totalPrice)}</strong>
                  </div>
                  <span className="gp-page-price-note">Итоговая стоимость</span>
                </div>
                <div className="ps-buy-actions">
                  <button
                    className="ps-buy-button"
                    type="button"
                    onClick={handleBuy}
                    disabled={buying}
                  >
                    {buying ? 'Создаём заказ…' : 'Перейти к оплате →'}
                  </button>
                </div>
              </div>

              {buyError && <p className="gp-error" style={{ marginTop: '0.75rem' }}>{buyError}</p>}

              <p className="gp-pay-note" style={{ marginTop: '0.75rem' }}>
                Безопасная оплата через <strong>oplata.info</strong> · Digiseller
              </p>
            </>
          )}
        </div>
      </section>

      <section className="gp-page-features">
        <h2>Что входит в Ubisoft+</h2>
        <div className="gp-page-feature-grid">
          <div className="gp-page-feature-card">
            <span className="gp-page-feature-icon">🎮</span>
            <strong>100+ игр Ubisoft</strong>
            <span>Assassin's Creed, Far Cry, Rainbow Six и другие хиты</span>
          </div>
          <div className="gp-page-feature-card">
            <span className="gp-page-feature-icon">🚀</span>
            <strong>Новинки в день релиза</strong>
            <span>Все новые игры Ubisoft доступны сразу после выхода</span>
          </div>
          <div className="gp-page-feature-card">
            <span className="gp-page-feature-icon">💰</span>
            <strong>Скидки для подписчиков</strong>
            <span>Эксклюзивные скидки на DLC и дополнительный контент</span>
          </div>
          <div className="gp-page-feature-card">
            <span className="gp-page-feature-icon">☁️</span>
            <strong>Ubisoft Connect</strong>
            <span>Единый аккаунт для всех игр и наград Ubisoft</span>
          </div>
        </div>
      </section>
    </div>
  );
}
