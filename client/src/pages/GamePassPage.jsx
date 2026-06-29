import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchGamePass, createGamePassOrder } from '../services/api';
import { useSeoMeta } from '../utils/useSeoMeta';
import Spinner from '../components/Spinner';
import DigisellerDescription from '../components/DigisellerDescription';

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

export default function GamePassPage() {
  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selections, setSelections] = useState({});
  const [buying, setBuying] = useState(false);
  const [buyError, setBuyError] = useState('');

  useSeoMeta({
    title: 'Купить Xbox Game Pass Ultimate — быстрая активация на аккаунт',
    description: 'Xbox Game Pass Ultimate со скидкой. Активация 10 мин — 3 часа. Выберите срок подписки и оплатите через Digiseller.',
  });

  useEffect(() => {
    fetchGamePass()
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
      const { payUrl: url } = await createGamePassOrder(selections);
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
                <path fill="#fff" d="M20 22c0-2.2 1.8-4 4-4h16c2.2 0 4 1.8 4 4v20c0 2.2-1.8 4-4 4H24c-2.2 0-4-1.8-4-4V22zm6 2v16h12V24H26z" />
              </svg>
            </div>
            <div className="gp-page-logo-badge">GAME PASS</div>
            <div className="gp-page-logo-sub">ULTIMATE</div>
          </div>
        </div>

        <div className="ps-product-main">
          <h1 className="detail-title">Xbox Game Pass Ultimate</h1>
          <p className="gp-page-subtitle">
            Доступ к 100+ играм · Онлайн-мультиплеер · EA Play включён
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
              <a href="https://xboxportal.ru/product/4687274" target="_blank" rel="noreferrer" className="gp-error-link">
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

      {!loading && !error && product && <DigisellerDescription description={product.description} showImages={false} />}

      <section className="gp-page-features">
        <h2>Что входит в Game Pass Ultimate</h2>
        <div className="gp-page-feature-grid">
          <div className="gp-page-feature-card">
            <span className="gp-page-feature-icon">🎮</span>
            <strong>100+ игр</strong>
            <span>Огромная библиотека — новые игры появляются в день релиза</span>
          </div>
          <div className="gp-page-feature-card">
            <span className="gp-page-feature-icon">🌐</span>
            <strong>Онлайн-мультиплеер</strong>
            <span>Xbox Live Gold включён — играйте с друзьями онлайн</span>
          </div>
          <div className="gp-page-feature-card">
            <span className="gp-page-feature-icon">⚡</span>
            <strong>EA Play</strong>
            <span>Включён без доплаты — игры EA, скидки, ранний доступ</span>
          </div>
          <div className="gp-page-feature-card">
            <span className="gp-page-feature-icon">☁️</span>
            <strong>Cloud Gaming</strong>
            <span>Играйте на телефоне, планшете и ПК через облако</span>
          </div>
        </div>
      </section>
    </div>
  );
}
