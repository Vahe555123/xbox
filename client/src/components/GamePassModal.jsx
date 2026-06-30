import React, { useEffect, useRef, useState } from 'react';
import { fetchGamePass, createGamePassOrder } from '../services/api';

function formatPrice(rub) {
  return rub.toLocaleString('ru-RU') + ' ₽';
}

export default function GamePassModal({ onClose }) {
  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // selections: { [optionId]: variantValue }
  const [selections, setSelections] = useState({});
  const [buying, setBuying] = useState(false);
  const backdropRef = useRef(null);

  useEffect(() => {
    fetchGamePass()
      .then(({ product: p }) => {
        setProduct(p);
        // Pre-select first radio variant of each option
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

  // Keyboard close
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Lock body scroll
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
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
    try {
      const { payUrl: url } = await createGamePassOrder(selections);
      window.location.assign(url);
    } catch (err) {
      setError(err.response?.data?.error?.message || err.message || 'Не удалось создать заказ');
    } finally {
      setBuying(false);
    }
  };

  const handleBackdrop = (e) => {
    if (e.target === backdropRef.current) onClose();
  };

  return (
    <div
      ref={backdropRef}
      className="gp-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Xbox Game Pass Ultimate"
      onClick={handleBackdrop}
    >
      <div className="gp-modal">
        <button className="gp-close" type="button" aria-label="Закрыть" onClick={onClose}>
          ×
        </button>

        <div className="gp-header">
          <div className="gp-badge">Game Pass</div>
          <h2 className="gp-title">Xbox Game Pass Ultimate</h2>
          <p className="gp-subtitle">
            Быстрая активация · 10 мин — 3 часа · Продавец активирует на вашем аккаунте
          </p>
        </div>

        {loading && (
          <div className="gp-loading">
            <div className="gp-spinner" />
            <span>Загружаем актуальные цены…</span>
          </div>
        )}

        {error && (
          <div className="gp-error">
            {error}
            <br />
            <a
              href="https://xboxportal.ru/product/4687274"
              target="_blank"
              rel="noreferrer"
              className="gp-error-link"
            >
              Открыть на xboxportal.ru →
            </a>
          </div>
        )}

        {!loading && !error && product && (
          <>
            <div className="gp-options">
              {product.options.map((opt) => (
                <div key={opt.id} className="gp-option-group">
                  <p className="gp-option-label">{opt.label}</p>

                  {opt.type === 'radio' && (
                    <div className="gp-radio-list">
                      {opt.variants.map((v) => {
                        const price = product.basePrice + v.modifyValue;
                        const isSelected = selections[opt.id] === v.value;
                        return (
                          <label
                            key={v.value}
                            className={`gp-radio-row ${isSelected ? 'selected' : ''}`}
                          >
                            <input
                              type="radio"
                              name={`opt-${opt.id}`}
                              value={v.value}
                              checked={isSelected}
                              onChange={() => setSelections((s) => ({ ...s, [opt.id]: v.value }))}
                            />
                            <span className="gp-radio-text">{v.text}</span>
                            <span className="gp-radio-price">{formatPrice(price)}</span>
                          </label>
                        );
                      })}
                    </div>
                  )}

                  {opt.type === 'checkbox' && (
                    <div className="gp-checkbox-list">
                      {opt.variants.map((v) => {
                        const isChecked = selections[opt.id] === v.value;
                        return (
                          <label key={v.value} className={`gp-checkbox-row ${isChecked ? 'selected' : ''}`}>
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(e) => setSelections((s) => ({
                                ...s,
                                [opt.id]: e.target.checked ? v.value : undefined,
                              }))}
                            />
                            <span className="gp-checkbox-text">{v.text}</span>
                            {v.modifyValue > 0 && (
                              <span className="gp-checkbox-add">+{formatPrice(v.modifyValue)}</span>
                            )}
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="gp-footer">
              <div className="gp-total">
                <span>Итого</span>
                <strong>{formatPrice(totalPrice)}</strong>
              </div>

              <button
                className="gp-buy-btn"
                type="button"
                onClick={handleBuy}
                disabled={buying}
              >
                {buying ? 'Создаём заказ…' : 'Перейти к оплате →'}
              </button>

              <p className="gp-pay-note">
                Безопасная оплата через <strong>oplata.info</strong> · Digiseller
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
